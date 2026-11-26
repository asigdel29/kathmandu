import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { HEIGHTMAP_N } from '@ktm/geo';

const FIX = new URL('./fixtures/mini-features.geojsonl', import.meta.url).pathname;

export interface FixtureInputs { featuresDir: string; terrainDir: string; worldDir: string; outRoot: string }

/** Inputs for x14_y17 in a temp dir: one building, one 100 m primary road, flat ground at 1350 m. */
export function fixtureInputs(): FixtureInputs {
  const root = mkdtempSync(`${tmpdir()}/ktm-tile-`);
  const featuresDir = `${root}/features`, terrainDir = `${root}/terrain`, worldDir = `${root}/world`, outRoot = `${root}/tiles`;
  for (const d of [featuresDir, terrainDir, worldDir, outRoot]) mkdirSync(d, { recursive: true });
  copyFileSync(FIX, `${featuresDir}/x14_y17.geojsonl`);
  const hm = new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N).fill(1350);
  writeFileSync(`${terrainDir}/x14_y17.f32`, new Uint8Array(hm.buffer));
  return { featuresDir, terrainDir, worldDir, outRoot };
}
