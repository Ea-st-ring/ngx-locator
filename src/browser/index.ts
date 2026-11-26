type CmpInfo = {
  className: string;
  filePath: string;
  templateUrl?: string;
  /** 1-based line of the class declaration. */
  line?: number;
  /** Component selector from the scan; absent in maps written by older versions. */
  selector?: string;
};

/**
 * Set by Angular on component definitions in dev builds: className since 17,
 * filePath (relative to the TypeScript root) and lineNumber since 19.
 */
type ClassDebugInfo = {
  className: string;
  filePath?: string;
  lineNumber?: number;
};

type CmpMap = {
  detailByFilePath: Record<string, CmpInfo>;
  filePathsByClassName: Record<string, string[]>;
};

type AngularGlobal = {
  getOwningComponent?: (el: Element) => unknown;
  getComponent?: (el: Element) => unknown;
  getHostElement?: (component: object) => Element | null;
};

type RuntimeComponent = {
  constructor?: {
    name?: string;
  };
};

type LocatorComponent = {
  className: string;
  info: CmpInfo;
  /** Host element of the component whose template contains the target element. */
  hostElement: Element | null;
  /** Set while the template path from Angular's debug info is still being resolved. */
  pending?: Promise<CmpInfo | null>;
};

export type ModifierKey = 'alt' | 'ctrl' | 'meta' | 'shift';

export type AngularLocatorEndpoints = {
  openInEditor: string;
  openInEditorSearch: string;
  componentMap: string;
  /** Resolves Angular debug info (file + class) to the component's files. */
  resolveComponent: string;
};

export type AngularLocatorOptions = {
  endpoints?: Partial<AngularLocatorEndpoints>;
  enableNetwork?: boolean;
  prefetchMap?: boolean;
  enableHover?: boolean;
  enableClick?: boolean;
  showTooltip?: boolean;
  showClickFeedback?: boolean;
  /**
   * Keys to hold for hover and click, joined with `+` (e.g. `'alt'`, `'ctrl+shift'`).
   * Aliases: `option` = alt, `control` = ctrl, `cmd`/`command` = meta. Default: `'alt'`.
   */
  modifier?: string;
  /**
   * Extra key that opens the component `.ts` instead of the template. Default: `'shift'`.
   * `false` disables it. Must not overlap with `modifier`.
   */
  componentModifier?: string | false;
  authToken?: string;
  debug?: boolean;
};

type ResolvedOptions = {
  endpoints: AngularLocatorEndpoints;
  enableNetwork: boolean;
  prefetchMap: boolean;
  enableHover: boolean;
  enableClick: boolean;
  showTooltip: boolean;
  showClickFeedback: boolean;
  modifier: ModifierKey[];
  /** Empty when disabled. */
  componentModifier: ModifierKey[];
  authToken: string | null;
  debug: boolean;
};

const DEFAULT_ENDPOINTS: AngularLocatorEndpoints = {
  openInEditor: '/__open-in-editor',
  openInEditorSearch: '/__open-in-editor-search',
  componentMap: '/__cmp-map',
  // Shares the /__open-in-editor prefix so existing proxy configs forward it.
  resolveComponent: '/__open-in-editor-resolve',
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  endpoints: DEFAULT_ENDPOINTS,
  enableNetwork: false,
  prefetchMap: true,
  enableHover: true,
  enableClick: true,
  showTooltip: true,
  showClickFeedback: true,
  modifier: ['alt'],
  componentModifier: ['shift'],
  authToken: null,
  debug: false,
};

const MODIFIER_ALIASES: Record<string, ModifierKey> = {
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  shift: 'shift',
};

