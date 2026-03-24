#!/usr/bin/env node
import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

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

function prefixWorkspaceRoot(globPattern: string, workspaceRoot: string): string {
  if (!workspaceRoot || workspaceRoot === '.' || workspaceRoot === './') return globPattern;
  if (path.isAbsolute(globPattern)) return globPattern;

  const rootPosix = toPosix(workspaceRoot).replace(/\/+$/, '');
  const globPosix = toPosix(globPattern).replace(/^\/+/, '');

  if (globPosix.startsWith(rootPosix + '/')) return globPosix;
  return `${rootPosix}/${globPosix}`;
}

function extractTemplateUrl(node: ts.ObjectLiteralExpression): string | undefined {
  for (const prop of node.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'templateUrl'
    ) {
      const initializer = prop.initializer;
      if (ts.isStringLiteral(initializer)) {
        return initializer.text;
      }
    }
  }
  return undefined;
}

function findComponentDecorator(node: ts.ClassDeclaration): ts.Decorator | undefined {
  if (!node.modifiers) return undefined;

  for (const modifier of node.modifiers) {
    if (ts.isDecorator(modifier)) {
      const expr = modifier.expression;
      if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
        if (expr.expression.text === 'Component') {
          return modifier;
        }
      }
    }
  }
  return undefined;
}

function parseSourceFile(filePath: string, sourceCode: string): CmpInfo[] {
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

  const components: CmpInfo[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const componentDecorator = findComponentDecorator(node);
      if (componentDecorator) {
        const expr = componentDecorator.expression as ts.CallExpression;
        const firstArg = expr.arguments[0];

        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          const templateUrl = extractTemplateUrl(firstArg);
          const className = node.name.text;

          const absTs = path.resolve(root, filePath);
          const absTpl = templateUrl ? path.resolve(path.dirname(absTs), templateUrl) : undefined;

          components.push({
            className,
            filePath: absTs,
            templateUrl: absTpl,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return components;
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

  for (const filePath of filePaths) {
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const components = parseSourceFile(filePath, sourceCode);

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
