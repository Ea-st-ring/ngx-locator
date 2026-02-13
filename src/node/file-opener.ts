#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';
import http from 'http';
import { spawn } from 'child_process';
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
  editor?: string;
  fallbackEditor?: string;
  workspaceRoot?: string;
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

const PORT = Number(process.env.OPEN_IN_EDITOR_PORT || cfgPort || 4123);
const MAP_PATH = path.resolve(root, '.open-in-editor/component-map.json');

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

  const recursive = process.platform === 'darwin' || process.platform === 'win32';
  const watchers: fs.FSWatcher[] = [];
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
    timer = setTimeout(() => runScan(reason), 500);
  };

  const attachWatcher = (watchPath: string) => {
    try {
      const watcher = fs.watch(watchPath, { recursive }, (eventType, filename) => {
        const detail = filename ? `${eventType}:${filename.toString()}` : eventType;
        scheduleScan(detail);
      });
      watchers.push(watcher);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[file-opener] failed to watch ${watchPath}: ${message}`);
      throw err;
    }
  };

  try {
    roots.forEach(attachWatcher);
    console.log(
      `[file-opener] watch enabled (${recursive ? 'recursive' : 'non-recursive'}): ${roots.join(
        ', ',
      )}`,
    );
  } catch {
    watchers.forEach((w) => w.close());
    console.log('[file-opener] falling back to polling scan every 5s');
    setInterval(() => runScan('poll'), 5000);
  }

  runScan('initial');
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

    const decoded = decodeURIComponent(file);
    console.log(`[file-opener] Opening file: ${decoded}:${line}:${col}`);

    const fileWithPos = `${decoded}:${line}:${col}`;
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

    const decoded = decodeURIComponent(file);

    try {
      const searchTerms = JSON.parse(decodeURIComponent(searchParam));
      const bestLine = findBestLineInFile(decoded, searchTerms);

      const fileWithPos = `${decoded}:${bestLine}:1`;
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
  .listen(PORT, () => {
    console.log(`[file-opener] http://localhost:${PORT}`);
    console.log(` - map: ${path.relative(root, MAP_PATH)}`);
    console.log(` - editor: ${DEFAULT_EDITOR} (fallback: ${FALLBACK_EDITOR})`);

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
