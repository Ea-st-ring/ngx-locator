#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { parseComponentSource } from './component-source.js';

type CmpInfo = {
  className: string;
  filePath: string;
  templateUrl?: string;
  /** 1-based line of the class; absent in maps written by older versions. */
  line?: number;
  selector?: string;
};

type MapFile = {
  generatedAt: string;
  detailByFilePath: Record<string, CmpInfo>;
  filePathsByClassName: Record<string, string[]>;
};

type ScanCacheEntry = {
  mtimeMs: number;
  components: CmpInfo[];
};

type ScanCache = {
  version: 3;
  files: Record<string, ScanCacheEntry>;
};

type ScanConfig = {
  includeGlobs?: string[];
  excludeGlobs?: string[];
};

type OpenInEditorConfig = {
  port?: number;
  workspaceRoot?: string;
  editor?: string;
  fallbackEditor?: string;
  scan?: ScanConfig;
};

const DEFAULT_INCLUDE_GLOBS = [
  'src/**/*.{ts,tsx,js,jsx}',
  'projects/**/*.{ts,tsx,js,jsx}',
  'apps/**/*.{ts,tsx,js,jsx}',
  'libs/**/*.{ts,tsx,js,jsx}',
];

const DEFAULT_EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.angular/**',
  '**/coverage/**',
  '**/*.spec.{ts,tsx,js,jsx}',
  '**/*.test.{ts,tsx,js,jsx}',
  '**/*.e2e.{ts,tsx,js,jsx}',
];

const root = process.cwd();
const CONFIG_FILENAME = 'ngx-locatorjs.config.json';
const configPath = path.resolve(root, CONFIG_FILENAME);

function readConfig(): OpenInEditorConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function prefixWorkspaceRoot(globPattern: string, workspaceRoot: string): string {
  if (!workspaceRoot || workspaceRoot === '.' || workspaceRoot === './') return globPattern;
  if (path.isAbsolute(globPattern)) return globPattern;

  const rootPosix = toPosix(workspaceRoot).replace(/\/+$/, '');
  const globPosix = toPosix(globPattern).replace(/^\/+/, '');

  if (globPosix.startsWith(rootPosix + '/')) return globPosix;
  return `${rootPosix}/${globPosix}`;
}

async function main() {
  const cfg = readConfig();

  const workspaceRoot = cfg.workspaceRoot?.trim() || '.';
  const includeGlobs: string[] = cfg.scan?.includeGlobs ?? DEFAULT_INCLUDE_GLOBS;
  const excludeGlobs: string[] = cfg.scan?.excludeGlobs ?? DEFAULT_EXCLUDE_GLOBS;

  const effectiveIncludeGlobs = includeGlobs.map((g) => prefixWorkspaceRoot(g, workspaceRoot));

  const outDir = path.resolve(root, '.open-in-editor');
  const outFile = path.join(outDir, 'component-map.json');
  const cacheFile = path.join(outDir, 'scan-cache.json');
  fs.mkdirSync(outDir, { recursive: true });

  function loadCache(): ScanCache {
    try {
      const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object') return { version: 3, files: {} };

      const typed = raw as Partial<ScanCache>;
      if (typed.version === 3 && typed.files && typeof typed.files === 'object') {
        return {
          version: 3,
          files: typed.files,
        };
      }

      // Older caches (v2, or the legacy { [filePath]: mtimeMs } shape) lack fields such as
      // selector/line, so every file is reparsed once.
      const files: Record<string, ScanCacheEntry> = {};
      for (const [filePath, mtime] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof mtime === 'number' && filePath !== 'version') {
          files[filePath] = {
            // Force one-time reparsing after legacy-cache migration.
            mtimeMs: -1,
            components: [],
          };
        }
      }
      return { version: 3, files };
    } catch {
      return { version: 3, files: {} };
    }
  }

  function saveCache(cache: ScanCache) {
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }

  function getFileStats(filePaths: string[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const filePath of filePaths) {
      try {
        const stat = fs.statSync(filePath);
        stats[filePath] = stat.mtimeMs;
      } catch {
        // File may have been deleted.
      }
    }
    return stats;
  }

  const allFiles: string[] = [];
  for (const pattern of effectiveIncludeGlobs) {
    const files = await glob(pattern, {
      ignore: excludeGlobs,
      absolute: true,
      cwd: root,
    });
    allFiles.push(...files);
  }

  const filePaths = [...new Set(allFiles)];
  const currentStats = getFileStats(filePaths);
  const previousCache = loadCache();
  const previousFiles = previousCache.files;
  const previousPaths = Object.keys(previousFiles);

  const changedOrNewPaths = filePaths.filter((filePath) => {
    const currentMtime = currentStats[filePath];
    const cached = previousFiles[filePath];
    return !cached || cached.mtimeMs !== currentMtime;
  });

  const deletedPaths = previousPaths.filter((cachedPath) => !currentStats[cachedPath]);

  if (changedOrNewPaths.length === 0 && deletedPaths.length === 0 && fs.existsSync(outFile)) {
    process.exit(0);
  }

  const nextFiles: Record<string, ScanCacheEntry> = {};

  for (const filePath of filePaths) {
    const previous = previousFiles[filePath];
    const currentMtime = currentStats[filePath];
    if (previous && previous.mtimeMs === currentMtime) {
      nextFiles[filePath] = previous;
      continue;
    }

    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const components = parseComponentSource(path.resolve(root, filePath), sourceCode);
    nextFiles[filePath] = {
      mtimeMs: currentMtime,
      components,
    };
  }

  const detailByFilePath: Record<string, CmpInfo> = {};
  const filePathsByClassName: Record<string, string[]> = {};

  for (const entry of Object.values(nextFiles)) {
    const components = entry.components;
    for (const cmp of components) {
      detailByFilePath[cmp.filePath] = cmp;

      if (!filePathsByClassName[cmp.className]) {
        filePathsByClassName[cmp.className] = [];
      }
      if (!filePathsByClassName[cmp.className].includes(cmp.filePath)) {
        filePathsByClassName[cmp.className].push(cmp.filePath);
      }
    }
  }

  const out: MapFile = {
    generatedAt: new Date().toISOString(),
    detailByFilePath,
    filePathsByClassName,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

  saveCache({
    version: 3,
    files: nextFiles,
  });
  console.log(
    `[cmp-scan] ✅ Saved ${Object.keys(detailByFilePath).length} components to ${path.relative(root, outFile)} (updated ${changedOrNewPaths.length}, removed ${deletedPaths.length})`,
  );
}

main().catch((err) => {
  console.error('[cmp-scan] Failed:', err);
  process.exit(1);
});
