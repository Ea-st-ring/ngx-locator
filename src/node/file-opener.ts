#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';

const root = process.cwd();
const CONFIG_FILENAME = 'ngx-locatorjs.config.json';
const configPath = path.resolve(root, CONFIG_FILENAME);

if (!fs.existsSync(configPath)) {
  console.log(`🚀 ${CONFIG_FILENAME} not found!`);
  console.log('Please run: npx locatorjs-config');
  console.log('Or manually create the config file.');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
  port?: number;
  editor?: string;
  fallbackEditor?: string;
};

const PORT = Number(process.env.OPEN_IN_EDITOR_PORT || cfg.port || 4123);
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
    } catch (e: any) {
      console.log(`[file-opener] EDITOR_CMD failed: ${e.message}`);
    }
  }

  const tryRun = (editor: string) => {
    const mk = COMMAND_TEMPLATES[editor];
    if (!mk) return false;
    const [cmd, args] = mk(fileWithPos);
    try {
      childProcess.spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
      return true;
    } catch (e: any) {
      console.log(`[file-opener] ${editor} failed: ${e.message}`);
      return false;
    }
  };

  if (tryRun(preferred)) return true;
  if (FALLBACK_EDITOR && tryRun(FALLBACK_EDITOR)) return true;

  return false;
}

const app = express();

app.get('/__cmp-map', (req, res) => {
  if (!fs.existsSync(MAP_PATH)) return res.status(404).send('component-map.json not found');
  res.setHeader('Content-Type', 'application/json');
  fs.createReadStream(MAP_PATH).pipe(res);
});

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
  } catch (e: any) {
    console.warn(`[file-opener] Failed to search in file: ${e.message}`);
    return 1;
  }
}

app.get('/__open-in-editor', (req, res) => {
  let file = req.query.file as string | undefined;
  const line = (req.query.line as string) || '1';
  const col = (req.query.col as string) || '1';

  if (!file) return res.status(400).send('file is required');
  file = decodeURIComponent(file);

  console.log(`[file-opener] Opening file: ${file}:${line}:${col}`);

  const fileWithPos = `${file}:${line}:${col}`;
  const ok = launchInEditor(fileWithPos);

  if (!ok) {
    return res.status(500).send('Failed to launch editor. Check PATH or set EDITOR_CMD.');
  }
  res.end('ok');
});

app.get('/__open-in-editor-search', (req, res) => {
  let file = req.query.file as string | undefined;
  const searchParam = req.query.search as string | undefined;

  if (!file) return res.status(400).send('file is required');
  if (!searchParam) return res.status(400).send('search terms required');

  file = decodeURIComponent(file);

  try {
    const searchTerms = JSON.parse(decodeURIComponent(searchParam));
    const bestLine = findBestLineInFile(file, searchTerms);

    const fileWithPos = `${file}:${bestLine}:1`;
    const ok = launchInEditor(fileWithPos);

    if (!ok) {
      return res.status(500).send('Failed to launch editor');
    }

    res.end(`Opened at line ${bestLine}`);
  } catch (e: any) {
    console.warn(`[file-opener] Search error: ${e.message}`);
    res.status(500).send('Search failed: ' + e.message);
  }
});

app
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
  })
  .on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.log(
        `[file-opener] Port ${PORT} already in use - another file:opener is already running`,
      );
      process.exit(0);
    } else {
      console.error('[file-opener] Server error:', err);
      process.exit(1);
    }
  });
