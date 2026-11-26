import { readFileSync, writeFileSync } from 'node:fs';
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
