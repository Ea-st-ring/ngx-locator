import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './helpers.mjs';

// Minimal DOM stand-ins: just enough for installAngularLocator and ensureMap.
const noop = () => {};
globalThis.window = { location: { href: 'http://localhost:4200/' }, addEventListener: noop };
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({}),
  head: { appendChild: noop },
  addEventListener: noop,
};

const mod = await import(pathToFileURL(path.join(repoRoot, 'dist/browser/index.js')).href);
await mod.installAngularLocator({ enableNetwork: true, prefetchMap: false });

function stubFetch(t, status, body) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status });
  t.after(() => {
    globalThis.fetch = original;
  });
}

test('component map request reports the HTTP status on failure', async (t) => {
  stubFetch(t, 401, 'Unauthorized request');
  await assert.rejects(mod._internal.ensureMap(true), /HTTP 401/);
});

test('component map is parsed from a successful response', async (t) => {
  const map = {
    detailByFilePath: { '/w/a.ts': { className: 'AComponent', filePath: '/w/a.ts' } },
    filePathsByClassName: {},
  };
  stubFetch(t, 200, JSON.stringify(map));

  const loaded = await mod._internal.ensureMap(true);
  assert.deepEqual(loaded.filePathsByClassName, { AComponent: ['/w/a.ts'] });
});
