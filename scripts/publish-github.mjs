import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const root = process.cwd();
const pkgPath = path.resolve(root, 'package.json');
const original = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(original);

const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
const owner = process.env.GH_PKG_SCOPE || extractOwner(repoUrl);

if (!owner) {
  console.error(
    '[publish:github] Could not determine GitHub owner. Set GH_PKG_SCOPE=<owner> and retry.',
  );
  process.exit(1);
}

const baseName = pkg.name.includes('/') ? pkg.name.split('/').pop() : pkg.name;
pkg.name = `@${owner}/${baseName}`;
pkg.publishConfig = {
  ...(pkg.publishConfig ?? {}),
  registry: 'https://npm.pkg.github.com',
  access: 'public',
};

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

try {
  const result = spawnSync(
    'npm',
    ['publish', '--registry', 'https://npm.pkg.github.com', '--access', 'public'],
    {
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  fs.writeFileSync(pkgPath, original);
}

function extractOwner(url) {
  if (!url) return null;
  const cleaned = url.replace(/^git\\+/, '').replace(/\\.git$/, '');
  const match = cleaned.match(/github\\.com[:/](.+?)\\/ / i);
  return match ? match[1] : null;
}
