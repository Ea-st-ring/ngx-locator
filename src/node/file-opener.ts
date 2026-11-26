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

type FilePosition = { filePath: string; line: string; col: string };

type EditorSpec = {
  /** CLI command expected on PATH. */
  cli: string;
  /** macOS application name (`open -a`, and where to look for the bundled CLI). */
  macApp: string;
  /** macOS bundle identifier, to find the app outside the standard folders. */
  bundleId: string;
  /** CLI shipped inside the macOS app bundle, used when the PATH CLI is not installed. */
  bundledCli?: string;
  /** VS Code-style URL scheme (`<scheme>://file/<path>:<line>:<col>`), handled by the app. */
  urlScheme?: string;
  args: (pos: FilePosition) => string[];
};

const gotoArgs = (pos: FilePosition) => ['--goto', `${pos.filePath}:${pos.line}:${pos.col}`];

const EDITORS: Record<string, EditorSpec> = {
  cursor: {
    cli: 'cursor',
    macApp: 'Cursor',
    bundleId: 'com.todesktop.230313mzl4w4u92',
    bundledCli: 'Contents/Resources/app/bin/cursor',
    urlScheme: 'cursor',
    args: gotoArgs,
  },
  code: {
    cli: 'code',
    macApp: 'Visual Studio Code',
    bundleId: 'com.microsoft.VSCode',
    bundledCli: 'Contents/Resources/app/bin/code',
    urlScheme: 'vscode',
    args: gotoArgs,
  },
  antigravity: {
    cli: 'antigravity',
    macApp: 'Antigravity',
    bundleId: 'com.google.antigravity',
    bundledCli: 'Contents/Resources/app/bin/antigravity',
    urlScheme: 'antigravity',
    args: gotoArgs,
  },
  zed: {
    cli: 'zed',
    macApp: 'Zed',
    bundleId: 'dev.zed.Zed',
    bundledCli: 'Contents/MacOS/cli',
    args: (p) => [`${p.filePath}:${p.line}:${p.col}`],
  },
  webstorm: {
    cli: 'webstorm',
    macApp: 'WebStorm',
    bundleId: 'com.jetbrains.WebStorm',
    bundledCli: 'Contents/MacOS/webstorm',
    args: (p) => ['--line', p.line, '--column', p.col, p.filePath],
  },
};

