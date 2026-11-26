# ngx-locatorjs (Open-in-Editor)

Angular 인기가 적어서인지 [LocatorJs](https://www.locatorjs.com/)와 같은 개발 도구가 없어 불편했습니다. 그래서 CODEX와 함께 만들어보았습니다.
브라우저에서 Alt+클릭으로 Angular 컴포넌트 파일을 에디터에서 바로 여는 개발용 도구입니다. Angular 프로젝트 어디에나 npm 패키지로 설치해 사용할 수 있습니다.

**기능**

- Alt+클릭: 클릭한 요소 위치로 템플릿(.html) 열기
- Alt+Shift+클릭: 클래스 위치로 컴포넌트(.ts) 열기
- Alt 키 홀드: 컴포넌트 전체와 가리킨 요소를 하이라이트하고, 열릴 파일을 툴팁에 표시
- 조작키 변경 가능 (아래 **런타임 옵션** 참고)
- Cursor, VS Code, WebStorm, Zed, Antigravity 지원

Angular **15~22**에서 Chromium과 WebKit(Safari 엔진)으로 테스트했습니다.

**빠른 시작**

1. 설치합니다.

   ```bash
   npm i -D ngx-locatorjs
   ```

2. `src/main.ts` 끝에 한 줄을 추가합니다.

   ```ts
   import { isDevMode } from '@angular/core';

   // ...기존 bootstrap 코드...

   if (isDevMode()) import('ngx-locatorjs/auto');
   ```

3. 로케이터와 함께 dev 서버를 실행합니다.

   ```bash
   npx ngx-locatorjs -- ng serve
   ```

   평소 명령을 그대로 쓰고 다른 터미널에서 `npx ngx-locatorjs`만 실행해도 됩니다. 기본으로 쓰려면 `package.json`에 `"start": "ngx-locatorjs -- ng serve"`를 넣으세요.

설정 파일도 proxy도 필요 없습니다. 브라우저에서 **Alt**를 누르고 컴포넌트를 클릭하세요.

**동작 방식**

- **브라우저 런타임** (`ngx-locatorjs/auto`): Angular 개발 모드 디버그 API로 커서 아래의 컴포넌트를 찾고, 오프너에 파일을 열어 달라고 요청합니다.
- **오프너** (`npx ngx-locatorjs`): `http://127.0.0.1:4123`에서 에디터를 실행하는 작은 로컬 서버입니다. 런타임이 직접 호출하며, 이 컴퓨터에서 서빙된 페이지의 요청만 받습니다.

컴포넌트 파일을 찾는 방식은 Angular 버전에 따라 다릅니다.

| Angular | 방식                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19+     | Angular 개발 모드 debug info로 정확한 파일과 클래스 줄을 찾습니다. 클래스 이름이 같은 컴포넌트가 여러 개여도 정확합니다. 스캔하지 않습니다.                                             |
| 15–18   | `npx ngx-locatorjs`가 컴포넌트 맵을 만들고 자동으로 최신 상태로 유지합니다. 이름이 같으면 각 selector(태그·속성·클래스)를 호스트 요소에 맞춰 보고, 그래도 같으면 현재 URL로 구분합니다. |

**CLI**

```text
npx ngx-locatorjs [옵션]                    오프너 실행
npx ngx-locatorjs [옵션] -- <명령>          오프너와 <명령>을 함께 실행하고 함께 종료
npx ngx-locatorjs init                      ngx-locatorjs.config.json 생성 (선택)
npx ngx-locatorjs scan                      컴포넌트 맵 한 번 생성

--scan / --no-scan   컴포넌트 맵 사용을 강제로 켜거나 끔 (기본: Angular 19 미만에서만 켬)
```

기존 명령(`locatorjs-config`, `locatorjs-open-in-editor`, `locatorjs-scan`)도 그대로 동작합니다.

**에디터**

오프너는 설정의 `editor`(기본 `cursor`), 그다음 `fallbackEditor`를 사용합니다. macOS에서는 에디터 CLI가 `PATH`에 없어도 됩니다. 앱 번들 안의 CLI나 앱의 URL 스킴(`cursor://`, `vscode://`, `antigravity://`)으로 줄 이동까지 하고, 마지막 수단으로 `open -a`를 씁니다. 에디터별로 어떤 방식을 쓰는지는 시작 로그에 표시됩니다.

환경 변수로 바꿀 수 있습니다.

1. `EDITOR_CMD` (예: `cursor --goto`), `파일:줄:열`을 인자로 받음
2. `LAUNCH_EDITOR` (예: `code`)
3. `ngx-locatorjs.config.json`의 `editor`

**런타임 옵션**

`ngx-locatorjs/auto`는 기본값을 씁니다. 바꾸려면 `installAngularLocator`를 직접 호출하세요.

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

| 옵션                                | 기본값                    | 설명                                                                                                                           |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `enableNetwork`                     | `false` (auto는 `true`)   | 오프너 호출에 필요합니다(`true`). 요청은 localhost로 제한됩니다.                                                               |
| `openerUrl`                         | `'http://127.0.0.1:4123'` | 오프너 주소. 오프너의 `port`를 바꾸면 함께 바꾸세요. `false`면 `endpoints`의 proxy 경로만 씁니다.                              |
| `modifier`                          | `'alt'`                   | hover와 클릭에 누를 키. `+`로 조합합니다(`'alt'`, `'ctrl+shift'`, `'meta+shift'`). 별칭: `option`, `control`, `cmd`/`command`. |
| `componentModifier`                 | `'shift'`                 | 템플릿 대신 `.ts` 파일을 여는 추가 키. `false`면 끕니다. `modifier`와 겹치면 안 됩니다.                                        |
| `enableHover` / `enableClick`       | `true`                    | hover 하이라이트나 클릭 열기를 끕니다.                                                                                         |
| `showTooltip` / `showClickFeedback` | `true`                    | hover 툴팁이나 "Opening…" 알림을 숨깁니다.                                                                                     |
| `debug`                             | `false`                   | 실패 내용을 콘솔에 출력합니다.                                                                                                 |

일부 Linux 데스크톱은 Alt+드래그로 창을 옮기므로 다른 `modifier`를 쓰세요. macOS에서는 Ctrl+클릭이 컨텍스트 메뉴를 여는데, 로케이터가 이를 처리하므로 `ctrl` 조합도 동작합니다.

**설정 (선택)**

모든 값에 기본값이 있습니다. 바꿀 게 있을 때만 프로젝트 루트에 `ngx-locatorjs.config.json`을 만드세요(직접 작성하거나 `npx ngx-locatorjs init`).

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

- `port` / `host`: 오프너 주소. `port`를 바꾸면 런타임 옵션의 `openerUrl`도 바꾸세요.
- `workspaceRoot`: 명령을 실행하는 위치 기준의 Angular 앱 루트입니다(모노레포 예: `apps/web`). 오프너는 이 안의 파일만 엽니다.
- `editor` / `fallbackEditor`: `cursor`, `code`, `webstorm`, `zed`, `antigravity`.
- `scan.includeGlobs` / `scan.excludeGlobs`: 컴포넌트 맵(Angular 15~18)용 스캔 대상. 예: `"src/app/**/*.ts"`, Nx: `"apps/**/*.ts", "libs/**/*.ts"`.

컴포넌트 맵은 `.open-in-editor/`에 저장됩니다(`.gitignore`에 추가하세요).

**dev 서버 proxy 사용**

보통은 필요 없습니다. 브라우저가 `127.0.0.1:4123`에 직접 접근할 수 없을 때 씁니다. 예를 들어 `ng serve --host 0.0.0.0`으로 띄운 앱을 다른 기기에서 열 때입니다.

`npx locatorjs-config`가 `ngx-locatorjs.proxy.cjs`를 만들어 주니 `ng serve --proxy-config ngx-locatorjs.proxy.cjs`로 실행하세요. 런타임은 먼저 오프너에 직접 연결하고, 안 되면 자동으로 proxy 경로를 씁니다. `angular.json`이 가리키는 기존 proxy 파일은 덮어쓰지 않으니, 생성된 항목을 기존 파일에 합치세요.

**보안**

- 오프너는 `127.0.0.1`에서만 대기하고 `workspaceRoot` 안의 파일만 엽니다.
- 모든 요청에 `x-locatorjs-request` 헤더가 있어야 합니다. 다른 사이트는 `<img>`, 폼, 링크 요청에 이 헤더를 붙일 수 없고, `fetch`로 붙이려면 CORS 사전 요청을 거쳐야 하는데 오프너는 이 컴퓨터에서 서빙된 페이지에만 허용합니다.
- 브라우저가 cross-site로 표시한 요청과 `Host` 헤더가 loopback이 아닌 요청(DNS rebinding)은 proxy를 거쳐 와도 거부합니다.
- `ng serve --host 0.0.0.0`과 proxy를 함께 쓰면 dev 서버에 접근할 수 있는 누구나 proxy를 통해 오프너 경로를 쓸 수 있습니다. 신뢰할 수 있는 네트워크에서만 사용하세요.
- 추가 토큰은 선택입니다. `OPEN_IN_EDITOR_TOKEN`(또는 설정의 `authToken`)을 지정하고 `installAngularLocator`에 같은 `authToken`을 넘기세요.

**0.5.x에서 업그레이드**

- `main.ts` 코드를 `if (isDevMode()) import('ngx-locatorjs/auto');`로 바꾸세요. 기존 `installAngularLocator({ enableNetwork: true })` 호출을 그대로 둬도 이제 직접 연결합니다.
- `locatorjs-open-in-editor` 대신 `npx ngx-locatorjs`를 실행하세요. proxy와 `.open-in-editor/auth-token`은 더 이상 필요 없습니다. 생성된 proxy를 그대로 둬도 동작합니다.
- `installAngularLocator`에 `endpoints`를 넘겼다면 런타임은 계속 그 proxy 경로를 씁니다. 직접 연결하려면 `endpoints`를 빼거나 `openerUrl`을 지정하세요.

**트러블슈팅**

- **Alt+클릭해도 반응이 없음**: `npx ngx-locatorjs`가 실행 중인지, `main.ts`가 개발 모드에서 `ngx-locatorjs/auto`를 import하는지 확인하세요. `debug: true`로 콘솔에서 오류를 볼 수 있습니다.
- **"Missing x-locatorjs-request header" (403)**: 런타임을 거치지 않고 오프너를 호출했거나, 런타임과 오프너 버전이 다릅니다. 둘 다 업데이트하세요.
- **4123 포트가 사용 중**: 설정의 `port`와 런타임 옵션의 `openerUrl`을 같은 포트로 바꾸세요.
- **엉뚱한 파일이 열림 (Angular 15~18)**: 두 컴포넌트의 클래스 이름과 selector가 모두 같습니다. 정확한 구분이 필요하면 Angular 19+로 올리거나 이름을 바꾸세요.
- **새 컴포넌트를 못 찾음 (Angular 15~18)**: `npx ngx-locatorjs`를 계속 실행해 두거나(변경을 감시합니다) `npx ngx-locatorjs scan`을 실행하세요.
- **파일은 열리는데 줄 이동이 안 됨**: 시작 로그에서 실행 방식을 확인하고, 에디터 CLI를 설치하거나 `EDITOR_CMD`를 지정하세요.
- **앱 밖의 파일이 거부됨**: `workspaceRoot`를 지정하세요.

**제한 사항**

- 개발 모드 전용입니다. Angular 개발 모드 디버그 API에 의존합니다.
- SSR/SSG 환경에서는 동작하지 않습니다 (브라우저 DOM 기반).
