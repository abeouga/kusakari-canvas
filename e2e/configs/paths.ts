import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright resolves relative config paths from this folder, so configs here use repo-root paths.
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const fromRoot = (...segments: string[]) => resolve(repoRoot, ...segments);
