#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';
import http from 'http';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseComponentSource } from './component-source.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = process.cwd();
const CONFIG_FILENAME = 'ngx-locatorjs.config.json';
const configPath = path.resolve(root, CONFIG_FILENAME);

if (!fs.existsSync(configPath)) {
  console.log(`🚀 ${CONFIG_FILENAME} not found!`);
  console.log('Please run: npx locatorjs-config');
  console.log('Or manually create the config file.');
  process.exit(1);
}

type ScanConfig = {
  includeGlobs?: string[];
  excludeGlobs?: string[];
};

type OpenInEditorConfig = {
  port?: number;
  host?: string;
  editor?: string;
  fallbackEditor?: string;
  workspaceRoot?: string;
  authToken?: string;
  scan?: ScanConfig;
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

const DEFAULT_INCLUDE_GLOBS = [
  'src/**/*.{ts,tsx,js,jsx}',
  'projects/**/*.{ts,tsx,js,jsx}',
  'apps/**/*.{ts,tsx,js,jsx}',
  'libs/**/*.{ts,tsx,js,jsx}',
];

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as OpenInEditorConfig;

const WATCH_ENABLED = process.argv.includes('--watch') || process.argv.includes('-w');

const cfgScan = cfg.scan ?? {};
const scanIncludeGlobs = cfgScan.includeGlobs ?? DEFAULT_INCLUDE_GLOBS;
const scanWorkspaceRoot = cfg.workspaceRoot?.trim() || '.';

const cfgPort = cfg.port;
const cfgHost = cfg.host?.trim();

const PORT = Number(process.env.OPEN_IN_EDITOR_PORT || cfgPort || 4123);
const HOST = process.env.OPEN_IN_EDITOR_HOST || cfgHost || '127.0.0.1';
// Per-machine token written by locatorjs-config. It lives in the gitignored
// .open-in-editor/ directory so the shared config file never contains a secret.
const AUTH_TOKEN_PATH = path.resolve(root, '.open-in-editor/auth-token');

function readAuthTokenFile(): string | null {
  try {
    return fs.readFileSync(AUTH_TOKEN_PATH, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

// Same precedence as the generated proxy module: env > config (legacy) > token file.
const AUTH_TOKEN =
  (process.env.OPEN_IN_EDITOR_TOKEN || cfg.authToken || '').trim() || readAuthTokenFile();
const WORKSPACE_ROOT = path.resolve(root, scanWorkspaceRoot);
const MAP_PATH = path.resolve(root, '.open-in-editor/component-map.json');
const SAFE_WATCH_DIR_NAMES = new Set(['node_modules', 'dist', '.git', '.angular', 'coverage']);

const editorCLICache: Record<string, boolean> = {};
function checkEditorCLI(editorName: string, cliCommand = editorName) {
  if (editorCLICache[editorName] !== undefined) return editorCLICache[editorName];

  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    childProcess.execSync(`${lookup} ${cliCommand}`, { stdio: 'ignore' });
    editorCLICache[editorName] = true;
    console.log(`[file-opener] ${editorName} CLI found, using precise line navigation`);
  } catch {
    editorCLICache[editorName] = false;
    console.log(`[file-opener] ${editorName} CLI not found, using fallback method`);
  }
  return editorCLICache[editorName];
}

const MAC_APP_NAMES: Record<string, string> = {
  antigravity: 'Antigravity IDE',
  cursor: 'Cursor',
  code: 'Visual Studio Code',
  zed: 'Zed',
  webstorm: 'WebStorm',
};

function detectAvailableEditors() {
  const editors = ['cursor', 'zed', 'antigravity', 'code', 'webstorm'];
  const available: Array<{ name: string; hasCliPrecision: boolean }> = [];

  for (const editor of editors) {
    if (checkEditorCLI(editor)) {
      available.push({ name: editor, hasCliPrecision: true });
    }
  }

  return available;
}

const AVAILABLE_EDITORS = detectAvailableEditors();
const DEFAULT_EDITOR = process.env.LAUNCH_EDITOR || cfg.editor || 'cursor';
const FALLBACK_EDITOR =
  cfg.fallbackEditor ||
  AVAILABLE_EDITORS.find((editor) => editor.name !== DEFAULT_EDITOR)?.name ||
  'code';

type FilePosition = { filePath: string; line: string; col: string };

/**
 * Builds the command for an editor. When the editor CLI is missing, macOS falls back to
 * `open -a <App>`; other platforms still try the CLI name so the failure is reported
 * (and the fallback editor is tried) instead of running a macOS-only command.
 */
function cliOrAppFallback(
  editor: string,
  pos: FilePosition,
  buildCliArgs: (pos: FilePosition) => string[],
): [string, string[]] {
  if (checkEditorCLI(editor) || process.platform !== 'darwin') {
    return [editor, buildCliArgs(pos)];
  }
  return ['open', ['-a', MAC_APP_NAMES[editor], pos.filePath]];
}

const gotoArgs = (pos: FilePosition) => ['--goto', `${pos.filePath}:${pos.line}:${pos.col}`];

const COMMAND_TEMPLATES: Record<string, (pos: FilePosition) => [string, string[]]> = {
  antigravity: (pos) => cliOrAppFallback('antigravity', pos, gotoArgs),
  cursor: (pos) => cliOrAppFallback('cursor', pos, gotoArgs),
  code: (pos) => cliOrAppFallback('code', pos, gotoArgs),
  zed: (pos) => cliOrAppFallback('zed', pos, (p) => [`${p.filePath}:${p.line}:${p.col}`]),
  webstorm: (pos) =>
    cliOrAppFallback('webstorm', pos, (p) => ['--line', p.line, '--column', p.col, p.filePath]),
};

/**
 * Spawns a detached process and resolves once it has actually started.
 * `spawn` reports a missing executable (ENOENT) asynchronously through the `'error'` event,
 * not by throwing, so a try/catch alone neither detects the failure nor prevents the
 * unhandled `'error'` event from crashing the server.
 */
function spawnDetached(label: string, cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child: childProcess.ChildProcess;
    try {
      child = childProcess.spawn(cmd, args, { stdio: 'ignore', detached: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`[file-opener] ${label} failed: ${message}`);
      resolve(false);
      return;
    }
    child.once('error', (e) => {
      console.log(`[file-opener] ${label} failed: ${e.message}`);
      resolve(false);
    });
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

async function launchInEditor(pos: FilePosition, preferred = DEFAULT_EDITOR): Promise<boolean> {
  if (process.env.EDITOR_CMD) {
    const [cmd, ...rest] = process.env.EDITOR_CMD.split(' ');
    const fileWithPos = `${pos.filePath}:${pos.line}:${pos.col}`;
    if (await spawnDetached('EDITOR_CMD', cmd, [...rest, fileWithPos])) return true;
  }

  const tryRun = async (editor: string) => {
    const mk = COMMAND_TEMPLATES[editor];
    if (!mk) return false;
    const [cmd, args] = mk(pos);
    return spawnDetached(editor, cmd, args);
  };

  if (await tryRun(preferred)) return true;
  if (FALLBACK_EDITOR && FALLBACK_EDITOR !== preferred && (await tryRun(FALLBACK_EDITOR))) {
    return true;
  }

  return false;
}

function findBestLineInFile(filePath: string, searchTerms: string[]) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const scores = new Array(lines.length).fill(0);

    searchTerms.forEach((term, termIndex) => {
      const weight = Math.max(1, searchTerms.length - termIndex);

      lines.forEach((line, lineIndex) => {
        const lowerLine = line.toLowerCase();
        const lowerTerm = term.toLowerCase();

        if (lowerLine.includes(lowerTerm)) {
          scores[lineIndex] += weight * 2;

          if (
            new RegExp(`\\b${lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerLine)
          ) {
            scores[lineIndex] += weight * 3;
          }

          if (lowerLine.trim().startsWith(lowerTerm)) {
            scores[lineIndex] += weight * 1.5;
          }
        }
      });
    });

    let bestLine = 1;
    let bestScore = 0;
    scores.forEach((score, index) => {
      if (score > bestScore) {
        bestScore = score;
        bestLine = index + 1;
      }
    });

    return bestScore > 0 ? bestLine : 1;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[file-opener] Failed to search in file: ${message}`);
    return 1;
  }
}

function getWatchRoots(includeGlobs: string[], workspaceRoot: string): string[] {
  const roots = new Set<string>();

  includeGlobs.forEach((glob) => {
    const base = globToBaseDir(glob);
    const resolved = path.resolve(root, workspaceRoot, base);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      roots.add(resolved);
    }
  });

  return Array.from(roots);
}

function globToBaseDir(glob: string): string {
  const wildcardIndex = glob.search(/[*?[\]{]/);
  if (wildcardIndex === -1) return glob;
  const prefix = glob.slice(0, wildcardIndex);
  if (prefix.endsWith('/')) return prefix.slice(0, -1);
  return path.dirname(prefix);
}

function collectNestedDirectories(baseDir: string, out = new Set<string>()) {
  if (!fs.existsSync(baseDir)) return out;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(baseDir);
  } catch {
    return out;
  }
  if (!stat.isDirectory()) return out;
  if (out.has(baseDir)) return out;
  out.add(baseDir);

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SAFE_WATCH_DIR_NAMES.has(entry.name)) continue;
    collectNestedDirectories(path.join(baseDir, entry.name), out);
  }
  return out;
}

function startScanWatch() {
  const scanScript = path.resolve(__dirname, 'cmp-scan.js');
  if (!fs.existsSync(scanScript)) {
    console.log('[file-opener] scan script not found, watch disabled.');
    return;
  }

  const roots = getWatchRoots(scanIncludeGlobs, scanWorkspaceRoot);
  if (roots.length === 0) {
    console.log('[file-opener] watch roots not found, watch disabled.');
    return;
  }

  const supportsRecursive = process.platform === 'darwin' || process.platform === 'win32';
  const watcherByPath = new Map<string, fs.FSWatcher>();
  let scanRunning = false;
  let scanQueued = false;
  let timer: NodeJS.Timeout | null = null;

  const runScan = (reason: string) => {
    if (scanRunning) {
      scanQueued = true;
      return;
    }
    scanRunning = true;
    const label = reason ? ` (${reason})` : '';
    console.log(`[file-opener] scan started${label}`);

    const scanProcess = spawn(process.execPath, [scanScript], {
      stdio: 'inherit',
      cwd: root,
    });

    scanProcess.on('close', (code) => {
      scanRunning = false;
      if (code === 0) {
        console.log('[file-opener] scan completed');
      } else {
        console.log('[file-opener] scan failed');
      }
      if (scanQueued) {
        scanQueued = false;
        scheduleScan('queued');
      }
    });
  };

  const scheduleScan = (reason: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => runScan(reason), 400);
  };

  const refreshWatchers = () => {
    if (supportsRecursive) return;
    const nextPaths = new Set<string>();
    for (const baseRoot of roots) {
      const dirs = collectNestedDirectories(baseRoot);
      for (const dir of dirs) {
        nextPaths.add(dir);
      }
    }

    for (const [watchPath, watcher] of watcherByPath.entries()) {
      if (!nextPaths.has(watchPath)) {
        watcher.close();
        watcherByPath.delete(watchPath);
      }
    }
    for (const watchPath of nextPaths) {
      attachWatcher(watchPath);
    }
  };

  const attachWatcher = (watchPath: string) => {
    if (watcherByPath.has(watchPath)) return;
    try {
      const watcher = fs.watch(
        watchPath,
        { recursive: supportsRecursive },
        (eventType, filename) => {
          const detail = filename ? `${eventType}:${filename.toString()}` : eventType;
          scheduleScan(detail);
          if (!supportsRecursive && eventType === 'rename') {
            refreshWatchers();
          }
        },
      );
      watcherByPath.set(watchPath, watcher);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[file-opener] failed to watch ${watchPath}: ${message}`);
    }
  };

  if (supportsRecursive) {
    roots.forEach(attachWatcher);
    console.log(`[file-opener] watch enabled (recursive): ${roots.join(', ')}`);
  } else {
    refreshWatchers();
    console.log(`[file-opener] watch enabled (directory-mode): ${watcherByPath.size} directories`);
    setInterval(refreshWatchers, 10000);
  }

  runScan('initial');
}

function safeCompareToken(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function extractRequestToken(req: http.IncomingMessage, url: URL): string | null {
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

  const headerToken = req.headers['x-locatorjs-token'];
  if (typeof headerToken === 'string' && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return null;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    /^127(\.\d{1,3}){3}$/.test(normalized)
  );
}

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const BIND_IS_LOOPBACK = isLoopbackHostname(HOST);

/**
 * Blocks requests a browser makes on behalf of another website.
 * The dev-server proxy injects the auth token, so a page on any site could otherwise
 * trigger opener routes through it (e.g. with an <img> tag). The proxy forwards the
 * browser's Sec-Fetch-Site / Origin / Referer headers, which identify such requests.
 * The Host check rejects DNS-rebinding requests when the opener only listens on loopback.
 */
function getRejectionReason(req: http.IncomingMessage): string | null {
  if (BIND_IS_LOOPBACK) {
    const host = hostnameOf(`http://${req.headers.host ?? ''}`);
    if (!host || !isLoopbackHostname(host)) return 'unexpected Host header';
  }

  if (req.headers['sec-fetch-site'] === 'cross-site') {
    const source = hostnameOf(req.headers.origin) ?? hostnameOf(req.headers.referer);
    // Pages served from this machine (e.g. localhost:4200 calling 127.0.0.1:4123) are allowed.
    if (!source || !isLoopbackHostname(source)) return 'cross-site request blocked';
  }

  return null;
}

function ensureAuthorized(req: http.IncomingMessage, url: URL): boolean {
  if (!AUTH_TOKEN) return true;

  const token = extractRequestToken(req, url);
  if (!token) return false;
  return safeCompareToken(token, AUTH_TOKEN);
}

function toPositiveIntString(value: string | null): string {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '1';
}

function resolveAllowedFilePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error('file is required');
  }
  if (trimmed.includes('\0')) {
    throw new Error('file path is invalid');
  }

  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(WORKSPACE_ROOT, trimmed);

  if (!fs.existsSync(resolved)) {
    throw new Error('file does not exist');
  }

  const realWorkspaceRoot = fs.realpathSync(WORKSPACE_ROOT);
  const realPath = fs.realpathSync(resolved);
  const relative = path.relative(realWorkspaceRoot, realPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('file path is outside workspace root');
  }

  const stat = fs.statSync(realPath);
  if (!stat.isFile()) {
    throw new Error('path must be a file');
  }

  return realPath;
}

/**
 * Resolves a component source path reported by the browser. Angular's class debug info
 * gives paths relative to the TypeScript root, which is usually the directory the
 * opener runs in, so both that and workspaceRoot are tried.
 */
function resolveComponentSourcePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed && !path.isAbsolute(trimmed)) {
    for (const base of [WORKSPACE_ROOT, root]) {
      const candidate = path.resolve(base, trimmed);
      if (fs.existsSync(candidate)) return resolveAllowedFilePath(candidate);
    }
  }
  return resolveAllowedFilePath(trimmed);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  const rejectionReason = getRejectionReason(req);
  if (rejectionReason) {
    console.log(`[file-opener] Rejected ${pathname}: ${rejectionReason}`);
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  if (!ensureAuthorized(req, url)) {
    res.statusCode = 401;
    res.end('Unauthorized request');
    return;
  }

  if (pathname === '/__cmp-map') {
    if (!fs.existsSync(MAP_PATH)) {
      res.statusCode = 404;
      res.end('component-map.json not found');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    fs.createReadStream(MAP_PATH).pipe(res);
    return;
  }

  if (pathname === '/__open-in-editor') {
    const file = url.searchParams.get('file');
    const line = toPositiveIntString(url.searchParams.get('line'));
    const col = toPositiveIntString(url.searchParams.get('col'));

    if (!file) {
      res.statusCode = 400;
      res.end('file is required');
      return;
    }

    let safePath: string;
    try {
      safePath = resolveAllowedFilePath(decodeURIComponent(file));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'invalid file';
      res.statusCode = 403;
      res.end(message);
      return;
    }

    console.log(`[file-opener] Opening file: ${safePath}:${line}:${col}`);

    const ok = await launchInEditor({ filePath: safePath, line, col });

    if (!ok) {
      res.statusCode = 500;
      res.end('Failed to launch editor. Check PATH or set EDITOR_CMD.');
      return;
    }
    res.end('ok');
    return;
  }

  if (pathname === '/__open-in-editor-search') {
    const file = url.searchParams.get('file');
    const searchParam = url.searchParams.get('search');

    if (!file) {
      res.statusCode = 400;
      res.end('file is required');
      return;
    }
    if (!searchParam) {
      res.statusCode = 400;
      res.end('search terms required');
      return;
    }

    let safePath: string;
    try {
      safePath = resolveAllowedFilePath(decodeURIComponent(file));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'invalid file';
      res.statusCode = 403;
      res.end(message);
      return;
    }

    try {
      const searchTerms = JSON.parse(decodeURIComponent(searchParam));
      if (!Array.isArray(searchTerms) || !searchTerms.every((term) => typeof term === 'string')) {
        res.statusCode = 400;
        res.end('search terms must be string[]');
        return;
      }
      const bestLine = findBestLineInFile(safePath, searchTerms);

      const ok = await launchInEditor({ filePath: safePath, line: String(bestLine), col: '1' });

      if (!ok) {
        res.statusCode = 500;
        res.end('Failed to launch editor');
        return;
      }

      res.end(`Opened at line ${bestLine}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[file-opener] Search error: ${message}`);
      res.statusCode = 500;
      res.end('Search failed: ' + message);
    }
    return;
  }

  if (pathname === '/__open-in-editor-resolve') {
    const file = url.searchParams.get('file');
    const className = url.searchParams.get('className');
    if (!file || !className) {
      res.statusCode = 400;
      res.end('file and className are required');
      return;
    }

    let safePath: string;
    try {
      safePath = resolveComponentSourcePath(file);
    } catch (error: unknown) {
      res.statusCode = 403;
      res.end(error instanceof Error ? error.message : 'invalid file');
      return;
    }

    const match = parseComponentSource(safePath, fs.readFileSync(safePath, 'utf8')).find(
      (component) => component.className === className,
    );
    if (!match) {
      res.statusCode = 404;
      res.end('component not found in file');
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        className: match.className,
        filePath: match.filePath,
        templateUrl: match.templateUrl ?? null,
        line: match.line,
      }),
    );
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server
  .listen(PORT, HOST, () => {
    console.log(`[file-opener] http://${HOST}:${PORT}`);
    console.log(` - map: ${path.relative(root, MAP_PATH)}`);
    console.log(` - editor: ${DEFAULT_EDITOR} (fallback: ${FALLBACK_EDITOR})`);
    console.log(` - workspace root: ${WORKSPACE_ROOT}`);
    if (AUTH_TOKEN) {
      console.log(' - auth: enabled');
    } else {
      console.log(
        ` - auth: disabled (no token in ${path.relative(root, AUTH_TOKEN_PATH)}, run locatorjs-config to create one)`,
      );
    }

    if (AVAILABLE_EDITORS.length > 0) {
      console.log(' - detected editors:');
      AVAILABLE_EDITORS.forEach((editor) => {
        const precision = editor.hasCliPrecision ? ' (precise line navigation)' : ' (app only)';
        console.log(`   • ${editor.name}${precision}`);
      });
    }

    if (WATCH_ENABLED) {
      startScanWatch();
    }
  })
  .on('error', (err: unknown) => {
    if (isErrnoException(err) && err.code === 'EADDRINUSE') {
      console.log(
        `[file-opener] Port ${PORT} already in use - another file:opener is already running`,
      );
      process.exit(0);
    } else {
      console.error('[file-opener] Server error:', err);
      process.exit(1);
    }
  });
