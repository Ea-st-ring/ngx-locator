// Drives the built browser runtime in a real Chromium against a page that fakes Angular's
// `window.ng` debug API, to check modifier keys, hover rendering, and click routing.
// Skipped when no Playwright browser is installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { repoRoot } from './helpers.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  chromium = null;
}

const CMP_MAP = {
  detailByFilePath: {
    '/w/src/app/app.component.ts': {
      className: 'AppComponent',
      filePath: '/w/src/app/app.component.ts',
      templateUrl: '/w/src/app/app.component.html',
    },
    '/w/src/app/card/card.component.ts': {
      className: 'CardComponent',
      filePath: '/w/src/app/card/card.component.ts',
      templateUrl: '/w/src/app/card/card.component.html',
    },
  },
  filePathsByClassName: {},
};

const PAGE = `<!doctype html>
<html><body style="margin:0">
<app-root style="display:block;padding:40px">
  <h1>App</h1>
  <app-card style="display:block;padding:30px;width:300px">
    <button id="buy" style="width:120px;height:40px">Buy</button>
  </app-card>
</app-root>
<script type="module">
  class AppComponent {}
  class CardComponent {}
  const app = new AppComponent();
  const card = new CardComponent();
  const hosts = new Map([[app, document.querySelector('app-root')], [card, document.querySelector('app-card')]]);
  // Like Angular: the owning component is the one whose template declares the element.
  window.ng = {
    getOwningComponent: (el) => (el.closest('app-card') && el.tagName !== 'APP-CARD' ? card : app),
    getHostElement: (cmp) => hosts.get(cmp) ?? null,
  };
  const options = JSON.parse(new URLSearchParams(location.search).get('options') || '{}');
  const { installAngularLocator } = await import('/locator.js');
  await installAngularLocator({ enableNetwork: true, showClickFeedback: false, ...options });
  window.__locatorReady = true;
</script>
</body></html>`;

async function startServer(t, { page = PAGE, map = CMP_MAP } = {}) {
  const requests = [];
  const locatorJs = fs.readFileSync(path.join(repoRoot, 'dist/browser/index.js'));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/locator.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(locatorJs);
    }
    if (url.pathname === '/__cmp-map') {
      if (!map) {
        res.statusCode = 404;
        return res.end('component-map.json not found');
      }
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(map));
    }
    if (url.pathname === '/__open-in-editor-resolve') {
      // Mirrors the opener: the template sits next to the .ts with the same base name.
      const file = url.searchParams.get('file');
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          className: url.searchParams.get('className'),
          filePath: `/w/${file}`,
          templateUrl: `/w/${file.replace(/\.ts$/, '.html')}`,
          line: 7,
        }),
      );
    }
    if (url.pathname.startsWith('/__open-in-editor')) {
      requests.push({
        route: url.pathname,
        file: url.searchParams.get('file'),
        line: url.searchParams.get('line'),
      });
      return res.end('ok');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { origin: `http://localhost:${server.address().port}`, requests };
}

async function openPage(t, options = {}, server = {}) {
  const { origin, requests } = await startServer(t, server);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${origin}/?options=${encodeURIComponent(JSON.stringify(options))}`);
  await page.waitForFunction(() => window.__locatorReady === true);
  const box = (await page.locator('#buy').count())
    ? await page.locator('#buy').boundingBox()
    : null;
  return { page, requests, buyPoint: box && { x: box.x + 10, y: box.y + 10 } };
}

async function waitForRequest(requests, count) {
  const deadline = Date.now() + 5000;
  while (requests.length < count) {
    if (Date.now() > deadline)
      throw new Error(`expected ${count} open requests, got ${requests.length}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return requests[count - 1];
}

const canLaunch = await (async () => {
  if (!chromium) return false;
  try {
    await (await chromium.launch({ headless: true })).close();
    return true;
  } catch {
    return false;
  }
})();
// Skipped locally without a Playwright browser, but never silently in CI: there a missing
// browser fails the tests instead.
const browserTest = canLaunch || process.env.CI ? test : test.skip;

