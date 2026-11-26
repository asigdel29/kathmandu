import { resolve } from 'node:path';
export const ROOT = resolve(import.meta.dir, '../../..');
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
