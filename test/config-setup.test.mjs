import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { distNode, makeTempDir } from './helpers.mjs';

const GENERATED_PROXY = 'ngx-locatorjs.proxy.cjs';
const USER_PROXY = "module.exports = { '/api': { target: 'http://localhost:8080' } };\n";

function makeWorkspace(t, proxyConfig) {
  const workspace = makeTempDir('setup');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(
    path.join(workspace, 'angular.json'),
    JSON.stringify({
      projects: {
        app: { sourceRoot: 'src', architect: { serve: { options: { proxyConfig } } } },
      },
    }),
  );
  return workspace;
}

/** Runs locatorjs-config non-interactively, answering each prompt in order. */
function runSetup(workspace, answers) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(distNode, 'config-setup.js')], {
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let answered = 0;
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      // Answer one prompt at a time, so readline doesn't swallow later answers early.
      const prompts = (output.match(/\(y\/N\): |Enter number/g) ?? []).length;
      while (answered < prompts && answered < answers.length) {
        child.stdin.write(`${answers[answered++]}\n`);
        // An open stdin pipe keeps the CLI alive after its last prompt.
        if (answered === answers.length) child.stdin.end();
      }
    });
    child.stderr.on('data', (chunk) => (output += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output }));
  });
}

test('an existing user proxy referenced by angular.json is not overwritten', async (t) => {
  const workspace = makeWorkspace(t, 'proxy.conf.js');
  const userProxyPath = path.join(workspace, 'proxy.conf.js');
  fs.writeFileSync(userProxyPath, USER_PROXY);

  const { code, output } = await runSetup(workspace, ['1']);

  assert.equal(code, 0, output);
  assert.equal(fs.readFileSync(userProxyPath, 'utf8'), USER_PROXY);
  assert.ok(fs.existsSync(path.join(workspace, GENERATED_PROXY)), 'generated proxy expected');
  assert.match(output, /will not be modified/);
});

test('a previously generated proxy referenced by angular.json is regenerated in place', async (t) => {
  const workspace = makeWorkspace(t, GENERATED_PROXY);

  const first = await runSetup(workspace, ['1']);
  assert.equal(first.code, 0, first.output);
  const generatedPath = path.join(workspace, GENERATED_PROXY);
  fs.appendFileSync(generatedPath, '// stale\n');

  const second = await runSetup(workspace, ['y', '1']);
  assert.equal(second.code, 0, second.output);
  assert.doesNotMatch(second.output, /will not be modified/);
  assert.doesNotMatch(fs.readFileSync(generatedPath, 'utf8'), /stale/);
});

test('the auth token is written to a gitignored file instead of the shared config', async (t) => {
  const workspace = makeWorkspace(t, GENERATED_PROXY);

  const { code, output } = await runSetup(workspace, ['1']);
  assert.equal(code, 0, output);

  const config = JSON.parse(
    fs.readFileSync(path.join(workspace, 'ngx-locatorjs.config.json'), 'utf8'),
  );
  assert.equal(config.authToken, undefined);

  const token = fs
    .readFileSync(path.join(workspace, '.open-in-editor', 'auth-token'), 'utf8')
    .trim();
  assert.match(token, /^[0-9a-f]{48}$/);
  const nestedIgnore = fs.readFileSync(
    path.join(workspace, '.open-in-editor', '.gitignore'),
    'utf8',
  );
  assert.match(nestedIgnore, /^auth-token$/m);

  // The generated proxy module must forward the same token.
  const headers = JSON.parse(
    execFileSync(
      process.execPath,
      ['-e', `console.log(JSON.stringify(require('./${GENERATED_PROXY}')['/__cmp-map'].headers))`],
      { cwd: workspace, encoding: 'utf8' },
    ),
  );
  assert.deepEqual(headers, { 'x-locatorjs-token': token });
});

test('declining to overwrite a shared config still creates a local auth token', async (t) => {
  const workspace = makeWorkspace(t, GENERATED_PROXY);
  fs.writeFileSync(
    path.join(workspace, 'ngx-locatorjs.config.json'),
    JSON.stringify({ port: 4123 }),
  );

  const { code, output } = await runSetup(workspace, ['n']);
  assert.equal(code, 0, output);
  assert.ok(fs.existsSync(path.join(workspace, '.open-in-editor', 'auth-token')));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(workspace, 'ngx-locatorjs.config.json'), 'utf8')),
    { port: 4123 },
  );
});