/** Parses `'ctrl+shift'`-style strings. Returns null when any part is unknown or none is given. */
function parseModifiers(value: string): ModifierKey[] | null {
  const parts = value
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const keys: ModifierKey[] = [];
  for (const part of parts) {
    const key = MODIFIER_ALIASES[part];
    if (!key) return null;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function resolveModifierOptions(options: AngularLocatorOptions): {
  modifier: ModifierKey[];
  componentModifier: ModifierKey[];
} {
  let modifier = DEFAULT_OPTIONS.modifier;
  if (options.modifier !== undefined) {
    const parsed = parseModifiers(options.modifier);
    if (parsed) {
      modifier = parsed;
    } else {
      console.warn(
        `[angular-locator] Invalid modifier "${options.modifier}", using "alt". Use keys alt, ctrl, meta, shift joined with "+".`,
      );
    }
  }

  let componentModifier = DEFAULT_OPTIONS.componentModifier;
  if (options.componentModifier === false) {
    componentModifier = [];
  } else if (options.componentModifier !== undefined) {
    const parsed = parseModifiers(options.componentModifier);
    if (parsed) {
      componentModifier = parsed;
    } else {
      console.warn(
        `[angular-locator] Invalid componentModifier "${options.componentModifier}", using "shift".`,
      );
    }
  }

  if (componentModifier.some((key) => modifier.includes(key))) {
    // An overlapping key would make every click open the .ts file.
    console.warn(
      `[angular-locator] componentModifier "${componentModifier.join('+')}" overlaps modifier "${modifier.join('+')}"; opening the .ts file by key is disabled. Set componentModifier to a different key.`,
    );
    componentModifier = [];
  }

  return { modifier, componentModifier };
}

function modifiersPressed(ev: MouseEvent | KeyboardEvent, keys: ModifierKey[]): boolean {
  if (keys.length === 0) return false;
  return keys.every((key) => {
    if (key === 'alt') return ev.altKey;
    if (key === 'ctrl') return ev.ctrlKey;
    if (key === 'meta') return ev.metaKey;
    return ev.shiftKey;
  });
}

function isMacPlatform(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad/i.test(platform);
}

function formatModifiers(keys: ModifierKey[]): string {
  const mac = isMacPlatform();
  const labels: Record<ModifierKey, string> = {
    alt: mac ? 'Option' : 'Alt',
    ctrl: 'Ctrl',
    meta: mac ? 'Cmd' : 'Meta',
    shift: 'Shift',
  };
  return keys.map((key) => labels[key]).join('+');
}

/** Last few path segments, enough to recognize the file without the absolute prefix. */
function shortenPath(filePath: string, segments = 3): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.length <= segments ? parts.join('/') : `…/${parts.slice(-segments).join('/')}`;
}

let OPTIONS: ResolvedOptions = DEFAULT_OPTIONS;
let INSTALLED = false;

let CMP_MAP: CmpMap | null = null;
let mapLoadPromise: Promise<CmpMap | undefined> | null = null;

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isLocalhostHost(hostname: string): boolean {
  if (LOCALHOST_HOSTS.has(hostname)) return true;
  if (hostname.endsWith('.localhost')) return true;
  return false;
}

function assertNetworkAllowed(url: string): string {
  if (!OPTIONS.enableNetwork) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] Network is disabled. Set enableNetwork: true.');
    }
    throw new Error('Network disabled');
  }

  const resolved = new URL(url, window.location.href);
  if (!isLocalhostHost(resolved.hostname)) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] Network is limited to localhost:', resolved.href);
    }
    throw new Error('Network restricted to localhost');
  }

  return resolved.toString();
}

function attachAuthToken(url: string): string {
  if (!OPTIONS.authToken) return url;

  const resolved = new URL(url, window.location.href);
  if (!resolved.searchParams.has('token')) {
    resolved.searchParams.set('token', OPTIONS.authToken);
  }
  return resolved.toString();
}

function getAuthHeaders(): HeadersInit | undefined {
  if (!OPTIONS.authToken) return undefined;
  return {
    'x-locatorjs-token': OPTIONS.authToken,
  };
}

