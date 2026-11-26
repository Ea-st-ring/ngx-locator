import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { distNode, getFreePort, makeTempDir, waitForOutput } from './helpers.mjs';

const CARD_SOURCE = [
  "import { Component } from '@angular/core';",
  '',
  "@Component({ selector: 'app-card', templateUrl: `./a.html` })",
  'export class CardComponent {}',
  '',
  "@Component({ selector: 'app-inline', template: '<p>hi</p>' })",
  'export class InlineComponent {}',
  '',
].join('\n');

const TEMPLATE = ['<h1>title</h1>', '<p>* required</p>', '<span>C++ (beta</span>', ''].join('\n');

/**
 * Starts the opener in a temp workspace. The configured editors don't exist,
 * so only EDITOR_CMD can launch anything.
 */
async function startOpener(t, editorCmd, { env = {}, writeConfig = true } = {}) {
  const workspace = makeTempDir('opener');
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(path.join(workspace, 'src', 'a.html'), TEMPLATE);
  fs.writeFileSync(path.join(workspace, 'src', 'card.component.ts'), CARD_SOURCE);

  const port = await getFreePort();
  if (writeConfig) {
    fs.writeFileSync(
      path.join(workspace, 'ngx-locatorjs.config.json'),
      JSON.stringify({ port, editor: 'no-such-editor', fallbackEditor: 'no-such-fallback' }),
    );
  }

  const child = spawn(process.execPath, [path.join(distNode, 'file-opener.js')], {
    cwd: workspace,
    env: {
      ...process.env,
      EDITOR_CMD: editorCmd,
      ...(writeConfig ? {} : { OPEN_IN_EDITOR_PORT: String(port) }),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  await waitForOutput(child, '[file-opener] http://');

  // node:http instead of fetch, because fetch cannot override the Host header.
  // Sends the header the browser runtime always adds, unless a test overrides it.
  const request = (pathname, params, headers = {}, method = 'GET') =>
    new Promise((resolve, reject) => {
      const url = new URL(pathname, `http://127.0.0.1:${port}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const allHeaders = Object.fromEntries(
        Object.entries({ 'x-locatorjs-request': '1', ...headers }).filter(([, v]) => v !== null),
      );
      const req = http.request(url, { method, headers: allHeaders }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  return { child, request };
}

test('a missing editor command returns 500 without crashing the server', async (t) => {
  const { child, request } = await startOpener(t, 'definitely-not-a-real-editor-cmd');

  const first = await request('/__open-in-editor', { file: 'src/a.html', line: '2' });
  assert.equal(first.status, 500);

  // The ENOENT 'error' event used to be unhandled and killed the process.
  assert.equal(child.exitCode, null, 'server process should still be running');
  const second = await request('/__open-in-editor', { file: 'src/a.html' });
  assert.equal(second.status, 500);
});

test('search terms containing regex special characters find the right line', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);

  const required = await request('/__open-in-editor-search', {
    file: 'src/a.html',
    search: JSON.stringify(['* required']),
  });
  assert.deepEqual(
    { status: required.status, body: required.body },
    { status: 200, body: 'Opened at line 2' },
  );

  const cpp = await request('/__open-in-editor-search', {
    file: 'src/a.html',
    search: JSON.stringify(['C++ (beta']),
  });
  assert.deepEqual(
    { status: cpp.status, body: cpp.body },
    { status: 200, body: 'Opened at line 3' },
  );
});

test('files that do not exist are rejected with 403', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);

  const res = await request('/__open-in-editor', { file: 'src/missing.html' });
  assert.equal(res.status, 403);
});

test('cross-site browser requests are rejected, including through the proxy', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);

  const fromOtherSite = await request(
    '/__open-in-editor',
    { file: 'src/a.html' },
    { 'sec-fetch-site': 'cross-site', referer: 'https://evil.example/page' },
  );
  assert.equal(fromOtherSite.status, 403);

  const fromLocalPage = await request(
    '/__open-in-editor',
    { file: 'src/a.html' },
    { 'sec-fetch-site': 'cross-site', origin: 'http://localhost:4200' },
  );
  assert.equal(fromLocalPage.status, 200);

  const sameOrigin = await request(
    '/__open-in-editor',
    { file: 'src/a.html' },
    { 'sec-fetch-site': 'same-origin', origin: 'http://192.168.0.10:4200' },
  );
  assert.equal(sameOrigin.status, 200);
});

test('requests with a non-loopback Host header are rejected (DNS rebinding)', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);

  const res = await request('/__cmp-map', {}, { host: 'rebind.evil.example:4123' });
  assert.equal(res.status, 403);
});

test('an explicitly configured token is still enforced', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`, {
    env: { OPEN_IN_EDITOR_TOKEN: 'secret-1' },
  });

  const withoutToken = await request('/__open-in-editor', { file: 'src/a.html' });
  assert.equal(withoutToken.status, 401);

  const withToken = await request(
    '/__open-in-editor',
    { file: 'src/a.html' },
    { 'x-locatorjs-token': 'secret-1' },
  );
  assert.equal(withToken.status, 200);
});

test('requests without the x-locatorjs-request header are rejected', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);

  // What an <img> tag or a plain link on any page would send.
  const res = await request(
    '/__open-in-editor',
    { file: 'src/a.html' },
    {
      'x-locatorjs-request': null,
    },
  );
  assert.equal(res.status, 403);
});

test('CORS preflight is approved only for pages served from this machine', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);
  const preflight = (origin, extra = {}) =>
    request(
      '/__open-in-editor',
      {},
      {
        'x-locatorjs-request': null,
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-locatorjs-request',
        ...extra,
      },
      'OPTIONS',
    );

  const local = await preflight('http://localhost:4200', {
    'access-control-request-private-network': 'true',
  });
  assert.equal(local.status, 204);
  assert.equal(local.headers['access-control-allow-origin'], 'http://localhost:4200');
  assert.match(local.headers['access-control-allow-headers'], /x-locatorjs-request/);
  assert.equal(local.headers['access-control-allow-private-network'], 'true');

  const remote = await preflight('https://evil.example');
  assert.equal(remote.status, 403);
  assert.equal(remote.headers['access-control-allow-origin'], undefined);

  // The real request from the local page gets the CORS header too.
  const actual = await request(
    '/__open-in-editor',
    { file: 'src/a.html' },
    {
      origin: 'http://localhost:4200',
      'sec-fetch-site': 'cross-site',
    },
  );
  assert.equal(actual.status, 200);
  assert.equal(actual.headers['access-control-allow-origin'], 'http://localhost:4200');
});

