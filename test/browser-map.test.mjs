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
  globalThis.fetch = async () =>
    new Response(body, { status, headers: { 'X-Locatorjs-Opener': '1' } });
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

test('modifier strings are parsed with aliases and rejected when unknown', () => {
  const { parseModifiers } = mod._internal;
  assert.deepEqual(parseModifiers('alt'), ['alt']);
  assert.deepEqual(parseModifiers('Ctrl + Shift'), ['ctrl', 'shift']);
  assert.deepEqual(parseModifiers('cmd+option'), ['meta', 'alt']);
  assert.equal(parseModifiers('alt+hyper'), null);
  assert.equal(parseModifiers(' '), null);
});

test('modifier options fall back safely when invalid or overlapping', (t) => {
  const { resolveModifierOptions } = mod._internal;
  const warn = t.mock.method(console, 'warn', () => {});

  assert.deepEqual(resolveModifierOptions({}), { modifier: ['alt'], componentModifier: ['shift'] });
  assert.deepEqual(resolveModifierOptions({ modifier: 'ctrl+shift', componentModifier: 'alt' }), {
    modifier: ['ctrl', 'shift'],
    componentModifier: ['alt'],
  });
  assert.deepEqual(resolveModifierOptions({ componentModifier: false }).componentModifier, []);
  assert.equal(warn.mock.callCount(), 0);

  // Overlap would make every click open the .ts file, so the component key is disabled.
  assert.deepEqual(resolveModifierOptions({ modifier: 'alt+shift' }), {
    modifier: ['alt', 'shift'],
    componentModifier: [],
  });
  assert.deepEqual(resolveModifierOptions({ modifier: 'hyper' }).modifier, ['alt']);
  assert.equal(warn.mock.callCount(), 2);
});

test('modifiersPressed requires every key and never matches an empty list', () => {
  const { modifiersPressed } = mod._internal;
  const ev = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: true };
  assert.equal(modifiersPressed(ev, ['alt']), true);
  assert.equal(modifiersPressed(ev, ['alt', 'shift']), true);
  assert.equal(modifiersPressed(ev, ['alt', 'ctrl']), false);
  assert.equal(modifiersPressed(ev, []), false);
});

test('shortenPath keeps the last segments of POSIX and Windows paths', () => {
  const { shortenPath } = mod._internal;
  assert.equal(shortenPath('/w/src/app/card/card.html'), '…/app/card/card.html');
  assert.equal(shortenPath('C:\\w\\src\\app\\card.ts'), '…/src/app/card.ts');
  assert.equal(shortenPath('app/card.ts'), 'app/card.ts');
});
