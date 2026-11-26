# ngx-locatorjs

실행 중인 Angular 앱에서 컴포넌트를 Alt+클릭하면, 해당 소스 파일을 에디터에서 바로 열어 줍니다.

React에는 [LocatorJS](https://www.locatorjs.com/)가 있지만 Angular에는 비슷한 도구가 없어 Codex와 함께 만들었습니다.

[English](README.md)

## 시작하기

```bash
npm i -D ngx-locatorjs
```

`src/main.ts` 마지막에 다음 한 줄을 추가합니다.

```ts
import { isDevMode } from '@angular/core';

// ...기존 bootstrap 코드

if (isDevMode()) import('ngx-locatorjs/auto');
```

dev 서버는 다음과 같이 실행합니다.

```bash
npx ngx-locatorjs -- ng serve
```

브라우저에서 Alt를 누른 채 컴포넌트를 클릭하면 됩니다. 별도의 설정 파일이나 proxy는 필요하지 않습니다.

`ng serve`를 기존처럼 따로 실행하려면, 다른 터미널에서 `npx ngx-locatorjs`를 실행해 주세요.

## 사용법

- `Alt` + 클릭: 클릭한 요소 위치로 템플릿을 엽니다.
- `Alt` + `Shift` + 클릭: 컴포넌트 클래스를 엽니다.
- `Alt`를 누르고 있으면 컴포넌트를 강조하고, 열릴 파일을 툴팁으로 보여 줍니다.

Cursor, VS Code, WebStorm, Zed, Antigravity를 지원하며, Angular 15~22에서 Chromium과 WebKit(Safari 엔진)으로 테스트했습니다.

## 옵션

`ngx-locatorjs/auto`는 기본값으로 동작합니다. 옵션을 바꾸려면 `installAngularLocator`를 직접 호출해 주세요.

```ts
if (isDevMode()) {
  import('ngx-locatorjs').then(({ installAngularLocator }) =>
    installAngularLocator({
      enableNetwork: true,
      modifier: 'ctrl+shift', // 일부 Linux 데스크톱은 Alt+드래그를 창 이동에 사용합니다
      componentModifier: 'alt',
    }),
  );
}
```

| 옵션                | 기본값                    |                                                                   |
| ------------------- | ------------------------- | ----------------------------------------------------------------- |
| `enableNetwork`     | `false`                   | 오프너와 통신하려면 `true`로 설정합니다. localhost만 호출합니다.  |
| `modifier`          | `'alt'`                   | 누르고 있을 키입니다. 예: `'ctrl+shift'`, `'meta+shift'`          |
| `componentModifier` | `'shift'`                 | 템플릿 대신 `.ts`를 여는 추가 키입니다. `false`로 끌 수 있습니다. |
| `openerUrl`         | `'http://127.0.0.1:4123'` | 오프너의 `port`를 변경했다면 함께 변경합니다.                     |
| `enableHover`       | `true`                    |                                                                   |
| `showTooltip`       | `true`                    |                                                                   |
| `debug`             | `false`                   | 실패 내용을 콘솔에 출력합니다.                                    |

## 에디터 설정

기본 에디터는 Cursor입니다. 다른 에디터를 사용하려면 프로젝트 루트에 `ngx-locatorjs.config.json`을 만들어 주세요.

```json
{ "editor": "webstorm" }
```

`cursor`, `code`, `webstorm`, `zed`, `antigravity`를 지정할 수 있습니다. macOS에서는 에디터 CLI를 별도로 설치하지 않아도 됩니다. 그 밖의 에디터는 `EDITOR_CMD`로 지정할 수 있으며, 마지막 인자로 `경로:줄:열`이 전달됩니다.

그 외 설정은 모두 선택 사항입니다. `port`(4123), `host`(`127.0.0.1`), `workspaceRoot`(모노레포에서는 `apps/web` 같은 앱 경로), `fallbackEditor`, `scan.includeGlobs` / `scan.excludeGlobs`를 지정할 수 있습니다.

## 동작 방식

브라우저에서는 Angular 개발 모드 디버그 API로 클릭한 컴포넌트를 찾습니다. Angular 19 이상은 개발 빌드에 컴포넌트별 소스 파일 정보가 포함되어 있어 정확하게 찾을 수 있습니다. 15~18에서는 `npx ngx-locatorjs`가 컴포넌트를 스캔하고 변경 사항을 감시하며, 클래스 이름과 selector로 대응시킵니다. 이 경우 클래스 이름과 selector가 모두 같은 컴포넌트는 구분하지 못할 수 있습니다.

오프너는 `127.0.0.1:4123`에서 에디터를 실행하는 작은 로컬 서버입니다. 같은 컴퓨터에서 서빙된 페이지의 요청만 받으며, 프로젝트 내부의 파일만 엽니다.

## proxy 사용

브라우저에서 `127.0.0.1:4123`에 직접 접근할 수 없는 경우에만 필요합니다. 예를 들어 `ng serve --host 0.0.0.0`으로 실행한 앱을 다른 기기에서 여는 경우입니다. `npx locatorjs-config`로 `ngx-locatorjs.proxy.cjs`를 생성한 뒤 `ng serve --proxy-config ngx-locatorjs.proxy.cjs`로 실행하면, 런타임이 자동으로 proxy를 사용합니다. 이때는 dev 서버에 접근할 수 있는 누구나 오프너를 사용할 수 있으므로 신뢰할 수 있는 네트워크에서만 사용하시기 바랍니다.

## 0.5에서 업그레이드

- `locatorjs-open-in-editor` 대신 `npx ngx-locatorjs`를 실행해 주세요. 기존 proxy도 계속 동작하지만, `.open-in-editor/auth-token`과 함께 삭제해도 됩니다.
- 기존 `installAngularLocator({ enableNetwork: true })` 호출은 그대로 동작하며, 이제 오프너에 직접 연결합니다. `endpoints`를 지정하고 있었다면 이를 제거해야 직접 연결됩니다.

## 문제 해결

**Alt+클릭해도 반응이 없는 경우.** `npx ngx-locatorjs`가 실행 중인지 확인하고, `debug: true`로 콘솔의 오류를 확인해 주세요.

**403 "Missing x-locatorjs-request header"가 발생하는 경우.** 브라우저 런타임과 CLI의 버전이 다릅니다. 패키지를 최신 버전으로 업데이트해 주세요.

**4123 포트가 이미 사용 중인 경우.** 설정의 `port`와 옵션의 `openerUrl`을 같은 포트로 변경해 주세요.

**파일은 열리지만 해당 줄로 이동하지 않는 경우.** 오프너 시작 로그에서 에디터 실행 방식을 확인할 수 있습니다. 에디터 CLI를 설치하거나 `EDITOR_CMD`를 지정하면 대부분 해결됩니다.

## 라이선스

MIT
