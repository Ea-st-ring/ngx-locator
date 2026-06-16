#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workRoot = path.resolve(
  process.env.LOCATOR_ANGULAR_E2E_ROOT || path.join(os.tmpdir(), 'ngx-locatorjs-angular-e2e'),
);
const npmCache = path.join(workRoot, '.npm-cache');
const resultsPath = path.join(workRoot, 'results.json');

const versions = (
  process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['15.2.11', '16.2.16', '17.3.17', '18.2.21', '19.2.27', '20.3.28', '21.2.15', '22.0.1']
)
  .map((version) => version.trim())
  .filter(Boolean);

function resolveBin(name) {
  const envName = `${name.toUpperCase()}_BIN`;
  if (process.env[envName]) return process.env[envName];
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim();
  } catch {
    return name;
  }
}

const npmBin = resolveBin('npm');
const npxBin = resolveBin('npx');

function run(command, args, options = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        npm_config_cache: npmCache,
        NG_CLI_ANALYTICS: 'false',
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (options.input) child.stdin.write(options.input);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!options.quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!options.quiet) process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      resolve({
        command,
        args,
        code: 1,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}\n${error.message}`,
      });
    });
    child.on('close', (code) => {
      resolve({
        command,
        args,
        code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      NG_CLI_ANALYTICS: 'false',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdoutText = '';
  child.stderrText = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    child.stdoutText += text;
    if (!options.quiet) process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    child.stderrText += text;
    if (!options.quiet) process.stderr.write(text);
  });
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function summarizeFailure(result) {
  return `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
    .join('\n');
}

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

function createRecorder(recorderPath, outputPath) {
  fs.writeFileSync(
    recorderPath,
    `#!/usr/bin/env node
import fs from 'node:fs';
const outputPath = process.env.LOCATOR_E2E_RECORDER_LOG;
const fileWithPos = process.argv.at(-1);
fs.appendFileSync(outputPath, JSON.stringify({
  fileWithPos,
  args: process.argv.slice(2),
  at: new Date().toISOString(),
}) + '\\n');
`,
  );
  fs.chmodSync(recorderPath, 0o755);
  fs.writeFileSync(outputPath, '');
}

function readRecorderEntries(outputPath) {
  if (!fs.existsSync(outputPath)) return [];
  return fs
    .readFileSync(outputPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function packLocalPackage() {
  fs.mkdirSync(workRoot, { recursive: true });
  fs.mkdirSync(npmCache, { recursive: true });
  const pack = await run(npmBin, ['--cache', npmCache, 'pack', '--pack-destination', workRoot], {
    cwd: repoRoot,
  });
  if (pack.code !== 0) {
    throw new Error(`npm pack failed:\n${summarizeFailure(pack)}`);
  }
  const tarball = pack.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .at(-1);
  if (!tarball) throw new Error(`Could not find tarball in npm pack output:\n${pack.stdout}`);
  return path.join(workRoot, tarball);
}

function injectRuntimeHook(projectDir) {
  const mainPath = path.join(projectDir, 'src', 'main.ts');
  const current = fs.readFileSync(mainPath, 'utf8');
  fs.writeFileSync(
    mainPath,
    `${current}

setTimeout(() => {
  import('ngx-locatorjs')
    .then((m) => m.installAngularLocator({ enableNetwork: true, debug: true }))
    .catch((err) => console.warn('[angular-locator] Failed to load:', err));
}, 1000);
`,
  );
}

function componentMapSummary(projectDir) {
  const mapPath = path.join(projectDir, '.open-in-editor', 'component-map.json');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const entries = Object.values(map.detailByFilePath ?? {});
  return {
    count: entries.length,
    entries,
  };
}

async function waitForHttpOk(url) {
  return waitFor(
    () =>
      new Promise((resolve) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
          req.destroy();
          resolve(false);
        });
      }),
    90000,
    url,
  );
}

