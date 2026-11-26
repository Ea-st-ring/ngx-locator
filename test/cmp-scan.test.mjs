import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { distNode, makeTempDir } from './helpers.mjs';

function makeWorkspace(t) {
  const workspace = makeTempDir('scan');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  for (const lib of ['a', 'b']) {
    const dir = path.join(workspace, 'src', `lib-${lib}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'card.component.ts'),
      [
        "import { Component } from '@angular/core';",
        '',
        '@Component({',
        `  selector: 'lib-${lib}-card',`,
        '  templateUrl: `./card.component.html`,',
        '})',
        'export class CardComponent {}',
        '',
      ].join('\n'),
    );
  }
  fs.writeFileSync(
    path.join(workspace, 'ngx-locatorjs.config.json'),
    JSON.stringify({ scan: { includeGlobs: ['src/**/*.ts'] } }),
  );
  return workspace;
}

const runScan = (workspace) =>
  execFileSync(process.execPath, [path.join(distNode, 'cmp-scan.js')], {
    cwd: workspace,
    encoding: 'utf8',
  });

test('the scan records selector, class line, and template literal templateUrl', (t) => {
  const workspace = makeWorkspace(t);
  runScan(workspace);

  const map = JSON.parse(
    fs.readFileSync(path.join(workspace, '.open-in-editor', 'component-map.json'), 'utf8'),
  );
  assert.equal(map.filePathsByClassName.CardComponent.length, 2);
  const card = Object.values(map.detailByFilePath).find((info) => info.selector === 'lib-a-card');
  assert.ok(card, 'lib-a card expected in map');
  assert.equal(card.selector, 'lib-a-card');
  assert.equal(card.line, 7);
  assert.match(card.templateUrl, /lib-a[\\/]card\.component\.html$/);
});

test('a version 2 scan cache is reparsed once without phantom removals', (t) => {
  const workspace = makeWorkspace(t);
  const cacheDir = path.join(workspace, '.open-in-editor');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(
    path.join(cacheDir, 'scan-cache.json'),
    JSON.stringify({ version: 2, files: {} }),
  );

  assert.match(runScan(workspace), /updated 2, removed 0/);
});