function normalizeMap(map: CmpMap): CmpMap {
  if (!map.filePathsByClassName || Object.keys(map.filePathsByClassName).length === 0) {
    const rebuilt: Record<string, string[]> = {};
    Object.values(map.detailByFilePath).forEach((info) => {
      if (!rebuilt[info.className]) rebuilt[info.className] = [];
      if (!rebuilt[info.className].includes(info.filePath)) {
        rebuilt[info.className].push(info.filePath);
      }
    });
    map.filePathsByClassName = rebuilt;
  }
  return map;
}
async function ensureMap(forceRefresh = false): Promise<CmpMap> {
  if (CMP_MAP && !forceRefresh) return CMP_MAP;

  const timestamp = Date.now();
  const res = await fetch(
    attachAuthToken(assertNetworkAllowed(`${OPTIONS.endpoints.componentMap}?t=${timestamp}`)),
    {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        ...getAuthHeaders(),
      },
    },
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Component map request failed (HTTP ${res.status}): ${text.substring(0, 100)}`);
  }

  try {
    CMP_MAP = normalizeMap(JSON.parse(text));
    return CMP_MAP!;
  } catch (e) {
    if (OPTIONS.debug) {
      console.error('[angular-locator] JSON parse error:', e);
    }
    throw new Error(`Failed to parse response as JSON. Got: ${text.substring(0, 100)}`);
  }
}

/** Loads the map once even when many hover events ask for it at the same time. */
function ensureMapOnce(): Promise<CmpMap | undefined> {
  if (CMP_MAP) return Promise.resolve(CMP_MAP);
  if (!mapLoadPromise) {
    mapLoadPromise = ensureMap().finally(() => {
      mapLoadPromise = null;
    });
  }
  return mapLoadPromise;
}

/**
 * Calculates relevance between the current URL path and a file path.
 * Higher score means stronger relevance.
 */
function calculatePathRelevance(filePath: string, currentUrl: string): number {
  const urlSegments = currentUrl.split('/').filter(Boolean);
  const fileSegments = filePath.split('/').filter(Boolean);

  let score = 0;

  for (const urlSeg of urlSegments) {
    if (fileSegments.includes(urlSeg)) {
      score += 10;
    }
  }

  for (let i = 0; i < urlSegments.length - 1; i++) {
    const pattern = `${urlSegments[i]}/${urlSegments[i + 1]}`;
    if (filePath.includes(pattern)) {
      score += 20;
    }
  }

  const lastUrlSeg = urlSegments[urlSegments.length - 1];
  if (lastUrlSeg && filePath.toLowerCase().includes(lastUrlSeg.toLowerCase())) {
    score += 30;
  }

  return score;
}

/**
 * Picks the best match among multiple files that share the same selector,
 * based on the current URL.
 */
function selectBestMatchingFile(candidates: string[]): string {
  if (candidates.length === 1) return candidates[0];

  const currentUrl = window.location.pathname;

  let bestMatch = candidates[0];
  let bestScore = -1;

  for (const filePath of candidates) {
    const score = calculatePathRelevance(filePath, currentUrl);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = filePath;
    }
  }

  return bestMatch;
}

/**
 * True when the component's scanned selector matches its host element. Uses the DOM's own
 * selector engine, so element, attribute (`[appCard]`), class, and `:not()` selectors work.
 */
function selectorMatchesHost(selector: string, hostElement: Element): boolean {
  try {
    return hostElement.matches(selector);
  } catch {
    // Not valid CSS for the browser; treat as unknown.
    return false;
  }
}

function getComponentInfoByClassName(
  className: string,
  hostElement: Element | null = null,
): CmpInfo | null {
  if (!CMP_MAP) return null;
  const classNameCandidates = getClassNameCandidates(className);

  for (const candidate of classNameCandidates) {
    let candidates = CMP_MAP.filePathsByClassName?.[candidate];
    if (!candidates?.length) continue;

    // Same-named components usually differ by selector; the URL heuristic is the last resort.
    if (candidates.length > 1 && hostElement) {
      const bySelector = candidates.filter((filePath) => {
        const selector = CMP_MAP!.detailByFilePath[filePath]?.selector;
        return selector ? selectorMatchesHost(selector, hostElement) : false;
      });
      if (bySelector.length > 0) candidates = bySelector;
    }

    const filePath = selectBestMatchingFile(candidates);
    const info = CMP_MAP.detailByFilePath[filePath] ?? null;
    if (info) return info;
  }

  return null;
}

function getClassNameCandidates(className: string): string[] {
  const candidates: string[] = [];
  const push = (value: string | undefined) => {
    if (!value) return;
    if (!candidates.includes(value)) candidates.push(value);
  };

  push(className);

  const trimmed = className.replace(/^_+/, '');
  push(trimmed);

  return candidates;
}

function getAngularRuntimeComponent(el: Element): RuntimeComponent | null {
  const ng = (window as Window & { ng?: AngularGlobal }).ng;
  if (!ng) return null;

  const getComponentFn = ng.getOwningComponent || ng.getComponent;
  if (typeof getComponentFn !== 'function') return null;

  let cur: Element | null = el;
  while (cur) {
    try {
      const cmp = getComponentFn(cur) as RuntimeComponent | null | undefined;
      if (cmp) return cmp;
    } catch {
      // ignore
    }
    cur = cur.parentElement;
  }

  return null;
}

function getHostElement(component: RuntimeComponent): Element | null {
  const ng = (window as Window & { ng?: AngularGlobal }).ng;
  if (typeof ng?.getHostElement !== 'function') return null;
  try {
    return ng.getHostElement(component as object) ?? null;
  } catch {
    return null;
  }
}

function getClassDebugInfo(component: RuntimeComponent): ClassDebugInfo | null {
  // '\u0275cmp' is Angular's component definition property, escaped to keep the output ASCII.
  const type = component.constructor as Record<string, { debugInfo?: ClassDebugInfo }> | undefined;
  const debugInfo = type?.['\u0275cmp']?.debugInfo;
  return debugInfo && typeof debugInfo.className === 'string' ? debugInfo : null;
}

/** Resolved debug-info lookups by `filePath#className`; null when the opener could not resolve. */
const resolvedComponents = new Map<string, CmpInfo | null>();
const pendingResolutions = new Map<string, Promise<CmpInfo | null>>();

function resolveDebugInfo(debugInfo: ClassDebugInfo & { filePath: string }) {
  const key = `${debugInfo.filePath}#${debugInfo.className}`;
  const pending = pendingResolutions.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<CmpInfo | null> => {
    const url = attachAuthToken(
      assertNetworkAllowed(
        `${OPTIONS.endpoints.resolveComponent}?file=${encodeURIComponent(debugInfo.filePath)}&className=${encodeURIComponent(debugInfo.className)}`,
      ),
    );
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) {
      // e.g. an older opener without this route: fall back to the component map.
      if (OPTIONS.debug) {
        console.warn(`[angular-locator] Could not resolve ${key} (HTTP ${res.status})`);
      }
      resolvedComponents.set(key, null);
      return null;
    }
    const body = (await res.json()) as {
      className: string;
      filePath: string;
      templateUrl: string | null;
      line: number;
    };
    const info: CmpInfo = {
      className: body.className,
      filePath: body.filePath,
      templateUrl: body.templateUrl ?? undefined,
      line: body.line,
    };
    resolvedComponents.set(key, info);
    return info;
  })()
    .catch((e) => {
      // Network errors are not cached, so the next attempt retries.
      if (OPTIONS.debug) console.warn('[angular-locator] Resolve failed:', e);
      return null;
    })
    .finally(() => pendingResolutions.delete(key));

  pendingResolutions.set(key, promise);
  return promise;
}

