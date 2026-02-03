#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = process.cwd();
const configPath = path.resolve(root, 'open-in-editor.config.json');

console.log('🚀 LocatorJs (Open-in-Editor) Configuration Setup\n');

if (fs.existsSync(configPath)) {
  console.log('⚠️  open-in-editor.config.json already exists!');

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
    const config = {
      port: await promptPort(),
      workspaceRoot: await promptWorkspaceRoot(),
      editor: await selectEditor(),
      fallbackEditor: 'code',
      scan: await promptScanSettings(),
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const proxyConfigPath = path.resolve(root, 'proxy.conf.json');
    const proxyConfig = {
      '/__open-in-editor': {
        target: `http://localhost:${config.port}`,
        secure: false,
        changeOrigin: true,
      },
      '/__open-in-editor-search': {
        target: `http://localhost:${config.port}`,
        secure: false,
        changeOrigin: true,
      },
      '/__cmp-map': {
        target: `http://localhost:${config.port}`,
        secure: false,
        changeOrigin: true,
      },
    } as Record<string, any>;

    const mergedProxyConfig = mergeProxyConfig(proxyConfigPath, proxyConfig);
    fs.writeFileSync(proxyConfigPath, JSON.stringify(mergedProxyConfig, null, 2));

    console.log('\n✅ Configuration saved successfully!');
    console.log(`📁 Config: ${path.relative(root, configPath)}`);
    console.log(`🔗 Proxy: ${path.relative(root, proxyConfigPath)} (port: ${config.port})`);

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
            printNextSteps();
          } else {
            console.log('\n⚠️  Component scan failed, but config is saved.');
            printManualScan();
          }
        });
      } catch {
        console.log('\n⚠️  Could not run component scan automatically.');
        printManualScan();
      }
    } else {
      console.log('\n⚠️  scan script not found.');
      printManualScan();
    }
  } catch (error: any) {
    console.error('\n❌ Setup failed:', error?.message || error);
    process.exit(1);
  }
}

function printManualScan() {
  console.log('Please run it manually: npx locatorjs-scan');
  printNextSteps();
}

function printNextSteps() {
  console.log('\n🚀 Next steps:');
  console.log('   npx locatorjs-open-in-editor');
  console.log('   (run your Angular dev server with --proxy-config proxy.conf.json)');
}

function mergeProxyConfig(proxyConfigPath: string, addition: Record<string, any>) {
  if (!fs.existsSync(proxyConfigPath)) return addition;

  try {
    const existing = JSON.parse(fs.readFileSync(proxyConfigPath, 'utf8'));
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      return {
        ...existing,
        ...addition,
      };
    }
  } catch {
    // fallthrough
  }

  return addition;
}

function promptPort(): Promise<number> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('🔌 Enter port number (press Enter for default: 4123): ', (answer) => {
      rl.close();
      const port = answer.trim();
      const portNum = port === '' ? 4123 : parseInt(port, 10) || 4123;
      console.log(`   → Port: ${portNum}`);
      resolve(portNum);
    });
  });
}

function promptWorkspaceRoot(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n📁 Current directory: ${process.cwd()}`);

  const askWorkspaceRoot = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('📁 Enter workspace root (press Enter for current directory "."): ', (answer) => {
        const workspaceRoot = answer.trim();
        const result = workspaceRoot === '' ? '.' : workspaceRoot;

        const resolvedPath = path.resolve(process.cwd(), result);

        if (!fs.existsSync(resolvedPath)) {
          console.log(`   ❌ Path does not exist: ${resolvedPath}`);
          console.log('   Please try again...\n');
          askWorkspaceRoot().then(resolve);
          return;
        }

        const stat = fs.statSync(resolvedPath);
        if (!stat.isDirectory()) {
          console.log(`   ❌ Path is not a directory: ${resolvedPath}`);
          console.log('   Please try again...\n');
          askWorkspaceRoot().then(resolve);
          return;
        }

        console.log(`   → Workspace root: ${result}`);
        console.log(`   → Resolved path: ${resolvedPath}`);
        rl.close();
        resolve(result);
      });
    });
  };

  return askWorkspaceRoot();
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
        const selected = availableEditors[Math.max(0, Math.min(choice - 1, availableEditors.length - 1))];
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
        case '\n':
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', handleKeypress);

          const selected = availableEditors[selectedIndex];
          console.log(`\n✨ Selected: ${selected.name}`);
          resolve(selected.value);
          break;
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
  console.log('   💡 You can modify these later in open-in-editor.config.json');

  return Promise.resolve({
    includeGlobs: defaultInclude,
    excludeGlobs: defaultExclude,
  });
}