browserTest(
  'holding the modifier highlights the whole component without moving the mouse',
  async (t) => {
    const { page, buyPoint } = await openPage(t);
    await page.mouse.move(buyPoint.x, buyPoint.y);
    await page.keyboard.down('Alt');

    const overlay = await page.waitForSelector('.dev-highlight-overlay');
    const hostBox = await page.locator('app-card').boundingBox();
    const overlayBox = await overlay.boundingBox();
    assert.deepEqual(
      [overlayBox.x, overlayBox.y, overlayBox.width, overlayBox.height].map(Math.round),
      [hostBox.x, hostBox.y, hostBox.width, hostBox.height].map(Math.round),
    );
    assert.equal(await page.locator('.dev-highlight-target').count(), 1);

    const tooltip = await page.locator('.dev-tooltip').innerText();
    assert.match(tooltip, /CardComponent/);
    assert.match(tooltip, /card\/card\.component\.html/);
    assert.match(tooltip, /Shift\+Click: \.ts/);

    // Holding the component key switches the previewed file to the .ts.
    await page.keyboard.down('Shift');
    await page.waitForFunction(() =>
      document.querySelector('.dev-tooltip')?.textContent?.includes('card.component.ts'),
    );

    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    assert.equal(await page.locator('.dev-highlight-overlay').count(), 0);
  },
);

browserTest('default keys: Alt+click opens the template, Alt+Shift+click the .ts', async (t) => {
  const { page, requests, buyPoint } = await openPage(t);

  await page.keyboard.down('Alt');
  await page.mouse.click(buyPoint.x, buyPoint.y);
  const template = await waitForRequest(requests, 1);
  assert.equal(template.route, '/__open-in-editor-search');
  assert.equal(template.file, '/w/src/app/card/card.component.html');

  await page.keyboard.down('Shift');
  await page.mouse.click(buyPoint.x, buyPoint.y);
  const component = await waitForRequest(requests, 2);
  assert.equal(component.route, '/__open-in-editor');
  assert.equal(component.file, '/w/src/app/card/card.component.ts');
});

browserTest('custom modifier keys replace Alt and Shift', async (t) => {
  const { page, requests, buyPoint } = await openPage(t, {
    modifier: 'ctrl+shift',
    componentModifier: 'alt',
  });

  // Alt alone no longer activates the locator.
  await page.keyboard.down('Alt');
  await page.mouse.click(buyPoint.x, buyPoint.y);
  await page.keyboard.up('Alt');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(requests.length, 0);

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.mouse.click(buyPoint.x, buyPoint.y);
  assert.equal((await waitForRequest(requests, 1)).file, '/w/src/app/card/card.component.html');

  await page.keyboard.down('Alt');
  await page.mouse.click(buyPoint.x, buyPoint.y);
  assert.equal((await waitForRequest(requests, 2)).file, '/w/src/app/card/card.component.ts');

  const tooltip = await page.locator('.dev-tooltip').innerText();
  assert.match(tooltip, /(Alt|Option)\+Click: \.ts/);

  // Each click opens exactly once (on macOS, Ctrl+click arrives as contextmenu, not click).
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(requests.length, 2);
});

// Two libraries each export a component named CardComponent. Angular 19+ dev builds attach
// the source file to each class, so both resolve exactly without a component map.
const SAME_NAME_PAGE = `<!doctype html>
<html><body style="margin:0">
<app-root style="display:block;padding:40px">
  <lib-a-card style="display:block;padding:20px;width:300px"><button id="a" style="width:120px;height:40px">A</button></lib-a-card>
  <lib-b-card style="display:block;padding:20px;width:300px"><button id="b" style="width:120px;height:40px">B</button></lib-b-card>
</app-root>
<script type="module">
  const withDebugInfo = (filePath) => {
    const CardComponent = class CardComponent {};
    CardComponent.ɵcmp = { debugInfo: { className: 'CardComponent', filePath, lineNumber: 7 } };
    return new CardComponent();
  };
  const app = {};
  const cards = new Map([
    ['LIB-A-CARD', withDebugInfo('libs/a/src/card.component.ts')],
    ['LIB-B-CARD', withDebugInfo('libs/b/src/card.component.ts')],
  ]);
  window.ng = {
    getOwningComponent: (el) => cards.get(el.parentElement?.tagName) ?? app,
    getHostElement: (cmp) =>
      [...cards].find(([, c]) => c === cmp)?.[0].toLowerCase() &&
      document.querySelector([...cards].find(([, c]) => c === cmp)[0].toLowerCase()),
  };
  const { installAngularLocator } = await import('/locator.js');
  await installAngularLocator({ enableNetwork: true, showClickFeedback: false });
  window.__locatorReady = true;
</script>
</body></html>`;