function detectAvailableEditors() {
  const available: Array<{ name: string; hasCliPrecision: boolean }> = [];

  for (const [name, spec] of Object.entries(EDITORS)) {
    if (checkEditorCLI(name, spec.cli)) {
      available.push({ name, hasCliPrecision: true });
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

const macAppCache = new Map<string, string | null>();

/** Finds an app bundle in /Applications or ~/Applications, then anywhere via Spotlight. */
function findMacApp(spec: EditorSpec): string | null {
  const cached = macAppCache.get(spec.bundleId);
  if (cached !== undefined) return cached;

  const home = process.env.HOME;
  let found =
    ['/Applications', home ? path.join(home, 'Applications') : null]
      .filter((dir): dir is string => Boolean(dir))
      .map((dir) => path.join(dir, `${spec.macApp}.app`))
      .find((candidate) => fs.existsSync(candidate)) ?? null;

  if (!found) {
    try {
      const output = childProcess.execFileSync(
        'mdfind',
        [`kMDItemCFBundleIdentifier == '${spec.bundleId}'`],
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      found = output.split('\n').find((line) => line.endsWith('.app')) ?? null;
    } catch {
      found = null;
    }
  }

  macAppCache.set(spec.bundleId, found);
  return found;
}

type LaunchAttempt = {
  description: string;
  cmd: string;
  args: string[];
  lineNavigation: boolean;
};

/**
 * Ways to open a file in an editor, most precise first. Beyond the CLI on PATH, macOS
 * users often have only the app installed, so the CLI inside the app bundle and the app's
 * URL scheme also give line navigation; `open -a` opens the file without it.
 */
function getLaunchAttempts(editor: string, pos: FilePosition): LaunchAttempt[] {
  const spec = EDITORS[editor];
  if (!spec) return [];
  const attempts: LaunchAttempt[] = [];

  if (checkEditorCLI(editor, spec.cli) || process.platform !== 'darwin') {
    attempts.push({
      description: `${spec.cli} CLI`,
      cmd: spec.cli,
      args: spec.args(pos),
      lineNavigation: true,
    });
  }
  if (process.platform !== 'darwin') return attempts;

  const appPath = findMacApp(spec);
  if (appPath && spec.bundledCli) {
    const bundledCli = path.join(appPath, spec.bundledCli);
    if (fs.existsSync(bundledCli)) {
      attempts.push({
        description: `bundled CLI ${bundledCli}`,
        cmd: bundledCli,
        args: spec.args(pos),
        lineNavigation: true,
      });
    }
  }
  if (appPath && spec.urlScheme) {
    attempts.push({
      description: `${spec.urlScheme}:// URL`,
      cmd: 'open',
      args: [`${spec.urlScheme}://file${encodeURI(pos.filePath)}:${pos.line}:${pos.col}`],
      lineNavigation: true,
    });
  }
  attempts.push({
    description: `open -a (no line navigation)`,
    cmd: 'open',
    // A found bundle path also works for apps outside /Applications.
    args: ['-a', appPath ?? spec.macApp, pos.filePath],
    lineNavigation: false,
  });
  return attempts;
}

/** How the configured editor will be launched, for the startup log. */
function describeEditor(editor: string): string {
  const [first] = getLaunchAttempts(editor, { filePath: '/x', line: '1', col: '1' });
  return first ? `${editor} via ${first.description}` : `${editor} (unknown editor)`;
}

const LAUNCH_CONFIRM_MS = 1500;

/**
 * Spawns a detached process and reports whether the launch worked.
 * `spawn` reports a missing executable (ENOENT) asynchronously through the `'error'` event,
 * not by throwing, so a try/catch alone neither detects the failure nor prevents the
 * unhandled `'error'` event from crashing the server. Launchers such as `open` or an
 * editor CLI exit quickly, so a non-zero exit within a short window (e.g. `open -a` with
 * an unknown app) is a failure; a process still running after it (an IDE starting in the
 * foreground) counts as launched.
 */
function spawnDetached(label: string, cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      child?.stderr?.destroy();
      resolve(ok);
    };

    let child: childProcess.ChildProcess | undefined;
    try {
      child = childProcess.spawn(cmd, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`[file-opener] ${label} failed: ${message}`);
      settle(false);
      return;
    }

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 500) stderr += chunk;
    });
    child.once('error', (e) => {
      console.log(`[file-opener] ${label} failed: ${e.message}`);
      settle(false);
    });
    child.once('exit', (code) => {
      if (code === 0) {
        settle(true);
        return;
      }
      console.log(
        `[file-opener] ${label} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
      );
      settle(false);
    });
    child.once('spawn', () => {
      child!.unref();
      setTimeout(() => settle(true), LAUNCH_CONFIRM_MS).unref();
    });
  });
}

type LaunchResult = { ok: boolean; lineNavigation: boolean };

async function launchInEditor(
  pos: FilePosition,
  preferred = DEFAULT_EDITOR,
): Promise<LaunchResult> {
  if (process.env.EDITOR_CMD) {
    const [cmd, ...rest] = process.env.EDITOR_CMD.split(' ');
    const fileWithPos = `${pos.filePath}:${pos.line}:${pos.col}`;
    if (await spawnDetached('EDITOR_CMD', cmd, [...rest, fileWithPos])) {
      return { ok: true, lineNavigation: true };
    }
  }

  const editors = [preferred];
  if (FALLBACK_EDITOR && FALLBACK_EDITOR !== preferred) editors.push(FALLBACK_EDITOR);

  for (const editor of editors) {
    for (const attempt of getLaunchAttempts(editor, pos)) {
      if (await spawnDetached(`${editor} (${attempt.description})`, attempt.cmd, attempt.args)) {
        return { ok: true, lineNavigation: attempt.lineNavigation };
      }
    }
  }

  return { ok: false, lineNavigation: false };
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

    const { ok, lineNavigation } = await launchInEditor({ filePath: safePath, line, col });

    if (!ok) {
      res.statusCode = 500;
      res.end('Failed to launch editor. Check PATH or set EDITOR_CMD.');
      return;
    }
    res.end(lineNavigation ? 'ok' : 'ok (opened without line navigation)');
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

      const { ok, lineNavigation } = await launchInEditor({
        filePath: safePath,
        line: String(bestLine),
        col: '1',
      });

      if (!ok) {
        res.statusCode = 500;
        res.end('Failed to launch editor');
        return;
      }

      res.end(
        lineNavigation
          ? `Opened at line ${bestLine}`
          : `Opened without line navigation (best line: ${bestLine})`,
      );
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
    console.log(` - editor: ${describeEditor(DEFAULT_EDITOR)}`);
    console.log(` - fallback: ${describeEditor(FALLBACK_EDITOR)}`);
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
