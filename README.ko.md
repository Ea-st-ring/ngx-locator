# ngx-locatorjs (Open-in-Editor)

브라우저에서 Alt+클릭으로 Angular 컴포넌트 파일을 에디터에서 바로 여는 개발용 도구입니다. Angular 프로젝트 어디에나 npm 패키지로 설치해 사용할 수 있습니다.

**기능**
- Alt+클릭: 템플릿(.html) 열기
- Alt+Shift+클릭: 컴포넌트(.ts) 열기
- Alt 키 홀드: 컴포넌트 하이라이트 + 툴팁 표시
- Cursor, VS Code, WebStorm 지원

**필수 단계 (1~5 반드시 수행)**
1. 패키지 설치: `npm i -D ngx-locatorjs`
2. `main.ts`에 런타임 훅 추가 (아래 예시 참고)
3. 설정/프록시 생성: `npx locatorjs-config`
4. 컴포넌트 스캔: `npx locatorjs-scan`
5. 파일 오프너 서버 + dev 서버 실행 (둘 다 켜진 상태 유지): `npx locatorjs-open-in-editor` + `ng serve --proxy-config ngx-locatorjs.proxy.json`
   - `npm run start` 사용 시 `--` 뒤에 전달: `npm run start -- --proxy-config ngx-locatorjs.proxy.json`

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
        import('ngx-locatorjs').then((m) => m.installAngularLocator());
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
        .then((m) => m.installAngularLocator())
        .catch((err) => console.warn('[angular-locator] Failed to load:', err));
    }, 1000);
  })
  .catch((err) => console.error(err));
```

**Angular dev server 예시**
- CLI 실행
`ng serve --proxy-config ngx-locatorjs.proxy.json`

- angular.json에 적용
`"serve"` 옵션에 `"proxyConfig": "ngx-locatorjs.proxy.json"` 추가

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
- 동적/반복 템플릿의 정확한 라인 매칭은 100% 보장 불가
- SSR/SSG 환경에서는 동작하지 않음 (브라우저 DOM 기반)

**ngx-locatorjs.config.json 가이드**
파일 위치: 프로젝트 루트

**중요**
- `npx locatorjs-config`는 **실행한 현재 폴더를 기준**으로 설정합니다.
- 프로젝트 루트에서 실행하고, `workspaceRoot` 질문에서 **Enter**를 누르면 `.`(현재 폴더)로 저장됩니다.
- 모노레포처럼 실제 Angular 앱이 하위 폴더에 있으면 그 **상대 경로**를 입력하세요. (예: `apps/web`)
- `.gitignore`가 있으면 `npx locatorjs-config`가 `.open-in-editor/`를 자동 추가합니다. 커밋하려면 해당 항목을 제거하세요.

예시:
```json
{
  "port": 4123,
  "workspaceRoot": ".",
  "editor": "cursor",
  "fallbackEditor": "code",
  "scan": {
    "includeGlobs": [
      "src/**/*.{ts,tsx}",
      "projects/**/*.{ts,tsx}",
      "apps/**/*.{ts,tsx}",
      "libs/**/*.{ts,tsx}"
    ],
    "excludeGlobs": [
      "**/node_modules/**",
      "**/dist/**",
      "**/.angular/**",
      "**/coverage/**",
      "**/*.spec.ts",
      "**/*.test.ts",
      "**/*.e2e.ts"
    ]
  }
}
```

**필드 설명**
- `port`: file-opener 서버 포트
- `workspaceRoot`: 실제 Angular 워크스페이스 루트(모노레포에서 하위 폴더일 때 사용)
- `editor`: 기본 에디터 (`cursor`, `code`, `webstorm`)
- `fallbackEditor`: 기본 에디터 실패 시 사용할 에디터
- `scan.includeGlobs`: 컴포넌트 탐색 대상 경로
- `scan.excludeGlobs`: 스캔 제외 경로

**프로젝트 구조별 추천 includeGlobs**
1. 일반 Angular 앱
`["src/app/**/*.ts"]`
2. Angular Workspace (projects/)
`["projects/**/*.{ts,tsx}"]`
3. Nx (apps/libs)
`["apps/**/*.{ts,tsx}", "libs/**/*.{ts,tsx}"]`

**환경변수 우선순위**
1. `EDITOR_CMD` 예: `EDITOR_CMD="cursor --goto"`
2. `LAUNCH_EDITOR` 예: `LAUNCH_EDITOR=code`
3. `ngx-locatorjs.config.json`의 `editor`
4. 자동 감지된 에디터

**프록시 설정 (ngx-locatorjs.proxy.json)**
`npx locatorjs-config` 실행 시 자동 생성됩니다. `angular.json`에 지정된 proxyConfig나 `proxy.conf.json`이 있으면 그 파일에 병합됩니다. 없으면 `ngx-locatorjs.proxy.json`을 생성합니다.

예시:
```json
{
  "/__open-in-editor": {
    "target": "http://localhost:4123",
    "secure": false,
    "changeOrigin": true
  },
  "/__open-in-editor-search": {
    "target": "http://localhost:4123",
    "secure": false,
    "changeOrigin": true
  },
  "/__cmp-map": {
    "target": "http://localhost:4123",
    "secure": false,
    "changeOrigin": true
  }
}
```

**트러블슈팅**
1. CORS 에러
`ng serve --proxy-config ngx-locatorjs.proxy.json` 사용 여부 확인
2. npm run 경고
`npm run start -- --proxy-config ngx-locatorjs.proxy.json` 형태로 실행
3. component-map.json not found
`npx locatorjs-scan` 실행 후 `.open-in-editor/component-map.json` 생성 여부 확인
4. 스캔 결과가 비어있거나 컴포넌트가 누락됨
`scan.includeGlobs` 경로 확인 후 재스캔
5. 잘못된 파일이 열리거나 매칭이 안 됨
`workspaceRoot`가 실제 Angular 앱 루트인지 확인
6. 하이라이트가 안 보이거나 info가 null로 나옴
`/__cmp-map` 응답에 내 컴포넌트 클래스명이 포함되는지 확인
7. 에디터가 열리지 않음
CLI 설치 확인 또는 `EDITOR_CMD` 설정
8. 포트 충돌
`ngx-locatorjs.config.json`과 `ngx-locatorjs.proxy.json`에서 포트 일치 여부 확인

**주의**
- 개발 모드에서만 사용하세요. 프로덕션 번들에 포함되지 않도록 `environment.production` 체크를 권장합니다.

**원 커맨드 실행 (추천)**
file-opener 서버와 Angular dev server를 한 번에 띄우려면 아래 방식 중 하나를 사용하세요.

### Option A: `concurrently`
```bash
npm i -D concurrently
```

```json
{
  "scripts": {
    "dev:locator": "concurrently -k -n opener,ng \"npx locatorjs-open-in-editor\" \"ng serve --proxy-config ngx-locatorjs.proxy.json\""
  }
}
```

### Option B: `npm-run-all`
```bash
npm i -D npm-run-all
```

```json
{
  "scripts": {
    "locator:opener": "npx locatorjs-open-in-editor",
    "dev:app": "ng serve --proxy-config ngx-locatorjs.proxy.json",
    "dev:locator": "run-p locator:opener dev:app"
  }
}
```
