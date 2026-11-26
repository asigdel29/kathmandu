import { readFileSync } from 'node:fs';
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
