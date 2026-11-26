// The browser runtime calling the real opener directly (cross-origin, CORS), with no
// dev-server proxy and no config file. Skipped locally when no Playwright browser exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { distNode, getFreePort, makeTempDir, repoRoot, waitForOutput } from './helpers.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  chromium = null;
}
const canLaunch = await (async () => {
  if (!chromium) return false;
  try {
    await (await chromium.launch({ headless: true })).close();
    return true;
  } catch {
    return false;
  }
})();
const browserTest = canLaunch || process.env.CI ? test : test.skip;

const CARD_SOURCE = [
  "import { Component } from '@angular/core';",
  '',
  "@Component({ selector: 'app-card', templateUrl: './card.component.html' })",
  'export class CardComponent {}',
  '',
].join('\n');
const CARD_TEMPLATE = [
  '<section>',
  '  <h2>Card</h2>',
  '  <button>Buy</button>',
  '</section>',
  '',
].join('\n');

/** Starts the real opener with no config file; EDITOR_CMD records what it was asked to open. */
async function startOpener(t) {
  const workspace = makeTempDir('direct');
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(path.join(workspace, 'src', 'card.component.ts'), CARD_SOURCE);
  fs.writeFileSync(path.join(workspace, 'src', 'card.component.html'), CARD_TEMPLATE);
  const log = path.join(workspace, 'opened.log');
  const recorder = path.join(workspace, 'recorder.cjs');
  fs.writeFileSync(
    recorder,
    `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`,
  );

  const port = await getFreePort();
  const child = spawn(process.execPath, [path.join(distNode, 'file-opener.js')], {
    cwd: workspace,
    env: {
      ...process.env,
      OPEN_IN_EDITOR_PORT: String(port),
      EDITOR_CMD: `${process.execPath} ${recorder}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  await waitForOutput(child, '[file-opener] http://');
  const opened = () =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { port, workspace, opened };
}

// An Angular 19+ style component: debug info carries the source file, so no map is needed.
const page = (openerUrl) => `<!doctype html>
<html><body style="margin:0">
<app-card style="display:block;padding:30px;width:300px"><button id="buy" style="width:120px;height:40px">Buy</button></app-card>
<script type="module">
  class CardComponent {}
  CardComponent['\\u0275cmp'] = { debugInfo: { className: 'CardComponent', filePath: 'src/card.component.ts', lineNumber: 4 } };
  const card = new CardComponent();
  window.ng = {
    getOwningComponent: (el) => (el.id === 'buy' ? card : null),
    getHostElement: () => document.querySelector('app-card'),
  };
  const { installAngularLocator } = await import('/locator.js');
  await installAngularLocator({ enableNetwork: true, showClickFeedback: false, openerUrl: ${JSON.stringify(openerUrl)} });
  window.__locatorReady = true;
</script>
</body></html>`;

/** The dev app: serves the page and runtime; answers /__ routes like a dev server without a proxy. */
async function startApp(t, html) {
  const locatorJs = fs.readFileSync(path.join(repoRoot, 'dist/browser/index.js'));
  const server = http.createServer((req, res) => {
    if (req.url === '/locator.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(locatorJs);
    }
    if (req.url.startsWith('/__')) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://localhost:${server.address().port}`;
}

async function altClick(t, appUrl) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const tab = await browser.newPage();
  await tab.goto(appUrl);
  await tab.waitForFunction(() => window.__locatorReady === true);
  const box = await tab.locator('#buy').boundingBox();
  await tab.keyboard.down('Alt');
  await tab.mouse.click(box.x + 10, box.y + 10);
  await tab.keyboard.up('Alt');
}

async function waitFor(fn, label) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

browserTest('the runtime opens files through the opener directly, without a proxy', async (t) => {
  const opener = await startOpener(t);
  const appUrl = await startApp(t, page(`http://127.0.0.1:${opener.port}`));

  await altClick(t, appUrl);
  const [entry] = await waitFor(() => opener.opened().length && opener.opened(), 'open');
  // Resolved from debug info by the opener, then the line of the clicked <button>.
  assert.match(entry, /src[\\/]card\.component\.html:3:1$/);
});

browserTest('a non-opener server on the opener port is skipped for the proxy route', async (t) => {
  // Something else answers on the configured opener URL (no X-Locatorjs-Opener header).
  const impostor = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.end('not the opener');
  });
  const impostorPort = await getFreePort();
  await new Promise((resolve) => impostor.listen(impostorPort, '127.0.0.1', resolve));
  t.after(() => impostor.close());

  const opener = await startOpener(t);
  // The app proxies /__ routes to the real opener, like the older proxy setup.
  const locatorJs = fs.readFileSync(path.join(repoRoot, 'dist/browser/index.js'));
  const html = page(`http://127.0.0.1:${impostorPort}`);
  const app = http.createServer((req, res) => {
    if (req.url === '/locator.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(locatorJs);
    }
    if (req.url.startsWith('/__')) {
      const upstream = http.request(
        { host: '127.0.0.1', port: opener.port, path: req.url, headers: req.headers },
        (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        },
      );
      // The browser may drop a request while the test tears down; don't crash the test on it.
      upstream.on('error', () => res.destroy());
      req.on('error', () => upstream.destroy());
      return req.pipe(upstream);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());

  await altClick(t, `http://localhost:${app.address().port}`);
  const [entry] = await waitFor(() => opener.opened().length && opener.opened(), 'open');
  assert.match(entry, /src[\\/]card\.component\.html:3:1$/);
});