browserTest(
  'components sharing a class name open their own files via Angular debug info',
  async (t) => {
    const { page, requests } = await openPage(t, {}, { page: SAME_NAME_PAGE, map: null });
    const center = async (selector) => {
      const box = await page.locator(selector).boundingBox();
      return { x: box.x + 10, y: box.y + 10 };
    };
    const a = await center('#a');
    const b = await center('#b');

    await page.mouse.move(b.x, b.y);
    await page.keyboard.down('Alt');
    // The tooltip first shows the .ts from debug info, then the resolved template.
    await page.waitForFunction(() =>
      document.querySelector('.dev-tooltip')?.textContent?.includes('b/src/card.component.html'),
    );

    await page.mouse.click(a.x, a.y);
    assert.equal((await waitForRequest(requests, 1)).file, '/w/libs/a/src/card.component.html');
    await page.mouse.click(b.x, b.y);
    assert.equal((await waitForRequest(requests, 2)).file, '/w/libs/b/src/card.component.html');

    await page.keyboard.down('Shift');
    await page.mouse.click(b.x, b.y);
    const component = await waitForRequest(requests, 3);
    assert.equal(component.file, '/w/libs/b/src/card.component.ts');
    assert.equal(component.line, '7');
  },
);

// Angular 15-18 have no file path in debug info: the scanned selector tells the two apart.
const SAME_NAME_NO_DEBUG_PAGE = SAME_NAME_PAGE.replace(
  "CardComponent.ɵcmp = { debugInfo: { className: 'CardComponent', filePath, lineNumber: 7 } };",
  '',
);
const sameNameMap = (selectors) => {
  const detailByFilePath = {};
  for (const lib of ['a', 'b']) {
    const filePath = `/w/libs/${lib}/src/card.component.ts`;
    detailByFilePath[filePath] = {
      className: 'CardComponent',
      filePath,
      templateUrl: filePath.replace(/\.ts$/, '.html'),
      ...(selectors ? { selector: `lib-${lib}-card` } : {}),
    };
  }
  return { detailByFilePath, filePathsByClassName: {} };
};

browserTest('without debug info, same-named components are told apart by selector', async (t) => {
  const { page, requests } = await openPage(
    t,
    {},
    { page: SAME_NAME_NO_DEBUG_PAGE, map: sameNameMap(true) },
  );
  for (const [index, lib] of ['a', 'b'].entries()) {
    const box = await page.locator(`#${lib}`).boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 10, box.y + 10);
    await page.keyboard.up('Alt');
    assert.equal(
      (await waitForRequest(requests, index + 1)).file,
      `/w/libs/${lib}/src/card.component.html`,
    );
  }
});

// Attribute selectors on plain <div> hosts: the tag alone cannot tell the two apart.
const ATTRIBUTE_SELECTOR_PAGE = `<!doctype html>
<html><body style="margin:0">
<app-root style="display:block;padding:40px">
  <div libcarda style="padding:20px;width:300px"><button id="a" style="width:120px;height:40px">A</button></div>
  <div libcardb class="card" style="padding:20px;width:300px"><button id="b" style="width:120px;height:40px">B</button></div>
</app-root>
<script type="module">
  const make = () => new (class CardComponent {})();
  const hosts = new Map([[make(), document.querySelector('[libcarda]')], [make(), document.querySelector('[libcardb]')]]);
  const app = {};
  window.ng = {
    getOwningComponent: (el) => [...hosts].find(([, host]) => host === el.parentElement)?.[0] ?? app,
    getHostElement: (cmp) => hosts.get(cmp) ?? null,
  };
  const { installAngularLocator } = await import('/locator.js');
  await installAngularLocator({ enableNetwork: true, showClickFeedback: false });
  window.__locatorReady = true;
</script>
</body></html>`;

browserTest(
  'without debug info, attribute selectors tell same-named components apart',
  async (t) => {
    const map = sameNameMap(false);
    // Angular selectors are case-insensitive for attributes, as in the DOM.
    map.detailByFilePath['/w/libs/a/src/card.component.ts'].selector = '[libCardA]';
    map.detailByFilePath['/w/libs/b/src/card.component.ts'].selector = 'div.card[libCardB]';
    const { page, requests } = await openPage(t, {}, { page: ATTRIBUTE_SELECTOR_PAGE, map });

    // B first: the URL heuristic alone would pick the first candidate (A).
    for (const [index, lib] of ['b', 'a'].entries()) {
      const box = await page.locator(`#${lib}`).boundingBox();
      await page.keyboard.down('Alt');
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.keyboard.up('Alt');
      assert.equal(
        (await waitForRequest(requests, index + 1)).file,
        `/w/libs/${lib}/src/card.component.html`,
      );
    }
  },
);
