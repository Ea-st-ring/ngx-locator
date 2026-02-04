type CmpInfo = {
  className: string;
  filePath: string;
  templateUrl?: string;
};

type CmpMap = {
  detailByFilePath: Record<string, CmpInfo>;
  filePathsByClassName: Record<string, string[]>;
};

export type AngularLocatorEndpoints = {
  openInEditor: string;
  openInEditorSearch: string;
  componentMap: string;
};

export type AngularLocatorOptions = {
  endpoints?: Partial<AngularLocatorEndpoints>;
  prefetchMap?: boolean;
  enableHover?: boolean;
  enableClick?: boolean;
  showTooltip?: boolean;
  showClickFeedback?: boolean;
  debug?: boolean;
};

type ResolvedOptions = {
  endpoints: AngularLocatorEndpoints;
  prefetchMap: boolean;
  enableHover: boolean;
  enableClick: boolean;
  showTooltip: boolean;
  showClickFeedback: boolean;
  debug: boolean;
};

const DEFAULT_ENDPOINTS: AngularLocatorEndpoints = {
  openInEditor: '/__open-in-editor',
  openInEditorSearch: '/__open-in-editor-search',
  componentMap: '/__cmp-map',
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  endpoints: DEFAULT_ENDPOINTS,
  prefetchMap: true,
  enableHover: true,
  enableClick: true,
  showTooltip: true,
  showClickFeedback: true,
  debug: false,
};

let OPTIONS: ResolvedOptions = DEFAULT_OPTIONS;
let INSTALLED = false;

