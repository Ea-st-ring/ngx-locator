import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir, repoRoot } from './helpers.mjs';

// Angular 15-17 projects default to moduleResolution "node", which ignores package.json
// "exports"; 18+ use "bundler". The documented `import('ngx-locatorjs/auto')` must
// type-check under both.
for (const moduleResolution of ['node10', 'bundler']) {
  test(`ngx-locatorjs and ngx-locatorjs/auto type-check with moduleResolution ${moduleResolution}`, (t) => {
    const project = makeTempDir('exports');
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.mkdirSync(path.join(project, 'node_modules'));
    fs.symlinkSync(repoRoot, path.join(project, 'node_modules', 'ngx-locatorjs'), 'dir');
    fs.writeFileSync(
      path.join(project, 'main.ts'),
      [
        "import { installAngularLocator } from 'ngx-locatorjs';",
        "void import('ngx-locatorjs/auto');",
        'void installAngularLocator({ enableNetwork: true });',
        '',
      ].join('\n'),
    );

    const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    const result = spawnSync(
      process.execPath,
      [
        tsc,
        '--noEmit',
        '--strict',
        '--module',
        'esnext',
        '--target',
        'es2022',
        '--lib',
        'es2022,dom',
        '--moduleResolution',
        moduleResolution,
        'main.ts',
      ],
      { cwd: project, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
