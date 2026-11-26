import { expect, it } from 'vitest';
import { MeshBuilder, shoelaceXZ } from '../gltf/mesh.ts';
import { extrudeBuilding, buildingHeight } from './buildings.ts';

it('extrudes a square into 8 wall triangles + 2 roof triangles with outward normals', () => {
  const walls = new MeshBuilder(), roofs = new MeshBuilder();
  extrudeBuilding({ rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], baseY: 5, height: 9, style: 1 }, walls, roofs);
  const w = walls.finish(), r = roofs.finish();
  expect(w.indices).toHaveLength(24); expect(r.indices).toHaveLength(6);
  for (let v = 0; v < w.positions.length / 3; v++) {
    const px = w.positions[v * 3]! - 5, pz = w.positions[v * 3 + 2]! - 5;      // vector from centroid
    expect(w.normals[v * 3 + 1]).toBe(0);
    expect(w.normals[v * 3]! * px + w.normals[v * 3 + 2]! * pz).toBeGreaterThan(0); // points outward
    expect([5, 14]).toContain(w.positions[v * 3 + 1]);                             // baseY or baseY+height
  }
  expect(Math.max(...w.uvs.filter((_, i) => i % 2 === 1))).toBe(9);                 // v = meters up
  expect(w.styles.every((s) => s === 1)).toBe(true);
  for (let t = 0; t < 2; t++) {
    const P = (i: number): [number, number] => [r.positions[i * 3]!, r.positions[i * 3 + 2]!];
    expect(shoelaceXZ([P(r.indices[t * 3]!), P(r.indices[t * 3 + 1]!), P(r.indices[t * 3 + 2]!)])).toBeLessThan(0);
  }
});
it('derives height from tags, overrides, or zone default', () => {
  expect(buildingHeight({ height: '12.5' }, undefined, 3)).toBe(12.5);
  expect(buildingHeight({ 'building:levels': '5' }, undefined, 3)).toBeCloseTo(5 * 3.1 + 0.6, 6);
  expect(buildingHeight({}, { levels: 2 }, 3)).toBeCloseTo(2 * 3.1 + 0.6, 6);
  expect(buildingHeight({}, { height: 7 }, 3)).toBe(7);
  expect(buildingHeight({}, undefined, 3)).toBeCloseTo(3 * 3.1 + 0.6, 6);
});
