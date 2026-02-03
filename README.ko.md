# ngx-locatorjs (Open-in-Editor)

브라우저에서 Alt+클릭으로 Angular 컴포넌트 파일을 에디터에서 바로 여는 개발용 도구입니다. Angular 프로젝트 어디에나 npm 패키지로 설치해 사용할 수 있습니다.

**기능**
- Alt+클릭: 템플릿(.html) 열기
- Alt+Shift+클릭: 컴포넌트(.ts) 열기
- Alt 키 홀드: 컴포넌트 하이라이트 + 툴팁 표시
- Cursor, VS Code, WebStorm 지원

**설치**
1. `npm i -D ngx-locatorjs`
2. `npx locatorjs-config`
3. `npx locatorjs-open-in-editor`
4. Angular dev server를 `--proxy-config proxy.conf.json`으로 실행

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
`ng serve --proxy-config proxy.conf.json`

- angular.json에 적용
`"serve"` 옵션에 `"proxyConfig": "proxy.conf.json"` 추가

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

**open-in-editor.config.json 가이드**
파일 위치: 프로젝트 루트

**중요**
- `npx locatorjs-config`는 **실행한 현재 폴더를 기준**으로 설정합니다.
- 프로젝트 루트에서 실행하고, `workspaceRoot` 질문에서 **Enter**를 누르면 `.`(현재 폴더)로 저장됩니다.
- 모노레포처럼 실제 Angular 앱이 하위 폴더에 있으면 그 **상대 경로**를 입력하세요. (예: `apps/web`)

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
3. `open-in-editor.config.json`의 `editor`
4. 자동 감지된 에디터

**프록시 설정 (proxy.conf.json)**
`npx locatorjs-config` 실행 시 자동 생성됩니다. 기존 파일이 있으면 해당 항목만 병합됩니다.

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
`ng serve --proxy-config proxy.conf.json` 사용 여부 확인
2. component-map.json not found
`npx locatorjs-scan` 실행 후 `.open-in-editor/component-map.json` 생성 여부 확인
3. 에디터가 열리지 않음
CLI 설치 확인 또는 `EDITOR_CMD` 설정
4. 포트 충돌
`open-in-editor.config.json`에서 `port` 변경

**주의**
- 개발 모드에서만 사용하세요. 프로덕션 번들에 포함되지 않도록 `environment.production` 체크를 권장합니다.
