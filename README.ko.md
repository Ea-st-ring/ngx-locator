# ngx-locatorjs (Open-in-Editor)

Angular 인기가 적어서인지 [LocatorJs](https://www.locatorjs.com/)와 같은 개발 도구가 없어 불편했습니다. 그래서 CODEX와 함께 만들어보았습니다.
브라우저에서 Alt+클릭으로 Angular 컴포넌트 파일을 에디터에서 바로 여는 개발용 도구입니다. Angular 프로젝트 어디에나 npm 패키지로 설치해 사용할 수 있습니다.

**기능**

- Alt+클릭: 템플릿(.html) 열기
- Alt+Shift+클릭: 컴포넌트(.ts) 열기
- Alt 키 홀드: 컴포넌트 하이라이트 + 툴팁 표시
- Antigravity IDE, Cursor, Zed, VS Code, WebStorm 지원

**Angular 버전 지원**

검증된 지원 범위: **Angular 15~22**

이 범위는 Angular CLI로 생성한 실제 프로젝트에서 컴포넌트 스캔, 브라우저 hover 하이라이트/툴팁, Alt+클릭 템플릿 열기, Alt+Shift+클릭 컴포넌트 파일 열기까지 E2E로 검증합니다.

**필수 단계 (1~4 반드시 수행)**

1. 패키지 설치: `npm i -D ngx-locatorjs`
2. 설정/프록시 생성: `npx locatorjs-config`
3. `main.ts`에 런타임 훅 추가 (아래 예시 참고)
4. 파일 오프너 서버 + dev 서버 실행 (둘 다 켜진 상태 유지): `npx locatorjs-open-in-editor --watch` + `ng serve --proxy-config ngx-locatorjs.proxy.cjs`

기존 0.3.0 버전에서 업그레이드했다면 `npx locatorjs-config`를 다시 실행해 `authToken`과 proxy 헤더를 재생성하고, `--proxy-config`(또는 `angular.json`)를 `ngx-locatorjs.proxy.cjs`로 맞추세요.

**Angular 코드 추가 (main.ts)**

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
        import('ngx-locatorjs').then((m) => m.installAngularLocator({ enableNetwork: true }));
      }, 1000);
    }
  })
  .catch((err) => console.error(err));
```

**Angular 코드 추가 (standalone: bootstrapApplication)**

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .then(() => {
    setTimeout(() => {
      import('ngx-locatorjs')
        .then((m) => m.installAngularLocator({ enableNetwork: true }))
        .catch((err) => console.warn('[angular-locator] Failed to load:', err));
    }, 1000);
  })
  .catch((err) => console.error(err));
```

**Angular dev server 예시**

- CLI 실행
  `ng serve --proxy-config ngx-locatorjs.proxy.cjs`

- angular.json에 적용
  `"serve"` 옵션에 `"proxyConfig": "ngx-locatorjs.proxy.cjs"` 추가

**컴포넌트 맵 스캔**

- 수동 스캔
  `npx locatorjs-scan`

- 변경 감지 자동 스캔(선택)
  `nodemon --delay 2.5 -e ts,html -w src -w projects -w apps -w libs -x "npx locatorjs-scan"`

**가능한 것**

- Alt+클릭으로 템플릿 또는 컴포넌트 파일 열기 (개발 모드)
- Alt 키 홀드 시 컴포넌트 하이라이트 및 툴팁 표시
- 단일 Angular 앱, workspace, Nx 구조에서 동작

**불가능/제한 사항**

- SSR/SSG 환경에서는 동작하지 않음 (브라우저 DOM 기반)

**ngx-locatorjs.config.json 가이드**
파일 위치: 프로젝트 루트

**중요**

- `npx locatorjs-config`는 **실행한 현재 폴더를 기준**으로 설정합니다.
- 기본값: `host: "127.0.0.1"`, `port: 4123`, `workspaceRoot: "."`.
- 모노레포처럼 실제 Angular 앱이 하위 폴더에 있으면 `workspaceRoot`를 그 **상대 경로**로 수정하세요. (예: `apps/web`)
- `.gitignore`가 있으면 `npx locatorjs-config`가 `.open-in-editor/`를 자동 추가합니다. 커밋하려면 해당 항목을 제거하세요.

예시:

