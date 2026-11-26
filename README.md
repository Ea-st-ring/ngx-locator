# ngx-locatorjs

![2026-02-045 13 22-ezgif com-optimize](https://github.com/user-attachments/assets/9956e311-1af6-4096-9b9e-eb8dd6ea62be)

Alt+click a component in your running Angular app and jump to its source in your editor.

React has [LocatorJS](https://www.locatorjs.com/), but Angular had no similar tool, so I built this one with Codex.

[한국어](README.ko.md)

## Getting started

```bash
npm i -D ngx-locatorjs
```

Add the following line at the end of `src/main.ts`:

```ts
import { isDevMode } from '@angular/core';

// ...your bootstrap code

if (isDevMode()) import('ngx-locatorjs/auto');
```

Then start the dev server with:

```bash
npx ngx-locatorjs -- ng serve
```

Hold Alt in the browser and click a component. No config file or proxy is required.

To keep running `ng serve` separately, run `npx ngx-locatorjs` in another terminal.

## Usage

- `Alt` + click opens the template at the element you clicked.
- `Alt` + `Shift` + click opens the component class.
- Holding `Alt` highlights the component and shows the file that will open.

Cursor, VS Code, WebStorm, Zed and Antigravity are supported. Tested on Angular 15–22 in Chromium and WebKit (Safari's engine).

## Options

`ngx-locatorjs/auto` uses the default options. To change them, call `installAngularLocator` directly:

```ts
if (isDevMode()) {
  import('ngx-locatorjs').then(({ installAngularLocator }) =>
    installAngularLocator({
      enableNetwork: true,
      modifier: 'ctrl+shift', // some Linux desktops use Alt+drag to move windows
      componentModifier: 'alt',
    }),
  );
}
```

| Option              | Default                   |                                                               |
| ------------------- | ------------------------- | ------------------------------------------------------------- |
| `enableNetwork`     | `false`                   | Must be `true` to reach the opener. Only localhost is called. |
| `modifier`          | `'alt'`                   | Keys to hold, e.g. `'ctrl+shift'` or `'meta+shift'`.          |
| `componentModifier` | `'shift'`                 | Extra key that opens the `.ts` instead. `false` turns it off. |
| `openerUrl`         | `'http://127.0.0.1:4123'` | Update it if you change the opener's `port`.                  |
| `enableHover`       | `true`                    |                                                               |
| `showTooltip`       | `true`                    |                                                               |
| `debug`             | `false`                   | Logs failures to the console.                                 |

## Editor

The default editor is Cursor. To use another one, add `ngx-locatorjs.config.json` to the project root:

```json
{ "editor": "webstorm" }
```

Supported values are `cursor`, `code`, `webstorm`, `zed` and `antigravity`. On macOS, the editor's command-line tool does not need to be installed. Other editors can be set with `EDITOR_CMD`, which receives `path:line:col` as its last argument.

Other optional settings: `port` (4123), `host` (`127.0.0.1`), `workspaceRoot` (set it to e.g. `apps/web` in a monorepo), `fallbackEditor`, and `scan.includeGlobs` / `scan.excludeGlobs`.

## How it works

In the browser, the runtime uses Angular's dev-mode debug API to find the clicked component. On Angular 19+, dev builds record the source file of every component, so the match is exact. On 15–18, `npx ngx-locatorjs` scans your components, watches for changes, and matches them by class name and selector. Components that share both class name and selector may not be told apart.

The opener is a small server on `127.0.0.1:4123` that launches your editor. It accepts requests only from pages served on your machine and opens only files inside your project.

## Using a proxy

This is only needed when the browser cannot reach `127.0.0.1:4123`, for example when you open the app from another device via `ng serve --host 0.0.0.0`. Run `npx locatorjs-config` to generate `ngx-locatorjs.proxy.cjs`, then `ng serve --proxy-config ngx-locatorjs.proxy.cjs`. The runtime falls back to the proxy automatically. Note that anyone who can reach the dev server can then use the opener, so use this only on trusted networks.

## Upgrading from 0.5

- Run `npx ngx-locatorjs` instead of `locatorjs-open-in-editor`. The existing proxy still works, but it can be removed along with `.open-in-editor/auth-token`.
- An existing `installAngularLocator({ enableNetwork: true })` call keeps working and now connects directly. If you pass `endpoints`, remove them to connect directly.

## Troubleshooting

**Alt+click does nothing.** Make sure `npx ngx-locatorjs` is running, and enable `debug: true` to see errors in the console.

**403 "Missing x-locatorjs-request header".** The browser runtime and the CLI are from different versions. Update the package.

**Port 4123 is already taken.** Set `port` in the config and the same port in `openerUrl`.

**The file opens, but not at the right line.** The opener's startup log shows how it launches the editor. Installing the editor's CLI or setting `EDITOR_CMD` usually resolves this.

## License

MIT
