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
function runSetup(workspace, answers, { args = [], env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(distNode, 'config-setup.js'), ...args], {
      cwd: workspace,
      env: { ...process.env, ...env },
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

test('the generated proxy forwards only an explicitly configured token', async (t) => {
  const workspace = makeWorkspace(t, GENERATED_PROXY);

  const { code, output } = await runSetup(workspace, ['1']);
  assert.equal(code, 0, output);
  const config = JSON.parse(
    fs.readFileSync(path.join(workspace, 'ngx-locatorjs.config.json'), 'utf8'),
  );
  assert.equal(config.authToken, undefined);
  assert.equal(fs.existsSync(path.join(workspace, '.open-in-editor', 'auth-token')), false);

  const proxyHeaders = (env) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `console.log(JSON.stringify(require('./${GENERATED_PROXY}')['/__cmp-map'].headers))`,
        ],
        { cwd: workspace, encoding: 'utf8', env: { ...process.env, ...env } },
      ),
    );
  assert.deepEqual(proxyHeaders({ OPEN_IN_EDITOR_TOKEN: '' }), {});
  assert.deepEqual(proxyHeaders({ OPEN_IN_EDITOR_TOKEN: 'secret-1' }), {
    'x-locatorjs-token': 'secret-1',
  });
});

test('init (--no-proxy) writes only the config, never a proxy module', async (t) => {
  const workspace = makeWorkspace(t, 'proxy.conf.js');

  const { code, output } = await runSetup(workspace, ['1'], { args: ['--no-proxy'] });
  assert.equal(code, 0, output);
  assert.ok(fs.existsSync(path.join(workspace, 'ngx-locatorjs.config.json')));
  assert.equal(fs.existsSync(path.join(workspace, GENERATED_PROXY)), false);
  assert.equal(fs.existsSync(path.join(workspace, 'proxy.conf.js')), false);
  assert.match(output, /npx ngx-locatorjs -- ng serve/);
});
