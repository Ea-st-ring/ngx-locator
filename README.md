# ngx-locatorjs (Angular Open-in-Editor)

![2026-02-045 13 22-ezgif com-optimize](https://github.com/user-attachments/assets/9956e311-1af6-4096-9b9e-eb8dd6ea62be)

한국어 문서: [README.ko.md](README.ko.md)

Angular doesn’t have many developer tools like LocatorJs, likely due to lower popularity, which has been inconvenient. So I built one together with CODEX.
Open Angular component files directly from the browser with **Alt + Click** during development.

Inspired by [locatorjs.com](https://www.locatorjs.com/).

## Features

- **Alt + Click**: open the template (.html) at the clicked element
- **Alt + Shift + Click**: open the component (.ts) at the class
- **Hold Alt**: highlight the component and the hovered element, with a tooltip showing the file that will open
- Keys are configurable (see [Runtime Options](#runtime-options))
- Supports **Cursor**, **VS Code**, **WebStorm**, **Zed**, **Antigravity**

Tested with **Angular 15–22** in Chromium and WebKit (Safari's engine).

## Quick Start

1. Install:

   ```bash
   npm i -D ngx-locatorjs
   ```

2. Add one line to the end of `src/main.ts`:

   ```ts
   import { isDevMode } from '@angular/core';

   // ...your existing bootstrap code...

   if (isDevMode()) import('ngx-locatorjs/auto');
   ```

3. Start the dev server through the locator:

   ```bash
   npx ngx-locatorjs -- ng serve
   ```

   Or keep your usual command and run `npx ngx-locatorjs` in a second terminal. To make it the default, set `"start": "ngx-locatorjs -- ng serve"` in `package.json`.

That's it: no config file and no proxy. Hold **Alt** in the browser and click a component.

## How It Works

- **Browser runtime** (`ngx-locatorjs/auto`): finds the component under the cursor through Angular's dev-mode debug API and asks the opener to open its file.
- **Opener** (`npx ngx-locatorjs`): a small local server on `http://127.0.0.1:4123` that launches your editor. The runtime calls it directly; it only answers pages served from this machine.

How a component's file is found depends on the Angular version:

| Angular | Matching                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19+     | Exact file and class line from Angular's dev-mode debug info. Works even when several components share a class name. No scan.                                                                                                     |
| 15–18   | A component map that `npx ngx-locatorjs` builds and keeps updated automatically. Same-named components are told apart by matching each selector (element, attribute, or class) against the host element, then by the current URL. |

## CLI

```text
npx ngx-locatorjs [options]                 Start the opener
npx ngx-locatorjs [options] -- <command>    Start the opener and run <command>; both stop together
npx ngx-locatorjs init                      Create ngx-locatorjs.config.json (optional)
npx ngx-locatorjs scan                      Build the component map once

--scan / --no-scan   Force the component map on or off (default: on below Angular 19)
```

The older commands (`locatorjs-config`, `locatorjs-open-in-editor`, `locatorjs-scan`) still work.

## Editors

The opener uses `editor` from the config (default `cursor`, then `fallbackEditor`). On macOS the editor's CLI does not need to be on `PATH`: the CLI inside the app bundle or the app's URL scheme (`cursor://`, `vscode://`, `antigravity://`) is used for line navigation, and `open -a` as a last resort. The startup log shows which method each editor uses.

Override with environment variables:

1. `EDITOR_CMD` (e.g. `cursor --goto`), receives `file:line:col`
2. `LAUNCH_EDITOR` (e.g. `code`)
3. `editor` in `ngx-locatorjs.config.json`

## Runtime Options

`ngx-locatorjs/auto` uses the defaults. To change them, call `installAngularLocator` instead:

```ts
if (isDevMode()) {
  import('ngx-locatorjs').then((m) =>
    m.installAngularLocator({
      enableNetwork: true,
      modifier: 'ctrl+shift',
      componentModifier: 'alt',
    }),
  );
}
```

| Option                              | Default                   | Description                                                                                                                                 |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `enableNetwork`                     | `false` (`true` in auto)  | Required (`true`) to call the opener. Requests are limited to localhost.                                                                    |
| `openerUrl`                         | `'http://127.0.0.1:4123'` | Where the opener listens. Change it with the opener's `port`. `false` uses only the proxy routes in `endpoints`.                            |
| `modifier`                          | `'alt'`                   | Keys to hold for hover and click, joined with `+` (`'alt'`, `'ctrl+shift'`, `'meta+shift'`). Aliases: `option`, `control`, `cmd`/`command`. |
| `componentModifier`                 | `'shift'`                 | Extra key that opens the `.ts` file instead of the template. `false` disables it. Must not overlap with `modifier`.                         |
| `enableHover` / `enableClick`       | `true`                    | Turn hover highlighting or click-to-open off.                                                                                               |
| `showTooltip` / `showClickFeedback` | `true`                    | Hide the hover tooltip or the "Opening…" toast.                                                                                             |
| `debug`                             | `false`                   | Log failures to the console.                                                                                                                |

Some Linux desktops use Alt+drag to move windows; pick another `modifier` there. On macOS, Ctrl+click opens the context menu; the locator handles it, so `ctrl` modifiers work too.

## Config (Optional)

Everything has a default. Create `ngx-locatorjs.config.json` in the project root (by hand or with `npx ngx-locatorjs init`) only to change something:

```json
{
  "port": 4123,
  "host": "127.0.0.1",
  "workspaceRoot": ".",
  "editor": "cursor",
  "fallbackEditor": "code",
  "scan": {
    "includeGlobs": ["src/**/*.{ts,tsx,js,jsx}"],
    "excludeGlobs": ["**/node_modules/**", "**/*.spec.{ts,tsx,js,jsx}"]
  }
}
```

- `port` / `host`: where the opener listens. If you change `port`, also set `openerUrl` in the runtime options.
- `workspaceRoot`: the Angular app root, relative to where you run the command (e.g. `apps/web` in a monorepo). The opener only opens files inside it.
- `editor` / `fallbackEditor`: `cursor`, `code`, `webstorm`, `zed`, `antigravity`.
- `scan.includeGlobs` / `scan.excludeGlobs`: files scanned for the component map (Angular 15–18). Examples: `"src/app/**/*.ts"`; Nx: `"apps/**/*.ts", "libs/**/*.ts"`.

The component map is written to `.open-in-editor/` (add it to `.gitignore`).

## Using a Dev-Server Proxy

Not needed for the usual setup. Use it when the browser cannot reach `127.0.0.1:4123` directly, for example when you open the app from another device through `ng serve --host 0.0.0.0`.

`npx locatorjs-config` writes `ngx-locatorjs.proxy.cjs`; run `ng serve --proxy-config ngx-locatorjs.proxy.cjs`. The runtime tries the opener directly first and falls back to the proxy routes automatically. An existing proxy file referenced by `angular.json` is never overwritten: merge the generated entries into it.

## Security

- The opener binds to `127.0.0.1` and opens files only inside `workspaceRoot`.
- Every request must carry an `x-locatorjs-request` header. Other websites cannot add it to `<img>`, form, or link requests, and adding it with `fetch` needs a CORS preflight that the opener approves only for pages served from this machine.
- Requests marked cross-site by the browser and requests with a non-loopback `Host` header (DNS rebinding) are rejected, also when they come through a proxy.
- With `ng serve --host 0.0.0.0` and the proxy, anyone who can reach the dev server can use the opener routes. Do this only on trusted networks.
- An extra token is optional: set `OPEN_IN_EDITOR_TOKEN` (or `authToken` in the config) and pass the same `authToken` to `installAngularLocator`.

## Upgrading from 0.5.x

- Replace the `main.ts` snippet with `if (isDevMode()) import('ngx-locatorjs/auto');`, or keep your `installAngularLocator({ enableNetwork: true })` call; it now connects directly.
- Run `npx ngx-locatorjs` instead of `locatorjs-open-in-editor`. The proxy and `.open-in-editor/auth-token` are no longer needed; the generated proxy still works if you keep it.
- If you passed `endpoints` to `installAngularLocator`, the runtime keeps using those proxy routes. Remove `endpoints` (or set `openerUrl`) to connect directly.

## Troubleshooting

- **Nothing happens on Alt+click**: check that `npx ngx-locatorjs` is running and that `main.ts` imports `ngx-locatorjs/auto` in dev mode. Set `debug: true` to see errors in the console.
- **"Missing x-locatorjs-request header" (403)**: something calls the opener without the runtime, or the runtime and opener versions differ. Update both.
- **Port 4123 is taken**: set `port` in the config and the same `openerUrl` in the runtime options.
- **Wrong file opens (Angular 15–18)**: two components share both class name and selector. Upgrade to Angular 19+ for exact matching, or rename one.
- **Component changes not found (Angular 15–18)**: keep `npx ngx-locatorjs` running (it watches), or run `npx ngx-locatorjs scan`.
- **Editor opens without jumping to the line**: the startup log shows the launch method; install the editor's CLI or set `EDITOR_CMD`.
- **Files outside the app are refused**: set `workspaceRoot`.

## Limitations

- Development only: it relies on Angular's dev-mode debug API.
- Not supported in SSR/SSG runtime (browser DOM only).
