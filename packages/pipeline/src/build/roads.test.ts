import { expect, it } from 'vitest';
import { MeshBuilder } from '../gltf/mesh.ts';
import { ROAD_SPEC, navNodeId, ribbon, roadSpec } from './roads.ts';

it('has a spec for every vehicle class and widths in the contract', () => {
  expect(roadSpec('primary')).toMatchObject({ width: 12, lanes: 4, speed: 50, material: 'asphalt' });
  expect(roadSpec('residential', 'unpaved')).toMatchObject({ width: 6, material: 'unpaved' });
  expect(roadSpec('footway')).toMatchObject({ width: 2, material: 'path', vehicle: false });
  expect(Object.keys(ROAD_SPEC).length).toBeGreaterThanOrEqual(18);
});
it('quantises nav ids to 1 cm in world space', () => {
  expect(navNodeId(-6213.854, -476.496)).toBe('n_-621385_-47650');
  expect(navNodeId(-6213.851, -476.504)).toBe('n_-621385_-47650');
});
it('builds an up-facing ribbon with u along the road', () => {
  const m = new MeshBuilder();
  ribbon([[0, 0], [100, 0]], 6, () => 10, m, 0.08);
  const d = m.finish();
  expect(d.indices).toHaveLength(6);
  expect(d.positions.filter((_, i) => i % 3 === 1).every((y) => Math.abs(y - Math.fround(10.08)) < 1e-9)).toBe(true);
  const zs = Array.from(d.positions).filter((_, i) => i % 3 === 2);
  expect(Math.min(...zs)).toBeCloseTo(-3, 9); expect(Math.max(...zs)).toBeCloseTo(3, 9);
  expect(Math.max(...Array.from(d.uvs).filter((_, i) => i % 2 === 0))).toBeCloseTo(100, 9);
});
