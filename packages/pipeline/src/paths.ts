import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Repository root. Resolved from the module URL so it works under Bun and under Node (vitest). */
export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
export const PATHS = {
  root: ROOT,
  data: `${ROOT}/data`,
  features: `${ROOT}/data/features`,
  terrain: `${ROOT}/data/terrain`,
  dist: `${ROOT}/dist`,
  tiles: `${ROOT}/dist/tiles`,
  shots: `${ROOT}/dist/shots`,
  world: `${ROOT}/world`,
} as const;
