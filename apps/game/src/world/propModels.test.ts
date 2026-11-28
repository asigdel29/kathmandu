import { existsSync, readFileSync, statSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PropType } from '@ktm/schema';
import { modelFile, RENDERED, TREE_VARIANTS } from './propPlacement.ts';

const DIR = new URL('../../public/models/props/', import.meta.url).pathname;

interface Gltf { meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[]; accessors: { count: number }[]; materials?: unknown[]; images?: unknown[] }
function read(file: string): Gltf {
  const b = readFileSync(`${DIR}${file}.glb`);
  expect(b.toString('latin1', 0, 4)).toBe('glTF');
  const n = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + n)) as Gltf;
}
const tris = (g: Gltf): number => g.meshes[0]!.primitives.reduce((s, p) => s + (p.indices !== undefined ? g.accessors[p.indices]!.count : g.accessors[p.attributes.POSITION!]!.count) / 3, 0);

const files = [...new Set(PropType.options.filter((t) => RENDERED.has(t)).flatMap((t) => (t === 'tree' ? TREE_VARIANTS.map((_, i) => modelFile(t, i)) : [modelFile(t, 0)])))];

it('ships a model for every rendered prop type', () => {
  expect(files.length).toBe(RENDERED.size - 1 + TREE_VARIANTS.length);
  for (const f of files) expect(existsSync(`${DIR}${f}.glb`), f).toBe(true);
});

it('keeps each model under the triangle budget with one mesh, vertex colours and no textures', () => {
  for (const f of files) {
    const g = read(f);
    expect(g.meshes, f).toHaveLength(1);
    expect(g.images ?? [], f).toHaveLength(0);
    expect(g.materials?.length ?? 0, f).toBeLessThanOrEqual(1);
    expect(g.meshes[0]!.primitives[0]!.attributes, f).toHaveProperty('COLOR_0');
    expect(tris(g), f).toBeLessThan(f.startsWith('tree') ? 600 : 1500);
  }
});

it('marks the emissive parts of the streetlight and the shrine with _LAMP', () => {
  for (const f of ['streetlight', 'shrine']) expect(read(f).meshes[0]!.primitives[0]!.attributes, f).toHaveProperty('_LAMP');
});

it('stays well inside the asset byte budget', () => {
  const total = files.reduce((s, f) => s + statSync(`${DIR}${f}.glb`).size, 0);
  expect(total).toBeLessThan(12 * 1024 * 1024);
});