/**
 * Finds the component whose template contains `el` and the files to open.
 * Angular's class debug info identifies the exact file even when several components
 * share a class name; the scanned component map is the fallback (older Angular,
 * production-like builds, or an opener that cannot resolve).
 * Returns synchronously for hover: an unresolved debug-info component comes back with
 * `pending` and a provisional .ts-only info.
 */
function getNearestComponent(el: Element): LocatorComponent | null {
  const runtimeComponent = getAngularRuntimeComponent(el);
  if (!runtimeComponent) return null;

  const debugInfo = getClassDebugInfo(runtimeComponent);
  const className = debugInfo?.className ?? runtimeComponent.constructor?.name;
  if (!className) return null;
  const hostElement = getHostElement(runtimeComponent);

  if (debugInfo?.filePath) {
    const key = `${debugInfo.filePath}#${debugInfo.className}`;
    const resolved = resolvedComponents.get(key);
    if (resolved) return { className, info: resolved, hostElement };
    if (!resolvedComponents.has(key) && OPTIONS.enableNetwork) {
      const provisional: CmpInfo = {
        className,
        filePath: debugInfo.filePath,
        line: debugInfo.lineNumber,
      };
      return {
        className,
        info: provisional,
        hostElement,
        pending: resolveDebugInfo({ ...debugInfo, filePath: debugInfo.filePath }),
      };
    }
  }

  if (!CMP_MAP) return null;
  const info = getComponentInfoByClassName(className, hostElement);
  if (!info) return null;
  return { className: info.className, info, hostElement };
}

