import { expect, it } from 'vitest';
import { HEIGHTMAP_N } from '@ktm/geo';
import { terrainMesh } from './terrain.ts';

it('meshes a flat heightmap into 64x64 up-facing quads at base-relative height', () => {
  const hm = new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N).fill(1350);
  const d = terrainMesh(hm, []);
  expect(d.indices.length).toBe(64 * 64 * 2 * 3);
  for (let v = 0; v < d.positions.length / 3; v++) {
    expect(d.positions[v * 3 + 1]).toBe(50);
    expect(d.normals[v * 3]).toBeCloseTo(0, 9);
    expect(d.normals[v * 3 + 1]).toBeCloseTo(1, 9);
    expect(d.normals[v * 3 + 2]).toBeCloseTo(0, 9);
  }
  expect(d.colors).toHaveLength(HEIGHTMAP_N * HEIGHTMAP_N * 3);
});
