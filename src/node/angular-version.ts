import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

/** Major version of @angular/core installed for the project in `cwd`, or null. */
export function getAngularMajorVersion(cwd: string): number | null {
  try {
    const require = createRequire(path.join(cwd, 'package.json'));
    const pkgPath = require.resolve('@angular/core/package.json');
    const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    const major = Number.parseInt(version ?? '', 10);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

/**
 * Angular 19+ dev builds record each component's source file (class debug info), so the
 * runtime can locate components without the scanned component map.
 */
export const DEBUG_INFO_MIN_ANGULAR = 19;

export function needsComponentScan(cwd: string): boolean {
  const major = getAngularMajorVersion(cwd);
  return major === null || major < DEBUG_INFO_MIN_ANGULAR;
}