/** Like getNearestComponent, but waits for debug-info resolution and the component map. */
async function findNearestComponent(el: Element): Promise<LocatorComponent | null> {
  const cmp = getNearestComponent(el);
  if (cmp?.pending) {
    await cmp.pending;
    return findNearestComponent(el);
  }
  if (cmp || CMP_MAP) return cmp;

  try {
    await ensureMapOnce();
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] Failed to load component map:', e);
    }
    return null;
  }
  return getNearestComponent(el);
}

/**
 * Sends an open request and throws on network errors and non-2xx responses,
 * so callers can react (e.g. refresh a stale component map).
 */
async function requestOpen(url: string) {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Open request failed (HTTP ${res.status}): ${body}`);
  }
}

async function openFile(absPath: string, line = 1, col = 1) {
  const url = attachAuthToken(
    assertNetworkAllowed(
      `${OPTIONS.endpoints.openInEditor}?file=${encodeURIComponent(absPath)}&line=${line}&col=${col}`,
    ),
  );
  await requestOpen(url);
}

async function openFileWithSearch(absPath: string, searchTerms: string[]) {
  const url = attachAuthToken(
    assertNetworkAllowed(
      `${OPTIONS.endpoints.openInEditorSearch}?file=${encodeURIComponent(absPath)}&search=${encodeURIComponent(
        JSON.stringify(searchTerms),
      )}`,
    ),
  );
  try {
    await requestOpen(url);
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] Search failed, opening without search:', e);
    }
    await openFile(absPath);
  }
}

function addStyles() {
  if (document.getElementById('angular-locator-styles')) return;

  const style = document.createElement('style');
  style.id = 'angular-locator-styles';
  style.textContent = `
    .dev-highlight-overlay {
      box-sizing: border-box;
      position: fixed;
      pointer-events: none;
      z-index: 99998;
      border-radius: 8px;
      border: 1px solid rgba(96, 165, 250, 0.6);
      background: rgba(96, 165, 250, 0.08);
      box-shadow:
        0 0 0 1px rgba(96, 165, 250, 0.05) inset,
        0 4px 12px rgba(15, 23, 42, 0.18);
      transition: all 0.12s ease;
    }
    .dev-highlight-target {
      box-sizing: border-box;
      position: fixed;
      pointer-events: none;
      z-index: 99998;
      border-radius: 4px;
      border: 1px dashed rgba(96, 165, 250, 0.9);
    }
    .dev-tooltip {
      position: absolute;
      background: rgba(15, 23, 42, 0.9);
      color: #e5e7eb;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.28);
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      z-index: 99999;
      pointer-events: none;
      white-space: nowrap;
      letter-spacing: 0.2px;
      line-height: 1.5;
    }
    .dev-tooltip-name {
      color: #f8fafc;
      font-weight: 600;
    }
    .dev-tooltip-path,
    .dev-tooltip-hint {
      color: #94a3b8;
    }
    .dev-click-feedback {
      position: fixed;
      background: rgba(15, 23, 42, 0.9);
      color: #e2e8f0;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.25);
      box-shadow:
        0 8px 24px rgba(15, 23, 42, 0.4),
        0 0 14px rgba(34, 211, 238, 0.25);
      font-size: 13px;
      font-weight: 500;
      z-index: 100000;
      animation: dev-fade-out 1.6s ease-out forwards;
    }
    @keyframes dev-fade-out {
      0% { opacity: 0; transform: translateY(6px) scale(0.98); }
      15% { opacity: 1; transform: translateY(0) scale(1); }
      100% { opacity: 0; transform: translateY(-8px) scale(0.99); }
    }
  `;
  document.head.appendChild(style);
}

function showClickFeedback(x: number, y: number, message: string) {
  if (!OPTIONS.showClickFeedback) return;
  const feedback = document.createElement('div');
  feedback.className = 'dev-click-feedback';
  feedback.textContent = message;
  feedback.style.left = x + 'px';
  feedback.style.top = y + 'px';
  document.body.appendChild(feedback);

  setTimeout(() => feedback.remove(), 2000);
}

function findTemplatePosition(
  clickedElement: Element,
  componentElement: Element,
): { line?: number; searchTerms: string[] } {
  const searchTerms: string[] = [];

  if (clickedElement.id) {
    searchTerms.push(`id="${clickedElement.id}"`);
    searchTerms.push(`#${clickedElement.id}`);
  }

  const classes = Array.from(clickedElement.classList).filter(
    (cls) => !cls.startsWith('ng-') && !cls.startsWith('_ng') && cls.length > 2,
  );

  if (classes.length > 0) {
    searchTerms.push(`class="${classes.join(' ')}"`);
    classes.forEach((cls) => searchTerms.push(`${cls}`));
  }

  const tagName = clickedElement.tagName.toLowerCase();
  searchTerms.push(`<${tagName}`);

  Array.from(clickedElement.attributes).forEach((attr) => {
    if (attr.name.startsWith('(') || attr.name.startsWith('[') || attr.name.startsWith('*')) {
      searchTerms.push(attr.name);
    }
    if (attr.name.startsWith('data-') || attr.name.includes('ng-')) {
      return;
    }
    if (attr.value && attr.value.length > 0 && attr.value.length < 50) {
      searchTerms.push(`${attr.name}="${attr.value}"`);
    }
  });

  const text = clickedElement.textContent?.trim();
  if (text && text.length > 3 && text.length < 100 && !text.includes('\n')) {
    searchTerms.push(text);
  }

  const parent = clickedElement.parentElement;
  if (parent && parent !== componentElement) {
    const parentTag = parent.tagName.toLowerCase();
    searchTerms.push(`${parentTag} ${tagName}`);
    searchTerms.push(`<${parentTag}.*<${tagName}`);
  }

  return { searchTerms };
}

