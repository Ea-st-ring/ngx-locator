import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('bin entries point to build artifacts that exist after build', () => {
  const bins = pkg.bin ?? {};
  assert.ok(Object.keys(bins).length > 0, 'expected package.json bin entries');

  for (const [binName, relPath] of Object.entries(bins)) {
    const fullPath = path.resolve(root, relPath);
    assert.ok(fs.existsSync(fullPath), `missing built bin for ${binName}: ${relPath}`);
  }
});
