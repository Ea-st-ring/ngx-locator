# ngx-locatorjs (Angular Open-in-Editor)

![2026-02-045 13 22-ezgif com-optimize](https://github.com/user-attachments/assets/9956e311-1af6-4096-9b9e-eb8dd6ea62be)

한국어 문서: [README.ko.md](README.ko.md)

Angular doesn’t have many developer tools like LocatorJs, likely due to lower popularity, which has been inconvenient. So I built one together with CODEX.
Open Angular component files directly from the browser with **Alt + Click** during development. This package provides:

- Browser runtime for Alt+click / hover UI
- CLI tools to scan Angular components and open files in your editor
- Config + proxy setup guidance

Inspired by [locatorjs.com](https://www.locatorjs.com/).

## Features

- **Alt + Click**: open template (.html)
- **Alt + Shift + Click**: open component (.ts)
- **Hold Alt**: highlight component + tooltip
- Supports **Antigravity IDE**, **Cursor**, **Zed**, **VS Code**, **WebStorm**

## Angular Version Support

Tested support: **Angular 15–22**.

## Install

```bash
npm i -D ngx-locatorjs
```

## Required Steps (Do This First)

You must complete steps 1–4 for this to work.

1. Install the package: `npm i -D ngx-locatorjs`
2. Generate config + proxy: `npx locatorjs-config`
3. Add the runtime hook to `main.ts` (see the examples below)
4. Run the file-opener server and your dev server (keep both running): `npx locatorjs-open-in-editor --watch` + `ng serve --proxy-config ngx-locatorjs.proxy.cjs`

If you are upgrading from an older version, run `npx locatorjs-config` again so `authToken` and proxy headers are generated, then use `ngx-locatorjs.proxy.cjs` in your `--proxy-config` or `angular.json`.

## Add to `main.ts`

### NgModule bootstrap

```ts
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { enableProdMode } from '@angular/core';

if (environment.production) {
  enableProdMode();
}

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .then(() => {
    if (!environment.production) {
      setTimeout(() => {
        import('ngx-locatorjs')
          .then(
            (m) => m.installAngularLocator({ enableNetwork: true }), // required for network access (localhost-only)
          )
          .catch((err) => console.warn('[angular-locator] Failed to load:', err));
      }, 1000);
    }
  })
  .catch((err) => console.error(err));
```

### Standalone bootstrap

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .then(() => {
    setTimeout(() => {
      import('ngx-locatorjs')
        .then(
          (m) => m.installAngularLocator({ enableNetwork: true }), // required for network access (localhost-only)
        )
        .catch((err) => console.warn('[angular-locator] Failed to load:', err));
    }, 1000);
  })
  .catch((err) => console.error(err));
```

## Config Guide (`ngx-locatorjs.config.json`)

Location: project root

**Important**

- `npx locatorjs-config` uses the **current directory** as the base.
- Defaults: `host: "127.0.0.1"`, `port: 4123`, `workspaceRoot: "."`.
- In a monorepo, update `workspaceRoot` to the **relative path** of your Angular app (e.g. `apps/web`).
- If `.gitignore` exists, `npx locatorjs-config` will append `.open-in-editor/`. Remove it if you want to commit the map.

Example:

```json
{
  "host": "127.0.0.1",
  "port": 4123,
  "workspaceRoot": ".",
  "editor": "cursor",
  "fallbackEditor": "code",
  "authToken": "generated-by-locatorjs-config",
  "scan": {
    "includeGlobs": [
      "src/**/*.{ts,tsx,js,jsx}",
      "projects/**/*.{ts,tsx,js,jsx}",
      "apps/**/*.{ts,tsx,js,jsx}",
      "libs/**/*.{ts,tsx,js,jsx}"
    ],
    "excludeGlobs": [
      "**/node_modules/**",
      "**/dist/**",
      "**/.angular/**",
      "**/coverage/**",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.e2e.{ts,tsx,js,jsx}"
    ]
  }
}
```

### Field Reference

- `port`: Port for the local file-opener server.
- `host`: Bind address for the file-opener server. Keep `127.0.0.1` for local-only access.
- `workspaceRoot`: Angular workspace root path (relative to where you run commands).
- `editor`: Preferred editor (`cursor`, `code`, `webstorm`).
- `fallbackEditor`: Fallback editor if the preferred editor cannot be launched.
- `authToken`: Request token validated by the open-in-editor server. Generated automatically by `locatorjs-config`.
- `scan.includeGlobs`: Globs used to find component source files.
- `scan.excludeGlobs`: Globs excluded from component scanning.

### authToken Behavior (0.5.0)

- `locatorjs-config` generates a per-project `authToken` in `ngx-locatorjs.config.json`.
- `ngx-locatorjs.proxy.cjs` reads that token and forwards it as `x-locatorjs-token` to opener routes.
- If you skip Angular proxy and call opener endpoints directly, pass `authToken` to `installAngularLocator(...)` so requests are authorized.
- If token mismatch occurs (`401 Unauthorized`), regenerate config/proxy: `npx locatorjs-config`.

### Auto Scan Scope Discovery (0.5.0)

- `locatorjs-config` now auto-detects scan roots.
- Generated defaults now include `ts/tsx/js/jsx`.
- You can always edit the generated `scan.includeGlobs` / `scan.excludeGlobs` manually.

### Example includeGlobs

- Simple app: `"src/app/**/*.ts"`
- Angular workspace: `"projects/**/*.{ts,tsx,js,jsx}"`
- Nx: `"apps/**/*.{ts,tsx,js,jsx}", "libs/**/*.{ts,tsx,js,jsx}"`

## Proxy (`ngx-locatorjs.proxy.cjs`)

Generated by `npx locatorjs-config`. This dynamic proxy module reads `ngx-locatorjs.config.json` at runtime, so changing `port` in config updates proxy target automatically.

Example:

```js
module.exports = {
  '/__open-in-editor': { target, secure: false, changeOrigin: true, headers },
  '/__open-in-editor-search': { target, secure: false, changeOrigin: true, headers },
  '/__cmp-map': { target, secure: false, changeOrigin: true, headers },
};
```

## Environment Variable Priority

1. `EDITOR_CMD` (example: `cursor --goto`)
2. `LAUNCH_EDITOR` (example: `code`)
3. `ngx-locatorjs.config.json` → `editor`
4. auto-detected editor

## Troubleshooting

- **CORS / JSON parse error**: ensure dev server uses `--proxy-config ngx-locatorjs.proxy.cjs`
- **npm run shows "Unknown cli config --proxy-config"**: use `npm run start -- --proxy-config ngx-locatorjs.proxy.cjs`
- **Network disabled**: pass `enableNetwork: true` to `installAngularLocator`
- **component-map.json not found**: run `npx locatorjs-scan`
- **Component changes not reflected**: run `npx locatorjs-open-in-editor --watch` or re-run `npx locatorjs-scan`
- **Map is empty or missing components**: check `scan.includeGlobs` and rerun the scan
- **Wrong files open or nothing matches**: confirm `workspaceRoot` points to the actual Angular app root
- **No highlight / info is null**: make sure `http://localhost:${port}/__cmp-map` is loading and includes your component class name
- **Port conflict**: change `port` in `ngx-locatorjs.config.json` only
- **401 Unauthorized from opener routes**: regenerate config/proxy (`npx locatorjs-config`) or pass `authToken` to `installAngularLocator` if you call the opener without Angular proxy headers

## Notes

- Use only in development (guard with `environment.production`).
- Network requests are opt-in and limited to localhost. Set `enableNetwork: true` to activate.
- Opener server accepts files only inside `workspaceRoot` and binds to loopback by default.

## One-Command Dev (Recommended)

Running the file-opener server and Angular dev server separately is tedious. You can wire them into a single script.

### `npm-run-all`

```bash
npm i -D npm-run-all
```

```json
{
  "scripts": {
    "locator:opener": "npx locatorjs-open-in-editor",
    "dev:app": "ng serve --proxy-config ngx-locatorjs.proxy.cjs",
    "dev:locator": "run-p locator:opener dev:app"
  }
}
```

## What It Can Do

- Open template or component files with Alt+click in development
- Show component highlight and tooltip while holding Alt
- Works with single apps, Angular workspace, and Nx layouts

## Limitations

- Not supported in SSR/SSG runtime (browser DOM only)

## Maintainer Note (Setup UX)

Current setup works, but the first-time flow still feels too manual. You install, run
`npx locatorjs-config`, add the bootstrap hook in `main.ts`, and then run opener + dev server
with proxy config.

This is an area we want to keep improving. Contributions that reduce setup friction are welcome,
especially around safer automation, clearer defaults, and better error guidance.