test('the opener runs with defaults when there is no config file', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`, { writeConfig: false });

  const res = await request('/__open-in-editor', { file: 'src/a.html' });
  assert.equal(res.status, 200);
});

test('resolve returns the component files for a debug-info path and class name', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);

  const card = await request('/__open-in-editor-resolve', {
    file: 'src/card.component.ts',
    className: 'CardComponent',
  });
  assert.equal(card.status, 200);
  const body = JSON.parse(card.body);
  assert.equal(body.className, 'CardComponent');
  assert.match(body.filePath, /src[\\/]card\.component\.ts$/);
  assert.match(body.templateUrl, /src[\\/]a\.html$/);
  assert.equal(body.line, 4);

  const inline = await request('/__open-in-editor-resolve', {
    file: 'src/card.component.ts',
    className: 'InlineComponent',
  });
  assert.equal(JSON.parse(inline.body).templateUrl, null);

  const unknown = await request('/__open-in-editor-resolve', {
    file: 'src/card.component.ts',
    className: 'MissingComponent',
  });
  assert.equal(unknown.status, 404);

  const outside = await request('/__open-in-editor-resolve', {
    file: process.execPath,
    className: 'CardComponent',
  });
  assert.equal(outside.status, 403);
});

test('a launcher that exits with an error counts as a failure, not a success', async (t) => {
  // Like `open -a "Unknown App"`: the process starts, then exits non-zero right away.
  const { request } = await startOpener(t, `${process.execPath} -e process.exit(1)`);

  const res = await request('/__open-in-editor', { file: 'src/a.html' });
  assert.equal(res.status, 500);
});