```json
{
  "host": "127.0.0.1",
  "port": 4123,
  "workspaceRoot": ".",
  "editor": "cursor",
  "fallbackEditor": "code",
  "authToken": "locatorjs-config가 자동 생성",
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

**필드 설명**

- `port`: 로컬 file-opener 서버 포트입니다.
- `host`: file-opener 서버 바인드 주소입니다. 로컬 전용으로 `127.0.0.1` 사용을 권장합니다.
- `workspaceRoot`: 명령 실행 위치 기준 Angular 워크스페이스 루트 상대 경로입니다.
- `editor`: 기본 에디터입니다 (`cursor`, `code`, `webstorm`).
- `fallbackEditor`: 기본 에디터 실행 실패 시 사용할 대체 에디터입니다.
- `authToken`: open-in-editor 서버 요청 검증 토큰입니다. `locatorjs-config`가 자동 생성합니다.
- `scan.includeGlobs`: 컴포넌트 소스 파일 탐색 대상 glob 목록입니다.
- `scan.excludeGlobs`: 컴포넌트 스캔에서 제외할 glob 목록입니다.

**authToken 동작 방식 (0.5.0)**

- `locatorjs-config`가 프로젝트별 `authToken`을 `ngx-locatorjs.config.json`에 자동 생성합니다.
- `ngx-locatorjs.proxy.cjs`가 해당 토큰을 읽어 opener 라우트로 `x-locatorjs-token` 헤더를 전달합니다.
- Angular proxy 없이 opener 엔드포인트를 직접 호출할 경우 `installAngularLocator(...)`에 `authToken`을 전달해야 인증됩니다.
- `401 Unauthorized`가 발생하면 `npx locatorjs-config`를 다시 실행해 config/proxy를 재생성하세요.

**자동 스캔 범위 탐색 (0.5.0)**

- `locatorjs-config`가 스캔 루트를 자동으로 구성합니다.
- 기본 탐색 확장자는 `ts/tsx/js/jsx`를 포함합니다.
- 생성된 `scan.includeGlobs` / `scan.excludeGlobs`는 언제든 수동 수정 가능합니다.

**프로젝트 구조별 includeGlobs 예시**

1. 일반 Angular 앱
   `["src/app/**/*.ts"]`
2. Angular Workspace (projects/)
   `["projects/**/*.{ts,tsx,js,jsx}"]`
3. Nx (apps/libs)
   `["apps/**/*.{ts,tsx,js,jsx}", "libs/**/*.{ts,tsx,js,jsx}"]`

**환경변수 우선순위**

1. `EDITOR_CMD` 예: `EDITOR_CMD="cursor --goto"`
2. `LAUNCH_EDITOR` 예: `LAUNCH_EDITOR=code`
3. `ngx-locatorjs.config.json`의 `editor`
4. 자동 감지된 에디터

**프록시 설정 (ngx-locatorjs.proxy.cjs)**
`npx locatorjs-config` 실행 시 자동 생성됩니다. 이 파일은 실행 시점에 `ngx-locatorjs.config.json`을 읽어 target을 구성하므로, 포트를 바꾸려면 `ngx-locatorjs.config.json`의 `port`만 수정하면 됩니다.

예시:

```js
module.exports = {
  '/__open-in-editor': { target, secure: false, changeOrigin: true, headers },
  '/__open-in-editor-search': { target, secure: false, changeOrigin: true, headers },
  '/__cmp-map': { target, secure: false, changeOrigin: true, headers },
};
```

**트러블슈팅**

1. CORS 에러
   `ng serve --proxy-config ngx-locatorjs.proxy.cjs` 사용 여부 확인
2. npm run 경고
   `npm run start -- --proxy-config ngx-locatorjs.proxy.cjs` 형태로 실행
3. 네트워크 비활성
   `installAngularLocator({ enableNetwork: true })` 설정 확인
4. component-map.json not found
   `npx locatorjs-scan` 실행 후 `.open-in-editor/component-map.json` 생성 여부 확인
5. 컴포넌트 변경이 반영되지 않음
   `npx locatorjs-open-in-editor --watch` 사용 또는 `npx locatorjs-scan` 재실행
6. 스캔 결과가 비어있거나 컴포넌트가 누락됨
   `scan.includeGlobs` 경로 확인 후 재스캔. 실제 컴포넌트들이 위치한 경로를 입력해야 합니다.
7. 잘못된 파일이 열리거나 매칭이 안 됨
   `workspaceRoot`가 Angular 앱 루트인지 확인
8. 하이라이트가 안 보이거나 info가 null로 나옴
   `http://localhost:${port}/__cmp-map` 에서 컴포넌트 정보가 잘 나타나는지 확인
9. 포트 충돌
   `ngx-locatorjs.config.json`의 `port`만 수정하면 됩니다
10. opener 라우트에서 401 발생
    `npx locatorjs-config` 재실행으로 토큰/프록시 헤더를 다시 생성하거나, 프록시 없이 직접 호출 시 `installAngularLocator`에 `authToken` 전달

**주의**

- 개발 모드에서만 사용하세요. 프로덕션 번들에 포함되지 않도록 `environment.production` 체크를 권장합니다.
- 네트워크 요청은 opt-in이며 localhost로만 제한됩니다. `enableNetwork: true`로 활성화하세요.
- opener 서버는 기본적으로 loopback(`127.0.0.1`)에만 바인드되며, `workspaceRoot` 바깥 파일은 열 수 없습니다.

**원 커맨드 실행 (추천)**
file-opener 서버와 Angular dev server를 한 번에 띄우려면 아래 방식을 사용하세요.

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

** 고민 **

처음 세팅할 때 귀찮은 단계가 많다고 느낍니다.
설치하고, `npx locatorjs-config`를 돌리고, `main.ts`에 훅을 넣고, opener와 dev server를 proxy 설정과 함께 실행..

이 흐름을 더 짧고 자연스럽게 만들고 싶습니다. 의견은 언제나 환영합니다.
