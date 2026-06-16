#!/usr/bin/env node
// Generates real Angular projects and checks ngx-locatorjs across CLI versions.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const defaultWorkRoot = path.join(os.tmpdir(), 'ngx-locatorjs-angular-version-tests');
const workRoot = path.resolve(process.env.LOCATOR_ANGULAR_TEST_ROOT || defaultWorkRoot);
const npmCache = path.join(workRoot, '.npm-cache');
function resolveBin(name) {
  const envName = `${name.toUpperCase()}_BIN`;
  if (process.env[envName]) return process.env[envName];
  return name;
}

const npmBin = resolveBin('npm');
const npxBin = resolveBin('npx');
const packageManager = npmBin;
const packageManagerName = 'npm';

const versions = (
  process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        '12.2.18',
        '13.3.11',
        '14.2.13',
        '15.2.11',
        '16.2.16',
        '17.3.17',
        '18.2.21',
        '19.2.27',
        '20.3.28',
        '21.2.15',
        '22.0.1',
      ]
)
  .map((version) => version.trim())
  .filter(Boolean);

function run(command, args, options = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        npm_config_cache: npmCache,
        NG_CLI_ANALYTICS: 'false',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
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

function summarizeFailure(result) {
  const combined = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return combined.slice(-12).join('\n');
}

async function packLocalPackage() {
  fs.mkdirSync(workRoot, { recursive: true });
  fs.mkdirSync(npmCache, { recursive: true });

  const pack = await run(
    packageManager,
    ['--cache', npmCache, 'pack', '--pack-destination', workRoot],
    {
      cwd: repoRoot,
    },
  );
  if (pack.code !== 0) {
    throw new Error(`npm pack failed:\n${summarizeFailure(pack)}`);
  }

  const tarball = pack.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .at(-1);
  if (!tarball) {
    throw new Error(`Could not find packed tarball in npm pack output:\n${pack.stdout}`);
  }
  return path.join(workRoot, tarball);
}

async function testVersion(cliVersion, tarballPath) {
  const major = cliVersion.split('.')[0];
  const projectName = `nga${major}`;
  const projectDir = path.join(workRoot, projectName);
  fs.rmSync(projectDir, { recursive: true, force: true });

  const result = {
    cliVersion,
    projectName,
    projectDir,
    steps: [],
    status: 'unknown',
    componentCount: null,
  };

  async function step(name, command, args, options = {}) {
    console.log(`\n[Angular ${cliVersion}] ${name}`);
    const stepResult = await run(command, args, options);
    result.steps.push({
      name,
      command,
      args,
      code: stepResult.code,
      durationMs: stepResult.durationMs,
      failureSummary: stepResult.code === 0 ? undefined : summarizeFailure(stepResult),
    });
    return stepResult;
  }

  function recordLocalStep(name, fn) {
    const startedAt = Date.now();
    try {
      fn();
      result.steps.push({
        name,
        command: 'local',
        args: [],
        code: 0,
        durationMs: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      result.steps.push({
        name,
        command: 'local',
        args: [],
        code: 1,
        durationMs: Date.now() - startedAt,
        failureSummary: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  const create = await step(
    'create',
    npxBin,
    [
      '--yes',
      `@angular/cli@${cliVersion}`,
      'new',
      projectName,
      '--directory',
      projectName,
      '--skip-git',
      '--skip-tests',
      '--defaults',
      '--package-manager',
      packageManagerName,
    ],
    { cwd: workRoot },
  );
  if (create.code !== 0) {
    result.status = 'create_failed';
    return result;
  }

  const installLocator = await step(
    'install-locator',
    packageManager,
    ['install', '--save-dev', tarballPath],
    { cwd: projectDir },
  );
  if (installLocator.code !== 0) {
    result.status = 'install_failed';
    return result;
  }

  const injected = recordLocalStep('inject-runtime-hook', () => {
    const mainPath = path.join(projectDir, 'src', 'main.ts');
    const current = fs.readFileSync(mainPath, 'utf8');
    fs.writeFileSync(
      mainPath,
      `${current}\n\nsetTimeout(() => {\n  import('ngx-locatorjs')\n    .then((m) => m.installAngularLocator({ enableNetwork: true }))\n    .catch((err) => console.warn('[angular-locator] Failed to load:', err));\n}, 1000);\n`,
    );
  });
  if (!injected) {
    result.status = 'inject_failed';
    return result;
  }

  const config = await step('locatorjs-config', npxBin, ['locatorjs-config'], {
    cwd: projectDir,
    input: 'cursor\n',
  });
  if (config.code !== 0) {
    result.status = 'config_failed';
    return result;
  }

  const scan = await step('locatorjs-scan', npxBin, ['locatorjs-scan'], { cwd: projectDir });
  if (scan.code !== 0) {
    result.status = 'scan_failed';
    return result;
  }

  const mapPath = path.join(projectDir, '.open-in-editor', 'component-map.json');
  if (fs.existsSync(mapPath)) {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    result.componentCount = Object.keys(map.detailByFilePath ?? {}).length;
  }

  const build = await step('ng-build', npxBin, ['ng', 'build'], { cwd: projectDir });
  if (build.code !== 0) {
    result.status = 'build_failed';
    return result;
  }

  result.status = 'passed';
  return result;
}

const tarballPath = await packLocalPackage();
console.log(`Packed local ngx-locatorjs: ${tarballPath}`);
console.log(`Work root: ${workRoot}`);

const results = [];
for (const version of versions) {
  results.push(await testVersion(version, tarballPath));
}

const outFile = path.join(workRoot, 'results.json');
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      node: process.version,
      repoRoot,
      tarballPath,
      results,
    },
    null,
    2,
  ),
);

console.log('\nSummary');
for (const result of results) {
  console.log(
    `${result.cliVersion}: ${result.status}` +
      (result.componentCount === null ? '' : ` (${result.componentCount} components)`),
  );
}
console.log(`\nResults: ${outFile}`);
