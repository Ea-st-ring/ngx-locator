#!/usr/bin/env node
// Single entry point: `ngx-locatorjs [command] [-- <dev server command>]`.
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEBUG_INFO_MIN_ANGULAR, getAngularMajorVersion } from './angular-version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();

const HELP = `ngx-locatorjs — open Angular components in your editor with Alt+click

Usage:
  npx ngx-locatorjs [options]                 Start the opener server
  npx ngx-locatorjs [options] -- <command>    Start the opener and run <command> (e.g. ng serve);
                                              both stop together
  npx ngx-locatorjs init                      Create ngx-locatorjs.config.json (optional)
  npx ngx-locatorjs scan                      Build the component map once

Options:
  --scan       Keep the component map up to date (default below Angular ${DEBUG_INFO_MIN_ANGULAR})
  --no-scan    Do not scan (default from Angular ${DEBUG_INFO_MIN_ANGULAR}: dev builds carry source locations)
  -h, --help   Show this help

Then add to src/main.ts:
  if (isDevMode()) import('ngx-locatorjs/auto');
`;

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const ownArgs = separator === -1 ? argv : argv.slice(0, separator);
const devCommand = separator === -1 ? [] : argv.slice(separator + 1);

const script = (name: string) => path.join(__dirname, name);

function runToCompletion(file: string, args: string[]) {
  const child = spawn(process.execPath, [file, ...args], { stdio: 'inherit', cwd: root });
  child.on('exit', (code) => process.exit(code ?? 1));
}

function shouldScan(): boolean {
  if (ownArgs.includes('--scan')) return true;
  if (ownArgs.includes('--no-scan')) return false;
  const major = getAngularMajorVersion(root);
  if (major !== null && major >= DEBUG_INFO_MIN_ANGULAR) {
    console.log(
      `[ngx-locatorjs] Angular ${major}: components are located from dev-mode debug info, scan skipped (use --scan to force).`,
    );
    return false;
  }
  console.log(
    major === null
      ? '[ngx-locatorjs] @angular/core not found from this directory; scanning components to be safe.'
      : `[ngx-locatorjs] Angular ${major}: scanning components and watching for changes.`,
  );
  return true;
}

function start() {
  const opener = spawn(
    process.execPath,
    [script('file-opener.js'), ...(shouldScan() ? ['--watch'] : [])],
    { stdio: 'inherit', cwd: root },
  );

  if (devCommand.length === 0) {
    opener.on('exit', (code) => process.exit(code ?? 0));
    forwardSignals([opener]);
    return;
  }

  // shell on Windows so `ng` resolves to ng.cmd.
  const dev = spawn(devCommand[0], devCommand.slice(1), {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  });
  dev.on('error', (e) => {
    console.error(`[ngx-locatorjs] Could not start "${devCommand.join(' ')}": ${e.message}`);
    opener.kill();
    process.exit(1);
  });
  // The opener exits 0 when another opener already holds the port; the dev command goes on.
  opener.on('exit', (code) => {
    if (code) console.error(`[ngx-locatorjs] Opener exited with code ${code}`);
  });
  dev.on('exit', (code, signal) => {
    opener.kill();
    process.exit(code ?? (signal ? 1 : 0));
  });
  forwardSignals([opener, dev]);
}

function forwardSignals(children: ChildProcess[]) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      for (const child of children) child.kill(signal);
    });
  }
}

const [command] = ownArgs.filter((arg) => !arg.startsWith('-'));
if (ownArgs.includes('-h') || ownArgs.includes('--help')) {
  console.log(HELP);
} else if (command === 'init') {
  runToCompletion(script('config-setup.js'), ['--no-proxy']);
} else if (command === 'scan') {
  runToCompletion(script('cmp-scan.js'), []);
} else if (command === undefined || command === 'start') {
  start();
} else {
  console.error(`[ngx-locatorjs] Unknown command "${command}".\n`);
  console.log(HELP);
  process.exit(1);
}