function isComponentModifierPressed(ev: MouseEvent | KeyboardEvent): boolean {
  return modifiersPressed(ev, OPTIONS.componentModifier);
}

async function handleOpen(ev: MouseEvent | PointerEvent, el: Element) {
  const cmp = await findNearestComponent(el);
  if (!cmp) return;

  const openComponentFile = isComponentModifierPressed(ev);
  const { className, info } = cmp;

  const targetFile = openComponentFile ? 'component' : info.templateUrl ? 'template' : 'component';
  showClickFeedback(ev.clientX, ev.clientY, `Opening ${className} ${targetFile}...`);

  const open = async (target: CmpInfo) => {
    if (openComponentFile || !target.templateUrl) {
      await openFile(target.filePath, target.line ?? 1);
    } else {
      const position = findTemplatePosition(el, el);
      await openFileWithSearch(target.templateUrl, position.searchTerms);
    }
  };

  try {
    await open(info);
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] File opening failed, refreshing component map:', e);
    }
    showClickFeedback(ev.clientX, ev.clientY, 'File not found, refreshing map...');

    await refreshComponentMap();

    const newInfo = getNearestComponent(el)?.info;

    if (newInfo) {
      showClickFeedback(ev.clientX, ev.clientY, 'Retrying with updated map...');
      try {
        await open(newInfo);
      } catch (retryError) {
        if (OPTIONS.debug) {
          console.warn('[angular-locator] Retry failed:', retryError);
        }
        showClickFeedback(ev.clientX, ev.clientY, 'Failed to open file');
      }
    } else {
      showClickFeedback(ev.clientX, ev.clientY, 'Component not found in updated map');
    }
  }
}