async function verifyBrowser(projectDir, version, port, recorderLogPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[Angular ${version}] browser error: ${msg.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('app-root', { timeout: 30000 });
    await page.waitForFunction(
      () => Boolean(window.ng?.getOwningComponent || window.ng?.getComponent),
      null,
      { timeout: 30000 },
    );
    await page.waitForFunction(
      () => Boolean(document.getElementById('angular-locator-styles')),
      null,
      { timeout: 30000 },
    );
    await page.waitForFunction(
      async () => {
        const res = await fetch('/__cmp-map?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return false;
        const map = await res.json();
        return Object.keys(map.detailByFilePath || {}).length > 0;
      },
      null,
      { timeout: 30000 },
    );

    const target = page.locator('app-root').locator('a, button, h1, p, div').first();
    await target.waitFor({ timeout: 30000 });
    const box = await target.boundingBox();
    if (!box) throw new Error('Could not locate an interactable element inside app-root');
    const x = box.x + Math.min(box.width / 2, 20);
    const y = box.y + Math.min(box.height / 2, 20);

    await page.keyboard.down('Alt');
    await page.mouse.move(x, y);
    await page.waitForSelector('.dev-highlight-overlay', { timeout: 10000 });
    await page.waitForSelector('.dev-tooltip', { timeout: 10000 });
    const tooltipText = await page.locator('.dev-tooltip').first().textContent();
    if (!tooltipText?.includes('App')) {
      throw new Error(`Tooltip did not include component name: ${tooltipText}`);
    }

    const beforeTemplate = readRecorderEntries(recorderLogPath).length;
    await page.mouse.click(x, y);
    const templateEntry = await waitFor(
      () => {
        const entries = readRecorderEntries(recorderLogPath);
        return entries.length > beforeTemplate ? entries.at(-1) : null;
      },
      10000,
      'template open recorder entry',
    );

    const beforeComponent = readRecorderEntries(recorderLogPath).length;
    await page.keyboard.down('Shift');
    await page.mouse.click(x, y);
    await page.keyboard.up('Shift');
    const componentEntry = await waitFor(
      () => {
        const entries = readRecorderEntries(recorderLogPath);
        return entries.length > beforeComponent ? entries.at(-1) : null;
      },
      10000,
      'component open recorder entry',
    );
    await page.keyboard.up('Alt');

    const expectedTemplate =
      Number(version.split('.')[0]) >= 20 ? 'app.html' : 'app.component.html';
    const expectedComponent = Number(version.split('.')[0]) >= 20 ? 'app.ts' : 'app.component.ts';
    if (!templateEntry.fileWithPos?.includes(expectedTemplate)) {
      throw new Error(
        `Expected template open for ${expectedTemplate}, got ${templateEntry.fileWithPos}`,
      );
    }
    if (!componentEntry.fileWithPos?.includes(expectedComponent)) {
      throw new Error(
        `Expected component open for ${expectedComponent}, got ${componentEntry.fileWithPos}`,
      );
    }

    return {
      tooltipText,
      templateOpen: templateEntry.fileWithPos,
      componentOpen: componentEntry.fileWithPos,
    };
  } finally {
    await browser.close();
  }
}

async function testVersion(version, tarballPath) {
  const major = version.split('.')[0];
  const projectName = `nge2e${major}`;
  const projectDir = path.join(workRoot, projectName);
  const appPort = 4600 + Number(major);
  const openerPort = 5600 + Number(major);
  const recorderPath = path.join(workRoot, `recorder-${major}.mjs`);
  const recorderLogPath = path.join(workRoot, `recorder-${major}.jsonl`);
  let openerProcess;
  let serveProcess;

  const result = {
    cliVersion: version,
    projectName,
    projectDir,
    appPort,
    openerPort,
    status: 'unknown',
    componentCount: null,
    steps: [],
    browser: null,
    recorderLogPath,
  };

  async function step(name, fn) {
    const startedAt = Date.now();
    console.log(`\n[Angular ${version}] ${name}`);
    try {
      const value = await fn();
      result.steps.push({ name, code: 0, durationMs: Date.now() - startedAt });
      return value;
    } catch (error) {
      result.steps.push({
        name,
        code: 1,
        durationMs: Date.now() - startedAt,
        failureSummary: error instanceof Error ? error.message : String(error),
      });
      result.status = `${name}_failed`;
      throw error;
    }
  }

  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
    createRecorder(recorderPath, recorderLogPath);

    await step('create-project', async () => {
      const create = await run(
        npxBin,
        [
          '--yes',
          `@angular/cli@${version}`,
          'new',
          projectName,
          '--directory',
          projectName,
          '--skip-git',
          '--skip-tests',
          '--defaults',
          '--package-manager',
          'npm',
        ],
        { cwd: workRoot },
      );
      if (create.code !== 0) throw new Error(summarizeFailure(create));
    });

    await step('install-locator', async () => {
      const install = await run(npmBin, ['install', '--save-dev', tarballPath], {
        cwd: projectDir,
      });
      if (install.code !== 0) throw new Error(summarizeFailure(install));
    });

    await step('inject-runtime-hook', async () => injectRuntimeHook(projectDir));

    await step('locatorjs-config', async () => {
      const config = await run(npxBin, ['locatorjs-config'], {
        cwd: projectDir,
        input: '1\n',
      });
      if (config.code !== 0) throw new Error(summarizeFailure(config));
      const configPath = path.join(projectDir, 'ngx-locatorjs.config.json');
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cfg.port = openerPort;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    });

    await step('locatorjs-scan', async () => {
      const scan = await run(npxBin, ['locatorjs-scan'], { cwd: projectDir });
      if (scan.code !== 0) throw new Error(summarizeFailure(scan));
      const summary = componentMapSummary(projectDir);
      result.componentCount = summary.count;
      if (summary.count < 1) throw new Error('component-map.json has no components');
    });

    await step('start-opener', async () => {
      openerProcess = spawnManaged(npxBin, ['locatorjs-open-in-editor'], {
        cwd: projectDir,
        env: {
          EDITOR_CMD: `${process.execPath} ${recorderPath}`,
          LOCATOR_E2E_RECORDER_LOG: recorderLogPath,
        },
      });
      await waitForHttpOk(`http://127.0.0.1:${openerPort}/__cmp-map`);
    });

    await step('start-ng-serve', async () => {
      serveProcess = spawnManaged(
        npxBin,
        [
          'ng',
          'serve',
          '--proxy-config',
          'ngx-locatorjs.proxy.cjs',
          '--port',
          String(appPort),
          '--host',
          '127.0.0.1',
        ],
        { cwd: projectDir },
      );
      await waitForHttpOk(`http://127.0.0.1:${appPort}`);
    });

    result.browser = await step('browser-e2e', async () =>
      verifyBrowser(projectDir, version, appPort, recorderLogPath),
    );

    result.status = 'passed';
  } catch (error) {
    if (result.status === 'unknown') result.status = 'failed';
    console.error(`[Angular ${version}] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await Promise.all([stopProcess(serveProcess), stopProcess(openerProcess)]);
    result.recorderEntries = readRecorderEntries(recorderLogPath);
  }

  return result;
}

fs.mkdirSync(workRoot, { recursive: true });
fs.mkdirSync(npmCache, { recursive: true });

const tarballPath = await packLocalPackage();
console.log(`Packed local ngx-locatorjs: ${tarballPath}`);
console.log(`Work root: ${workRoot}`);

const results = [];
for (const version of versions) {
  results.push(await testVersion(version, tarballPath));
  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        node: process.version,
        workRoot,
        tarballPath,
        results,
      },
      null,
      2,
    ),
  );
}

const failed = results.filter((result) => result.status !== 'passed');
console.log('\nSummary');
for (const result of results) {
  console.log(
    `${result.cliVersion}: ${result.status}` +
      (result.componentCount === null ? '' : ` (${result.componentCount} components)`),
  );
}
console.log(`\nResults: ${resultsPath}`);

if (failed.length > 0) {
  process.exitCode = 1;
}
