#!/usr/bin/env node
import { Project, SyntaxKind } from 'ts-morph';
import fs from 'fs';
import path from 'path';

type CmpInfo = {
  className: string;
  filePath: string;
  templateUrl?: string;
};

type MapFile = {
  generatedAt: string;
  detailByFilePath: Record<string, CmpInfo>;
  filePathsByClassName: Record<string, string[]>;
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
  'src/**/*.{ts,tsx}',
  'projects/**/*.{ts,tsx}',
  'apps/**/*.{ts,tsx}',
  'libs/**/*.{ts,tsx}',
];

const DEFAULT_EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.angular/**',
  '**/coverage/**',
  '**/*.spec.ts',
  '**/*.test.ts',
  '**/*.e2e.ts',
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

function prefixWorkspaceRoot(glob: string, workspaceRoot: string): string {
  if (!workspaceRoot || workspaceRoot === '.' || workspaceRoot === './') return glob;
  if (path.isAbsolute(glob)) return glob;

  const rootPosix = toPosix(workspaceRoot).replace(/\/+$/, '');
  const globPosix = toPosix(glob).replace(/^\/+/, '');

  if (globPosix.startsWith(rootPosix + '/')) return globPosix;
  return `${rootPosix}/${globPosix}`;
}

function globToNeedle(glob: string): string {
  return toPosix(glob).replace(/\*\*/g, '').replace(/\*/g, '');
}

function isExcluded(filePath: string, excludeGlobs: string[]): boolean {
  const normalized = toPosix(filePath);
  return excludeGlobs.some((pattern) => {
    const needle = globToNeedle(pattern);
    if (!needle) return false;
    return normalized.includes(needle);
  });
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

  function loadCache(): Record<string, number> {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      return {};
    }
  }

  function saveCache(cache: Record<string, number>) {
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

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths(effectiveIncludeGlobs);

  const sourceFiles = project
    .getSourceFiles()
    .filter((sf) => !isExcluded(sf.getFilePath(), excludeGlobs));

  const filePaths = sourceFiles.map((sf) => sf.getFilePath());
  const currentStats = getFileStats(filePaths);
  const previousCache = loadCache();

  const hasChanges = filePaths.some(
    (filePath) => !previousCache[filePath] || previousCache[filePath] !== currentStats[filePath],
  );

  const cachedPaths = Object.keys(previousCache);
  const hasNewOrDeletedFiles =
    filePaths.length !== cachedPaths.length ||
    filePaths.some((p) => !previousCache[p]) ||
    cachedPaths.some((p) => !currentStats[p]);

  if (!hasChanges && !hasNewOrDeletedFiles && fs.existsSync(outFile)) {
    process.exit(0);
  }

  const detailByFilePath: Record<string, CmpInfo> = {};
  const filePathsByClassName: Record<string, string[]> = {};

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath();

    const classes = sf.getClasses();
    for (const cls of classes) {
      const decorators = cls.getDecorators();
      const comp = decorators.find((d) => d.getName() === 'Component');
      if (!comp) continue;

      const arg = comp.getCallExpression()?.getArguments()[0];
      if (!arg || !arg.asKind(SyntaxKind.ObjectLiteralExpression)) continue;

      const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

      const templateUrlProp = obj.getProperty('templateUrl');
      const templateUrl = templateUrlProp
        ?.asKind(SyntaxKind.PropertyAssignment)
        ?.getInitializer()
        ?.getText()
        .replace(/^`|^'|^"|"|'|`$/g, '');

      const className = cls.getName();
      if (!className) continue;

      const absTs = path.resolve(root, filePath);
      const absTpl = templateUrl ? path.resolve(path.dirname(absTs), templateUrl) : undefined;

      detailByFilePath[absTs] = {
        className,
        filePath: absTs,
        templateUrl: absTpl,
      };

      if (!filePathsByClassName[className]) filePathsByClassName[className] = [];
      if (!filePathsByClassName[className].includes(absTs)) {
        filePathsByClassName[className].push(absTs);
      }
    }
  }

  const out: MapFile = {
    generatedAt: new Date().toISOString(),
    detailByFilePath,
    filePathsByClassName,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

  saveCache(currentStats);
  console.log(
    `[cmp-scan] ✅ Saved ${Object.keys(detailByFilePath).length} components to ${path.relative(
      root,
      outFile,
    )}`,
  );
}

main().catch((err) => {
  console.error('[cmp-scan] Failed:', err);
  process.exit(1);
});