async function handleClick(ev: MouseEvent) {
  if (!OPTIONS.enableClick) return;
  if (!modifiersPressed(ev, OPTIONS.modifier)) return;

  ev.preventDefault();
  ev.stopPropagation();

  const el = ev.target as Element | null;
  if (!el) return;

  await handleOpen(ev, el);
}

/**
 * On macOS, Ctrl+click opens the context menu and no click event follows,
 * so a modifier that includes Ctrl is handled through `contextmenu` there.
 */
async function handleContextMenu(ev: MouseEvent) {
  if (!OPTIONS.enableClick) return;
  if (!ev.ctrlKey || !isMacPlatform()) return;
  if (!modifiersPressed(ev, OPTIONS.modifier)) return;

  ev.preventDefault();
  ev.stopPropagation();

  const el = ev.target as Element | null;
  if (!el) return;

  await handleOpen(ev, el);
}

type PointerState = { target: Element; x: number; y: number };

let hoverActive = false;
/** Latest pointer position, so holding the modifier highlights without moving the mouse. */
let lastPointer: PointerState | null = null;
let currentTooltip: HTMLElement | null = null;
let currentHighlightOverlay: HTMLElement | null = null;
let currentTargetOverlay: HTMLElement | null = null;
let lastRenderKey: { target: Element; componentMode: boolean } | null = null;

function removeHighlights() {
  currentHighlightOverlay?.remove();
  currentHighlightOverlay = null;
  currentTargetOverlay?.remove();
  currentTargetOverlay = null;
  currentTooltip?.remove();
  currentTooltip = null;
  lastRenderKey = null;
}

function deactivateHover() {
  hoverActive = false;
  removeHighlights();
}

function createOverlay(className: string, rect: DOMRect): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = className;
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  document.body.appendChild(overlay);
  return overlay;
}

function buildTooltip(cmp: LocatorComponent, componentMode: boolean): HTMLElement {
  const { className, info } = cmp;
  const opensTemplate = !componentMode && Boolean(info.templateUrl);
  const targetPath = opensTemplate ? info.templateUrl! : info.filePath;

  const hints: string[] = [];
  if (info.templateUrl) hints.push('Click: template');
  else hints.push('Click: .ts');
  if (info.templateUrl && OPTIONS.componentModifier.length > 0) {
    hints.push(`${formatModifiers(OPTIONS.componentModifier)}+Click: .ts`);
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'dev-tooltip';
  const rows: Array<[string, string]> = [
    ['dev-tooltip-name', className],
    ['dev-tooltip-path', shortenPath(targetPath)],
    ['dev-tooltip-hint', hints.join(' • ')],
  ];
  for (const [rowClass, text] of rows) {
    const row = document.createElement('div');
    row.className = rowClass;
    row.textContent = text;
    tooltip.appendChild(row);
  }
  return tooltip;
}

function renderHover(pointer: PointerState, componentMode: boolean) {
  if (
    lastRenderKey &&
    lastRenderKey.target === pointer.target &&
    lastRenderKey.componentMode === componentMode
  ) {
    return;
  }

  removeHighlights();
  lastRenderKey = { target: pointer.target, componentMode };

  const cmp = getNearestComponent(pointer.target);
  if (!cmp) return;
  if (cmp.pending) {
    // Re-render with the resolved template path if the pointer is still there.
    void cmp.pending.then(() => {
      if (hoverActive && lastPointer?.target === pointer.target) {
        lastRenderKey = null;
        renderHover(lastPointer, componentMode);
      }
    });
  }

  try {
    // Outline the whole component so it is clear which file a click opens,
    // and mark the hovered element the template search will look for.
    const host = cmp.hostElement ?? pointer.target;
    currentHighlightOverlay = createOverlay('dev-highlight-overlay', host.getBoundingClientRect());
    if (host !== pointer.target) {
      currentTargetOverlay = createOverlay(
        'dev-highlight-target',
        pointer.target.getBoundingClientRect(),
      );
    }

    if (OPTIONS.showTooltip) {
      const tooltip = buildTooltip(cmp, componentMode);
      tooltip.style.left = pointer.x + 10 + 'px';
      tooltip.style.top = pointer.y + 14 + 'px';
      document.body.appendChild(tooltip);
      currentTooltip = tooltip;
    }
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] Failed during hover:', e);
    }
  }
}

