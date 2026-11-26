import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { partition } from './partition.ts';
const FIX = new URL('../../test/fixtures/mini.geojsonl', import.meta.url).pathname;

it('writes tile-local features per tile and a summary with neighborhood and kind', async () => {
  const out = mkdtempSync(`${tmpdir()}/ktm-part-`);
  const summary = await partition({ input: FIX, outDir: out });
  const t14 = readFileSync(`${out}/x14_y17.geojsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const t15 = readFileSync(`${out}/x15_y17.geojsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(t14.map((f) => f.kind).sort()).toEqual(['building', 'road']);
  expect(t15.map((f) => f.kind)).toEqual(['road']);
  const bld = t14.find((f) => f.kind === 'building')!;
  for (const [x, z] of bld.geometry.coordinates[0]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(800); expect(z).toBeGreaterThanOrEqual(0); expect(z).toBeLessThan(800); }
  const road14 = t14.find((f) => f.kind === 'road')!;
  expect(road14.properties.borderEnd).toBe(true);
  expect(summary.tiles['x14_y17']).toMatchObject({ buildings: 1, roads: 1, kind: 'terrain', neighborhood: 'Basantapur' });
  expect(summary.tiles['x15_y17']).toMatchObject({ roads: 1 });
});