let CMP_MAP: CmpMap | null = null;
let mapLoadPromise: Promise<CmpMap | undefined> | null = null;

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
  const res = await fetch(`${OPTIONS.endpoints.componentMap}?t=${timestamp}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });

  const text = await res.text();

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

function ensureMapIfNeeded() {
  if (CMP_MAP || mapLoadPromise) return;
  mapLoadPromise = ensureMap()
    .catch(() => undefined)
    .finally(() => {
      mapLoadPromise = null;
    });
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

function getComponentInfoByClassName(className: string): CmpInfo | null {
  if (!CMP_MAP) return null;
  const classNameCandidates = getClassNameCandidates(className);

  for (const candidate of classNameCandidates) {
    const candidates = CMP_MAP.filePathsByClassName?.[candidate];
    if (!candidates?.length) continue;

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

function getAngularRuntimeComponent(el: Element): any | null {
  const ng = (window as any).ng;
  if (!ng) return null;

  const getComponentFn = ng.getOwningComponent || ng.getComponent;
  if (typeof getComponentFn !== 'function') return null;

  let cur: Element | null = el;
  while (cur) {
    try {
      const cmp = getComponentFn(cur);
      if (cmp) return cmp;
    } catch {
      // ignore
    }
    cur = cur.parentElement;
  }

  return null;
}

function getNearestComponent(el: Element): any | null {
  if (!CMP_MAP) return null;

  const runtimeComponent = getAngularRuntimeComponent(el);
  const runtimeClassName = runtimeComponent?.constructor?.name;
  if (!runtimeClassName) return null;

  const info = getComponentInfoByClassName(runtimeClassName);
  if (!info) return null;

  return {
    constructor: { name: info.className },
    __isMockComponent: true,
    __cmpInfo: info,
  };
}

async function openFile(absPath: string, line = 1, col = 1) {
  const url = `${OPTIONS.endpoints.openInEditor}?file=${encodeURIComponent(absPath)}&line=${line}&col=${col}`;
  try {
    await fetch(url);
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn(e);
    }
  }
}

async function openFileWithSearch(absPath: string, searchTerms: string[]) {
  const url = `${OPTIONS.endpoints.openInEditorSearch}?file=${encodeURIComponent(absPath)}&search=${encodeURIComponent(
    JSON.stringify(searchTerms),
  )}`;
  try {
    await fetch(url);
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] Search failed:', e);
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

async function handleAltOpen(ev: MouseEvent | PointerEvent, el: Element) {
  if (!CMP_MAP) {
    try {
      await ensureMap();
    } catch (e) {
      if (OPTIONS.debug) {
        console.warn('[angular-locator] Failed to load component map on click:', e);
      }
    }
  }

  const cmp = getNearestComponent(el);
  if (!cmp) return;

  const className = cmp.constructor?.name;
  const info: CmpInfo | undefined = cmp.__cmpInfo;
  if (!info) return;

  const targetFile = ev.shiftKey ? 'component' : info.templateUrl ? 'template' : 'component';
  showClickFeedback(ev.clientX, ev.clientY, `Opening ${className} ${targetFile}...`);

  try {
    if (ev.shiftKey) {
      await openFile(info.filePath);
    } else if (info.templateUrl) {
      const position = findTemplatePosition(el, el);
      await openFileWithSearch(info.templateUrl, position.searchTerms);
    } else {
      await openFile(info.filePath);
    }
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] File opening failed, refreshing component map:', e);
    }
    showClickFeedback(ev.clientX, ev.clientY, 'File not found, refreshing map...');

    await refreshComponentMap();

    const newCmp = getNearestComponent(el);
    const newInfo: CmpInfo | undefined = newCmp?.__cmpInfo;

    if (newInfo) {
      showClickFeedback(ev.clientX, ev.clientY, 'Retrying with updated map...');
      if (ev.shiftKey) {
        await openFile(newInfo.filePath);
      } else if (newInfo.templateUrl) {
        const position = findTemplatePosition(el, el);
        await openFileWithSearch(newInfo.templateUrl, position.searchTerms);
      } else {
        await openFile(newInfo.filePath);
      }
    } else {
      showClickFeedback(ev.clientX, ev.clientY, 'Component not found in updated map');
    }
  }
}

async function handleAltClick(ev: MouseEvent) {
  if (!OPTIONS.enableClick) return;
  if (!ev.altKey) return;

  ev.preventDefault();
  ev.stopPropagation();

  const el = ev.target as Element | null;
  if (!el) return;

  await handleAltOpen(ev, el);
}

let isAltPressed = false;
let currentTooltip: HTMLElement | null = null;
let currentHighlightOverlay: HTMLElement | null = null;
let lastHighlightedElement: Element | null = null;

function removeHighlights() {
  if (currentHighlightOverlay) {
    currentHighlightOverlay.remove();
    currentHighlightOverlay = null;
  }
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

async function handleMouseMove(ev: MouseEvent) {
  if (!OPTIONS.enableHover) return;
  if (!isAltPressed || !ev.altKey) {
    if (isAltPressed && !ev.altKey) {
      isAltPressed = false;
      document.removeEventListener('mousemove', handleMouseMove);
      removeHighlights();
    }
    return;
  }

  if (!CMP_MAP) {
    ensureMapIfNeeded();
    return;
  }

  const el = ev.target as Element;
  if (lastHighlightedElement === el) return;
  lastHighlightedElement = el;

  removeHighlights();

  const cmp = getNearestComponent(el);
  if (!cmp) return;

  const className = cmp.constructor?.name;
  const info: CmpInfo | undefined = cmp.__cmpInfo;
  if (!className || !info) return;

  try {
    const rect = el.getBoundingClientRect();

    const overlay = document.createElement('div');
    overlay.className = 'dev-highlight-overlay';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    document.body.appendChild(overlay);
    currentHighlightOverlay = overlay;

    if (OPTIONS.showTooltip) {
      const tooltip = document.createElement('div');
      tooltip.className = 'dev-tooltip';
      tooltip.textContent = `${className} • Click: template • Shift+Click: .ts`;
      tooltip.style.left = ev.clientX + 10 + 'px';
      tooltip.style.top = ev.clientY - 30 + 'px';

      document.body.appendChild(tooltip);
      currentTooltip = tooltip;
    }
  } catch (e) {
    if (OPTIONS.debug) {
      console.warn('[angular-locator] Failed during hover:', e);
    }
  }
}

function handleKeyDown(ev: KeyboardEvent) {
  if (!OPTIONS.enableHover) return;
  if ((ev.key === 'Alt' || ev.key === 'AltGraph') && !isAltPressed) {
    isAltPressed = true;
    document.addEventListener('mousemove', handleMouseMove);
  }
}

function handleKeyUp(ev: KeyboardEvent) {
  if (!OPTIONS.enableHover) return;
  if ((ev.key === 'Alt' || ev.key === 'AltGraph' || !ev.altKey) && isAltPressed) {
    isAltPressed = false;
    document.removeEventListener('mousemove', handleMouseMove);
    removeHighlights();
  }
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
    document.addEventListener('click', handleAltClick, true);
  }
  if (OPTIONS.enableHover) {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
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

  window.addEventListener('blur', () => {
    isAltPressed = false;
    removeHighlights();
  });
}

export async function installAngularLocator(options: AngularLocatorOptions = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const mergedOptions: ResolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
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
};
