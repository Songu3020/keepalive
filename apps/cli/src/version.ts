import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves and reads the current CLI package version dynamically from package.json.
 * Works consistently both in development (src/) and compiled distribution (dist/).
 */
export function getVersion(importMetaUrl: string = import.meta.url): string {
  try {
    const currentDir = dirname(fileURLToPath(importMetaUrl));
    const packageJsonPath = resolve(currentDir, '..', 'package.json');
    const content = readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
