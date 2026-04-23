#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = process.cwd();
const CONFIG_FILENAME = 'ngx-locatorjs.config.json';
const PROXY_FILENAME = 'ngx-locatorjs.proxy.cjs';

type AngularServeConfig = {
  proxyConfig?: string;
};

type AngularServeTarget = {
  options?: AngularServeConfig;
  configurations?: Record<string, AngularServeConfig>;
};

type AngularProject = {
  architect?: {
    serve?: AngularServeTarget;
  };
  targets?: {
    serve?: AngularServeTarget;
  };
};

type AngularJson = {
  projects?: Record<string, AngularProject>;
};

const configPath = path.resolve(root, CONFIG_FILENAME);
const proxyConfigPath = resolveProxyConfigPath();

console.log('🚀 LocatorJs (Open-in-Editor) Configuration Setup\n');

if (fs.existsSync(configPath)) {
  console.log(`⚠️  ${CONFIG_FILENAME} already exists!`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Do you want to overwrite it? (y/N): ', (answer) => {
    rl.close();
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('Setup cancelled.');
      process.exit(0);
    }
    startSetup();
  });
} else {
  startSetup();
}

async function startSetup() {
  try {
    logDefaults();
    const authToken = generateAuthToken();
    const config = {
      port: 4123,
      host: '127.0.0.1',
      workspaceRoot: '.',
      editor: await selectEditor(),
      fallbackEditor: 'code',
      authToken,
      scan: await promptScanSettings(),
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    fs.writeFileSync(proxyConfigPath, buildDynamicProxyModule());

    console.log('\n✅ Configuration saved successfully!');
    console.log(`📁 Config: ${path.relative(root, configPath)}`);
    console.log(`🔗 Proxy: ${path.relative(root, proxyConfigPath)} (dynamic from config port)`);
    console.log('🔒 Request auth token generated and wired into proxy headers');

    ensureGitignoreEntries(['.open-in-editor/']);

    console.log('\n🔍 Running component scan...');
    const scanScript = path.resolve(__dirname, 'cmp-scan.js');
    if (fs.existsSync(scanScript)) {
      try {
        const scanProcess = spawn(process.execPath, [scanScript], {
          stdio: 'inherit',
          cwd: root,
        });

        scanProcess.on('close', (code) => {
          if (code === 0) {
            console.log('\n✅ Component scan completed!');
            printNextSteps(proxyConfigPath);
          } else {
            console.log('\n⚠️  Component scan failed, but config is saved.');
            printManualScan(proxyConfigPath);
          }
        });
      } catch {
        console.log('\n⚠️  Could not run component scan automatically.');
        printManualScan(proxyConfigPath);
      }
    } else {
      console.log('\n⚠️  scan script not found.');
      printManualScan(proxyConfigPath);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Setup failed:', message);
    process.exit(1);
  }
}

function printManualScan(proxyPath: string) {
  console.log('Please run it manually: npx locatorjs-scan');
  printNextSteps(proxyPath);
}

function printNextSteps(proxyPath: string) {
  console.log('\n🚀 Next steps:');
  console.log('   npx locatorjs-open-in-editor');
  console.log(
    `   (run your Angular dev server with --proxy-config ${path.relative(root, proxyPath)})`,
  );
}

function buildDynamicProxyModule(): string {
  return `'use strict';

const fs = require('fs');
const path = require('path');

function loadLocatorConfig() {
  const configPath = path.resolve(process.cwd(), '${CONFIG_FILENAME}');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

const cfg = loadLocatorConfig();
const host = typeof cfg.host === 'string' && cfg.host.trim() ? cfg.host.trim() : '127.0.0.1';
const port = Number(process.env.OPEN_IN_EDITOR_PORT || cfg.port || 4123);
const authToken = typeof cfg.authToken === 'string' ? cfg.authToken : '';
const headers = authToken ? { 'x-locatorjs-token': authToken } : {};
const target = \`http://\${host}:\${port}\`;

module.exports = {
  '/__open-in-editor': {
    target,
    secure: false,
    changeOrigin: true,
    headers,
  },
  '/__open-in-editor-search': {
    target,
    secure: false,
    changeOrigin: true,
    headers,
  },
  '/__cmp-map': {
    target,
    secure: false,
    changeOrigin: true,
    headers,
  },
};
`;
}

function resolveProxyConfigPath(): string {
  const angularProxyPath = findProxyConfigFromAngularJson();
  if (angularProxyPath) {
    const ext = path.extname(angularProxyPath).toLowerCase();
    if (ext === '.js' || ext === '.cjs') {
      return angularProxyPath;
    }
    if (ext === '.json') {
      console.log(`⚠️  angular.json points to JSON proxy (${path.basename(angularProxyPath)}).`);
      console.log(
        `   Creating dynamic proxy module ${PROXY_FILENAME} instead. Update angular.json proxyConfig to use it for single-source port management.`,
      );
      return path.resolve(root, PROXY_FILENAME);
    }
    console.log(
      `⚠️  Unsupported proxy extension (${path.basename(angularProxyPath)}). Creating ${PROXY_FILENAME} instead.`,
    );
    return path.resolve(root, PROXY_FILENAME);
  }

  return path.resolve(root, PROXY_FILENAME);
}

function findProxyConfigFromAngularJson(): string | null {
  const angularJsonPath = path.resolve(root, 'angular.json');
  if (!fs.existsSync(angularJsonPath)) return null;

  try {
    const angularJson = JSON.parse(fs.readFileSync(angularJsonPath, 'utf8')) as AngularJson;
    const projects = angularJson?.projects ?? {};

    for (const project of Object.values(projects)) {
      const targets = project.architect || project.targets;
      const serve = targets?.serve;
      if (!serve) continue;

      const direct = serve?.options?.proxyConfig;
      if (typeof direct === 'string' && direct.trim().length > 0) {
        return path.resolve(root, direct);
      }

      const configurations = serve?.configurations;
      if (configurations && typeof configurations === 'object') {
        for (const config of Object.values(configurations)) {
          const confProxy = config?.proxyConfig;
          if (typeof confProxy === 'string' && confProxy.trim().length > 0) {
            return path.resolve(root, confProxy);
          }
        }
      }
    }
  } catch {
    // ignore parse errors
  }

  return null;
}

function ensureGitignoreEntries(entries: string[]) {
  const gitignorePath = path.resolve(root, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return;

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return;

  const suffix = content.endsWith('\n') ? '' : '\n';
  const block = `${suffix}# ngx-locatorjs\n${missing.join('\n')}\n`;
  fs.appendFileSync(gitignorePath, block);
  console.log(`🧹 Added to .gitignore: ${missing.join(', ')}`);
}

function logDefaults() {
  console.log('⚙️  Defaults applied:');
  console.log('   → Port: 4123');
  console.log('   → Host: 127.0.0.1');
  console.log('   → Workspace root: .');
}

function generateAuthToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function selectEditor(): Promise<string> {
  const availableEditors = [
    { name: 'Cursor', value: 'cursor' },
    { name: 'VS Code', value: 'code' },
    { name: 'WebStorm', value: 'webstorm' },
  ];

  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    console.log('\n🎯 Please select your editor:');
    availableEditors.forEach((editor, index) => {
      console.log(`   ${index + 1}. ${editor.name}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('\nEnter number (1-3, default: 1 for Cursor): ', (answer) => {
        rl.close();
        const choice = parseInt(answer.trim(), 10) || 1;
        const selected =
          availableEditors[Math.max(0, Math.min(choice - 1, availableEditors.length - 1))];
        console.log(`   → Selected: ${selected.name}`);
        resolve(selected.value);
      });
    });
  }

  let selectedIndex = 0;

  const renderMenu = () => {
    console.clear();
    console.log('\n🎯 Please select your editor:');
    console.log('   Use ↑↓ to navigate, Enter to select (default: Cursor)\n');

    availableEditors.forEach((editor, index) => {
      const isSelected = index === selectedIndex;
      const pointer = isSelected ? '▶' : ' ';
      const highlight = isSelected ? '\x1b[36m' : '';
      const reset = isSelected ? '\x1b[0m' : '';
      console.log(`${highlight}${pointer} ${editor.name}${reset}`);
    });
  };

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    renderMenu();

    const handleKeypress = (key: string) => {
      switch (key) {
        case '\u001b[A':
          selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : availableEditors.length - 1;
          renderMenu();
          break;
        case '\u001b[B':
          selectedIndex = selectedIndex < availableEditors.length - 1 ? selectedIndex + 1 : 0;
          renderMenu();
          break;
        case '\r':
        case '\n': {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', handleKeypress);

          const selected = availableEditors[selectedIndex];
          console.log(`\n✨ Selected: ${selected.name}`);
          resolve(selected.value);
          break;
        }
        case '\u0003':
          console.log('\n\nCancelled. Setting Cursor as default.');
          process.stdin.setRawMode(false);
          process.stdin.pause();
          resolve('cursor');
          break;
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}

function promptScanSettings() {
  const defaultInclude = [
    'src/**/*.{ts,tsx}',
    'projects/**/*.{ts,tsx}',
    'apps/**/*.{ts,tsx}',
    'libs/**/*.{ts,tsx}',
  ];
  const defaultExclude = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.angular/**',
    '**/coverage/**',
    '**/*.spec.ts',
    '**/*.test.ts',
    '**/*.e2e.ts',
  ];

  console.log('\n📂 Scan settings (using defaults):');
  console.log(`   → Include: ${JSON.stringify(defaultInclude)}`);
  console.log(`   → Exclude: ${JSON.stringify(defaultExclude)}`);
  console.log(`   💡 You can modify these later in ${CONFIG_FILENAME}`);

  return Promise.resolve({
    includeGlobs: defaultInclude,
    excludeGlobs: defaultExclude,
  });
}
