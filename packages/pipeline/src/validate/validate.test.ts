import { readFileSync, writeFileSync } from 'node:fs';
import { HEIGHTMAP_N } from '@ktm/geo';
import { expect, it } from 'vitest';
import { fixtureInputs } from '../../test/fixture-tile.ts';
import { buildTile } from '../build/tile.ts';
import { seamErrors, validateTile } from './validate.ts';

async function builtFixture(): Promise<string> {
  const inp = fixtureInputs();
  const dir = `${inp.outRoot}/x14_y17`;
  await buildTile('x14_y17', { ...inp, outDir: dir, quiet: true });
  return dir;
}

it('accepts a freshly built tile', async () => {
  const res = await validateTile(await builtFixture());
  expect(res.errors).toEqual([]);
  expect(res.ok).toBe(true);
});

it('rejects a prop outside the tile', async () => {
  const dir = await builtFixture();
  const props = JSON.parse(readFileSync(`${dir}/props.json`, 'utf8'));
  props.props[0].x = 5000;
  writeFileSync(`${dir}/props.json`, JSON.stringify(props));
  const res = await validateTile(dir);
  expect(res.ok).toBe(false);
  expect(res.errors).toHaveLength(1);
  expect(res.errors[0]).toContain('props[0]');
});

it('rejects a truncated heightmap', async () => {
  const dir = await builtFixture();
  writeFileSync(`${dir}/height.f32`, new Uint8Array(100));
  const res = await validateTile(dir);
  expect(res.errors.some((e) => e.includes('height.f32'))).toBe(true);
});

it('rejects a tile with 6,000 props and accepts one with 5,999', async () => {
  const dir = await builtFixture();
  const props = JSON.parse(readFileSync(`${dir}/props.json`, 'utf8'));
  const tree = { type: 'tree', x: 400, y: 50, z: 400, rotY: 0, scale: 1 };
  props.props = Array.from({ length: 5_999 }, () => tree);
  writeFileSync(`${dir}/props.json`, JSON.stringify(props));
  expect((await validateTile(dir)).errors).toEqual([]);
  props.props.push(tree);
  writeFileSync(`${dir}/props.json`, JSON.stringify(props));
  const res = await validateTile(dir);
  expect(res.ok).toBe(false);
  expect(res.errors).toEqual(['props: 6000 props, the budget is under 6000']);
});

it('reports border nodes missing on the other side of a seam', () => {
  const node = (id: string, x: number, z: number) => ({ id, x, y: 0, z, border: true });
  const edge = (from: string, to: string) => ({ from, to, lanes: 1, oneway: false, speed: 25, cls: 'residential', width: 6 });
  // x14_y17 east edge (x = 800) meets x15_y17 west edge (x = 0).
  const a = { nodes: [node('n_1_1', 800, 100), node('n_2_2', 800, 300), node('n_9_9', 700, 100)], edges: [edge('n_1_1', 'n_9_9'), edge('n_2_2', 'n_9_9')] };
  const b = { nodes: [node('n_1_1', 0, 100), node('n_8_8', 100, 100)], edges: [edge('n_1_1', 'n_8_8')] };
  const errs = seamErrors('x14_y17', a, (id) => (id === 'x15_y17' ? b : undefined));
  expect(errs).toHaveLength(1);
  expect(errs[0]).toContain('x15_y17');
  expect(errs[0]).toContain('n_2_2');
  expect(seamErrors('x14_y17', a, () => undefined)).toEqual([]);
});

/** Heightmap rising linearly west->east from 1300 m to 1300 + `rise` m (Y = 0 .. rise). */
function slopeHeightmap(rise: number): Uint8Array {
  const hm = new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N);
  for (let r = 0; r < HEIGHTMAP_N; r++) for (let c = 0; c < HEIGHTMAP_N; c++) hm[r * HEIGHTMAP_N + c] = 1300 + (rise * c) / (HEIGHTMAP_N - 1);
  return new Uint8Array(hm.buffer);
}

it('bounds prop height by the tile heightmap on steep tiles', async () => {
  const dir = await builtFixture();
  writeFileSync(`${dir}/height.f32`, slopeHeightmap(600));
  const props = JSON.parse(readFileSync(`${dir}/props.json`, 'utf8'));
  const tree = { type: 'tree', x: 795, y: 600, z: 400, rotY: 0, scale: 1 };
  props.props = [tree];
  writeFileSync(`${dir}/props.json`, JSON.stringify(props));
  const ok = await validateTile(dir);
  expect(ok.errors).toEqual([]);

  props.props = [{ ...tree, y: 700 }];
  writeFileSync(`${dir}/props.json`, JSON.stringify(props));
  const bad = await validateTile(dir);
  expect(bad.ok).toBe(false);
  expect(bad.errors).toHaveLength(1);
  expect(bad.errors[0]).toContain('props[0]');

  props.props = [{ ...tree, y: -50 }];
  writeFileSync(`${dir}/props.json`, JSON.stringify(props));
  expect((await validateTile(dir)).ok).toBe(false);
});

it('accepts real low-lying terrain but rejects NaN and no-data heights', async () => {
  const dir = await builtFixture();
  const write = (v: number) => writeFileSync(`${dir}/height.f32`, new Uint8Array(new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N).fill(v).buffer));
  write(830);
  const props = JSON.parse(readFileSync(`${dir}/props.json`, 'utf8'));
  props.props = [];
  writeFileSync(`${dir}/props.json`, JSON.stringify(props));
  expect((await validateTile(dir)).errors).toEqual([]);
  write(NaN);
  expect((await validateTile(dir)).errors.some((e) => e.includes('height.f32'))).toBe(true);
  write(-32768);
  expect((await validateTile(dir)).errors.some((e) => e.includes('height.f32'))).toBe(true);
});
