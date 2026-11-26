import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { distNode, getFreePort, makeTempDir, waitForOutput } from './helpers.mjs';

const TEMPLATE = ['<h1>title</h1>', '<p>* required</p>', '<span>C++ (beta</span>', ''].join('\n');

/**
 * Starts the opener in a temp workspace. The configured editors don't exist,
 * so only EDITOR_CMD can launch anything.
 */
async function startOpener(t, editorCmd, { authToken } = {}) {
  const workspace = makeTempDir('opener');
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(path.join(workspace, 'src', 'a.html'), TEMPLATE);

  if (authToken) {
    fs.mkdirSync(path.join(workspace, '.open-in-editor'));
    fs.writeFileSync(path.join(workspace, '.open-in-editor', 'auth-token'), `${authToken}\n`);
  }

  const port = await getFreePort();
  fs.writeFileSync(
    path.join(workspace, 'ngx-locatorjs.config.json'),
    JSON.stringify({ port, editor: 'no-such-editor', fallbackEditor: 'no-such-fallback' }),
  );

  const child = spawn(process.execPath, [path.join(distNode, 'file-opener.js')], {
    cwd: workspace,
    env: { ...process.env, EDITOR_CMD: editorCmd },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  await waitForOutput(child, '[file-opener] http://');

  // node:http instead of fetch, because fetch cannot override the Host header.
  const request = (pathname, params, headers = {}) =>
    new Promise((resolve, reject) => {
      const url = new URL(pathname, `http://127.0.0.1:${port}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const req = http.get(url, { headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
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

test('files that do not exist are rejected with 403', async (t) => {
  const { request } = await startOpener(t, `${process.execPath} -e 0`);

  const res = await request('/__open-in-editor', { file: 'src/missing.html' });
  assert.equal(res.status, 403);
});
