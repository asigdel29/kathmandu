import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { HEIGHTMAP_N } from '@ktm/geo';
import { Nav, PropsFile, TileMeta } from '@ktm/schema';
import { fixtureInputs } from '../../test/fixture-tile.ts';
import { buildTile } from './tile.ts';

it('builds a fixture tile with valid meta, nav and props', async () => {
  const inp = fixtureInputs();
  const dir = `${inp.outRoot}/x14_y17`;
  const res = await buildTile('x14_y17', { ...inp, outDir: dir, quiet: true });
  const meta = TileMeta.parse(JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8')));
  expect(meta.counts.buildings).toBe(1);
  expect(meta.counts.roadSegments).toBe(1);
  expect(meta.triangles.terrain).toBe(64 * 64 * 2);
  expect(meta.baseY).toBe(50);
  const nav = Nav.parse(JSON.parse(readFileSync(`${dir}/nav.json`, 'utf8')));
  expect(nav.nodes).toHaveLength(2);
  expect(nav.edges).toHaveLength(1);
  const props = PropsFile.parse(JSON.parse(readFileSync(`${dir}/props.json`, 'utf8')));
  expect(props.props.filter((p) => p.type === 'streetlight')).toHaveLength(3);
  expect(readFileSync(`${dir}/height.f32`).byteLength).toBe(HEIGHTMAP_N * HEIGHTMAP_N * 4);
  expect(res.meta.inputsHash).toBe(meta.inputsHash);
});

it('hashes inputs deterministically', async () => {
  const inp = fixtureInputs();
  const a = await buildTile('x14_y17', { ...inp, outDir: `${inp.outRoot}/a`, quiet: true });
  const b = await buildTile('x14_y17', { ...inp, outDir: `${inp.outRoot}/b`, quiet: true });
  expect(a.meta.inputsHash).toBe(b.meta.inputsHash);
});

it('keeps the border flag when a road vertex lies within 1 cm of the tile edge', async () => {
  const inp = fixtureInputs();
  const dir = `${inp.outRoot}/x14_y17`;
  // A junction vertex at x = 799.999 and the seam crossing at x = 800 quantise to the same nav id.
  // One road runs west from the junction; the other is only the 1 mm stub up to the seam.
  const road = (id: string, coordinates: number[][], borderEnd: boolean) => ({ id, kind: 'road', geometry: { type: 'LineString', coordinates }, properties: { highway: 'residential', borderStart: false, borderEnd } });
  const roads = [road('w300', [[799.999, 400], [700, 400]], false), road('w301', [[799.999, 400], [800, 400]], true)];
  writeFileSync(`${inp.featuresDir}/x14_y17.geojsonl`, roads.map((r) => `${JSON.stringify(r)}\n`).join(''));
  await buildTile('x14_y17', { ...inp, outDir: dir, quiet: true });
  const nav = Nav.parse(JSON.parse(readFileSync(`${dir}/nav.json`, 'utf8')));
  expect(nav.nodes).toHaveLength(2);
  const border = nav.nodes.filter((n) => n.border);
  expect(border).toHaveLength(1);
  expect(border[0]!.x).toBeCloseTo(800, 2);
  expect(nav.edges).toHaveLength(1);
});
