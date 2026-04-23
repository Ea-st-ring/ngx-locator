#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';
import http from 'http';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

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
  'src/**/*.{ts,tsx}',
  'projects/**/*.{ts,tsx}',
  'apps/**/*.{ts,tsx}',
  'libs/**/*.{ts,tsx}',
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
const AUTH_TOKEN = (process.env.OPEN_IN_EDITOR_TOKEN || cfg.authToken || '').trim() || null;
const WORKSPACE_ROOT = path.resolve(root, scanWorkspaceRoot);
const MAP_PATH = path.resolve(root, '.open-in-editor/component-map.json');
const SAFE_WATCH_DIR_NAMES = new Set(['node_modules', 'dist', '.git', '.angular', 'coverage']);

const editorCLICache: Record<string, boolean> = {};
function checkEditorCLI(editorName: string, cliCommand = editorName) {
  if (editorCLICache[editorName] !== undefined) return editorCLICache[editorName];

  try {
    childProcess.execSync(`which ${cliCommand}`, { stdio: 'ignore' });
    editorCLICache[editorName] = true;
    console.log(`[file-opener] ${editorName} CLI found, using precise line navigation`);
  } catch {
    editorCLICache[editorName] = false;
    console.log(`[file-opener] ${editorName} CLI not found, using fallback method`);
  }
  return editorCLICache[editorName];
}

const MAC_APP_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  code: 'Visual Studio Code',
  webstorm: 'WebStorm',
};

function detectAvailableEditors() {
  const editors = ['cursor', 'code', 'webstorm'];
  const available: Array<{ name: string; hasCliPrecision: boolean }> = [];

  for (const editor of editors) {
    if (checkEditorCLI(editor)) {
      available.push({ name: editor, hasCliPrecision: true });
    }
  }

  return available;
}

const AVAILABLE_EDITORS = detectAvailableEditors();
const DEFAULT_EDITOR =
  process.env.LAUNCH_EDITOR || cfg.editor || AVAILABLE_EDITORS[0]?.name || 'cursor';
const FALLBACK_EDITOR = cfg.fallbackEditor || AVAILABLE_EDITORS[1]?.name || 'code';

const COMMAND_TEMPLATES: Record<string, (file: string) => [string, string[]]> = {
  cursor: (file) => {
    if (checkEditorCLI('cursor')) {
      return ['cursor', ['--goto', file]];
    }
    const filePath = file.split(':')[0];
    return ['open', ['-a', MAC_APP_NAMES.cursor, filePath]];
  },

  code: (file) => {
    if (checkEditorCLI('code')) {
      return ['code', ['--goto', file]];
    }
    const filePath = file.split(':')[0];
    return ['open', ['-a', MAC_APP_NAMES.code, filePath]];
  },

  webstorm: (file) => {
    if (checkEditorCLI('webstorm')) {
      const [filePath, line, col] = file.split(':');
      const args = [filePath];
      if (line) args.push('--line', line);
      if (col) args.push('--column', col);
      return ['webstorm', args];
    }
    const filePath = file.split(':')[0];
    return ['open', ['-a', MAC_APP_NAMES.webstorm, filePath]];
  },
};

function launchInEditor(fileWithPos: string, preferred = DEFAULT_EDITOR) {
  if (process.env.EDITOR_CMD) {
    const [cmd, ...rest] = process.env.EDITOR_CMD.split(' ');
    try {
      childProcess.spawn(cmd, [...rest, fileWithPos], { stdio: 'ignore', detached: true }).unref();
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`[file-opener] EDITOR_CMD failed: ${message}`);
    }
  }

  const tryRun = (editor: string) => {
    const mk = COMMAND_TEMPLATES[editor];
    if (!mk) return false;
    const [cmd, args] = mk(fileWithPos);
    try {
      childProcess.spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`[file-opener] ${editor} failed: ${message}`);
      return false;
    }
  };

  if (tryRun(preferred)) return true;
  if (FALLBACK_EDITOR && tryRun(FALLBACK_EDITOR)) return true;

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
            new RegExp(`\\b${lowerTerm.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`).test(lowerLine)
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

function ensureAuthorized(req: http.IncomingMessage, url: URL): boolean {
  if (!AUTH_TOKEN) return true;

  const token = extractRequestToken(req, url);
  if (!token) return false;
  return safeCompareToken(token, AUTH_TOKEN);
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

const server = http.createServer((req, res) => {
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
    const line = url.searchParams.get('line') || '1';
    const col = url.searchParams.get('col') || '1';

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

    const fileWithPos = `${safePath}:${line}:${col}`;
    const ok = launchInEditor(fileWithPos);

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

      const fileWithPos = `${safePath}:${bestLine}:1`;
      const ok = launchInEditor(fileWithPos);

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
      console.log(' - auth: disabled (legacy config, run locatorjs-config to enable)');
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