/** Shows or hides the hover UI for the current modifier state. */
async function updateHover(ev: MouseEvent | KeyboardEvent) {
  if (!OPTIONS.enableHover) return;

  if (!modifiersPressed(ev, OPTIONS.modifier)) {
    if (hoverActive) deactivateHover();
    return;
  }
  hoverActive = true;
  if (!lastPointer) return;

  const componentMode = isComponentModifierPressed(ev);
  if (!CMP_MAP && !getNearestComponent(lastPointer.target)) {
    // Components without debug info need the map; load it, then render.
    try {
      await ensureMapOnce();
    } catch {
      return;
    }
    // The modifier may have been released while the map was loading.
    if (!hoverActive || !lastPointer) return;
  }

  renderHover(lastPointer, componentMode);
}

function handleMouseMove(ev: MouseEvent) {
  const target = ev.target;
  if (!(target instanceof Element)) return;
  lastPointer = { target, x: ev.clientX, y: ev.clientY };
  if (!hoverActive && !modifiersPressed(ev, OPTIONS.modifier)) return;
  void updateHover(ev);
}

function handleKeyChange(ev: KeyboardEvent) {
  void updateHover(ev);
}

async function installInternal(options: ResolvedOptions) {
  if (INSTALLED) return;
  INSTALLED = true;

  OPTIONS = options;

  addStyles();

  if (OPTIONS.prefetchMap) {
    try {
      await ensureMap();
      if (OPTIONS.debug) {
        console.log('[angular-locator] Component map preloaded successfully');
      }
    } catch (e) {
      if (OPTIONS.debug) {
        console.warn('[angular-locator] Failed to preload component map:', e);
      }
    }
  }

  if (OPTIONS.enableClick) {
    document.addEventListener('click', handleClick, true);
    if (OPTIONS.modifier.includes('ctrl')) {
      document.addEventListener('contextmenu', handleContextMenu, true);
    }
  }
  if (OPTIONS.enableHover) {
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('keydown', handleKeyChange);
    document.addEventListener('keyup', handleKeyChange);
  }

  window.addEventListener(
    'scroll',
    () => {
      if (currentHighlightOverlay) {
        removeHighlights();
      }
    },
    { passive: true },
  );

  window.addEventListener('resize', () => {
    if (currentHighlightOverlay) {
      removeHighlights();
    }
  });

  window.addEventListener('blur', deactivateHover);
}

export async function installAngularLocator(options: AngularLocatorOptions = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const mergedOptions: ResolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    ...resolveModifierOptions(options),
    authToken: options.authToken ?? DEFAULT_OPTIONS.authToken,
    endpoints: {
      ...DEFAULT_ENDPOINTS,
      ...options.endpoints,
    },
  };

  await installInternal(mergedOptions);
}

export async function refreshComponentMap() {
  try {
    CMP_MAP = null;
    await ensureMap(true);
  } catch (e) {
    if (OPTIONS.debug) {
      console.error('[angular-locator] Failed to refresh component map:', e);
    }
  }
}

export async function preloadComponentMap() {
  await ensureMap();
}

export function isAngularLocatorInstalled() {
  return INSTALLED;
}

export const _internal = {
  ensureMap,
  parseModifiers,
  resolveModifierOptions,
  modifiersPressed,
  shortenPath,
};
