import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { distNode, getFreePort, makeTempDir } from './helpers.mjs';

/** A workspace whose node_modules resolves @angular/core at `angularVersion` (or not at all). */
function makeWorkspace(t, angularVersion) {
  const workspace = makeTempDir('cli');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"app","private":true}');
  fs.mkdirSync(path.join(workspace, 'src'));
  if (angularVersion) {
    const core = path.join(workspace, 'node_modules', '@angular', 'core');
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(
      path.join(core, 'package.json'),
      JSON.stringify({ name: '@angular/core', version: angularVersion }),
    );
  }
  return workspace;
}

function runCli(workspace, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(distNode, 'cli.js'), ...args], {
      cwd: workspace,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output }));
  });
}

// A stand-in dev server: waits until the opener answers, then exits with code 7.
const DEV_COMMAND = (port) => [
  process.execPath,
  '-e',
  `const http = require('http');
   const tryOnce = () => http.get('http://127.0.0.1:${port}/__cmp-map', () => process.exit(7))
     .on('error', () => setTimeout(tryOnce, 100));
   tryOnce();`,
];

test('runs the opener next to a dev command and exits with its code', async (t) => {
  const workspace = makeWorkspace(t, '22.0.0');
  const port = await getFreePort();

  const { code, output } = await runCli(workspace, ['--', ...DEV_COMMAND(port)], {
    OPEN_IN_EDITOR_PORT: String(port),
  });

  assert.equal(code, 7, output);
  assert.match(output, /\[file-opener\] http:\/\/127\.0\.0\.1:\d+/);
  // Angular 19+: located from debug info, so no scan.
  assert.match(output, /Angular 22: .*scan skipped/);
  assert.doesNotMatch(output, /\[cmp-scan\]/);
});

test('scans and watches below Angular 19', async (t) => {
  const workspace = makeWorkspace(t, '17.3.0');
  const port = await getFreePort();

  const { code, output } = await runCli(workspace, ['--', ...DEV_COMMAND(port)], {
    OPEN_IN_EDITOR_PORT: String(port),
  });

  assert.equal(code, 7, output);
  assert.match(output, /Angular 17: scanning components/);
  assert.match(output, /watch enabled/);
});

test('--help lists the commands', async (t) => {
  const workspace = makeWorkspace(t, null);
  const { code, output } = await runCli(workspace, ['--help']);
  assert.equal(code, 0);
  assert.match(output, /npx ngx-locatorjs \[options\] -- <command>/);
  assert.match(output, /import\('ngx-locatorjs\/auto'\)/);
});
