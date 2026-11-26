import { expect, it } from 'vitest';
import { MeshBuilder, shoelaceXZ } from '../gltf/mesh.ts';
import { minAreaOBB } from '../geom/obb.ts';
import { extrudeBuilding, buildingHeight, roofKind, ROOF_PITCH, PITCHED_MAX_VERTICES, PITCHED_MIN_FILL, type RoofKind, type XZ } from './buildings.ts';

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

type Mesh = ReturnType<MeshBuilder['finish']>;
type P3 = [number, number, number];
const pos = (m: Mesh, i: number): P3 => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
const nrm = (m: Mesh, i: number): P3 => [m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rot = (ring: XZ[], deg: number): XZ[] => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return ring.map(([x, z]) => [x * c - z * s, x * s + z * c]);
};
const RECT: XZ[] = [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]];
function pitched(ring: XZ[], baseY = 0, height = 9): { w: Mesh; r: Mesh } {
  const walls = new MeshBuilder(), roofs = new MeshBuilder();
  extrudeBuilding({ rings: [ring], baseY, height, style: 1, roof: 'pitched' }, walls, roofs);
  return { w: walls.finish(), r: roofs.finish() };
}
/** Wall triangles with a vertex above the eave line: the gable extensions. */
function gableTris(w: Mesh, top: number): number[][] {
  const out: number[][] = [];
  for (let t = 0; t < w.indices.length; t += 3) {
    const ids = [w.indices[t]!, w.indices[t + 1]!, w.indices[t + 2]!];
    if (ids.some((i) => pos(w, i)[1] > top + 1e-6)) out.push(ids);
  }
  return out;
}

it('builds a gabled roof over a 10x6 rectangle', () => {
  const { w, r } = pitched(RECT);
  expect(r.indices).toHaveLength(12);
  expect(w.indices).toHaveLength(30);
  const ys = Array.from({ length: r.positions.length / 3 }, (_, i) => pos(r, i)[1]);
  expect(Math.max(...ys)).toBeCloseTo(11.1, 6);
  expect(Math.min(...ys)).toBeCloseTo(9, 6);
  for (let v = 0; v < r.positions.length / 3; v++) {
    const p = pos(r, v), n = nrm(r, v);
    if (Math.abs(p[1] - 11.1) < 1e-6) expect(p[2]).toBeCloseTo(3, 6);
    expect(n[1]).toBeGreaterThan(0);
    if (Math.abs(p[2] - 3) > 1e-6) expect(Math.sign(n[2])).toBe(Math.sign(p[2] - 3));
    expect(n[0]).toBeCloseTo(0, 6);
  }
  expect(Array.from(r.styles).every((s) => s === 8)).toBe(true);
  for (let t = 0; t < r.indices.length; t += 3) {
    const [a, b, c] = [r.indices[t]!, r.indices[t + 1]!, r.indices[t + 2]!];
    const A = pos(r, a), B = pos(r, b), C = pos(r, c);
    expect(shoelaceXZ([[A[0], A[2]], [B[0], B[2]], [C[0], C[2]]])).toBeLessThan(0);
    const face = cross(sub(B, A), sub(C, A));
    for (const i of [a, b, c]) expect(dot(face, nrm(r, i))).toBeGreaterThan(0);
  }
  const gables = gableTris(w, 9);
  expect(gables).toHaveLength(2);
  for (const ids of gables) {
    const [A, B, C] = ids.map((i) => pos(w, i)) as [P3, P3, P3];
    expect(Math.max(A[1], B[1], C[1])).toBeCloseTo(11.1, 6);
    expect(Math.min(A[1], B[1], C[1])).toBeCloseTo(9, 6);
    const face = cross(sub(B, A), sub(C, A));
    for (const i of ids) {
      const n = nrm(w, i), p = pos(w, i);
      expect(n[1]).toBe(0);
      expect(n[0] * (p[0] - 5) + n[2] * (p[2] - 3)).toBeGreaterThan(0);
      expect(dot(face, n)).toBeGreaterThan(0);
      expect(w.styles[i]).toBe(1);
    }
  }
});

it('builds the same gabled roof over a rotated rectangle', () => {
  const { w, r } = pitched(rot(RECT, 30));
  expect(r.indices).toHaveLength(12);
  const ys = Array.from({ length: r.positions.length / 3 }, (_, i) => pos(r, i)[1]);
  expect(Math.max(...ys)).toBeCloseTo(11.1, 6);
  expect(gableTris(w, 9)).toHaveLength(2);
  expect(w.indices).toHaveLength(30);
});

it('builds a pitched roof over a non-rectangular footprint', () => {
  const house: XZ[] = [[0, 0], [10, 0], [10, 6], [5, 8], [0, 6]];
  const walls = new MeshBuilder(), roofs = new MeshBuilder();
  expect(() => extrudeBuilding({ rings: [rot(house, 17)], baseY: 2, height: 9, style: 1, roof: 'pitched', roofStyle: 3 }, walls, roofs)).not.toThrow();
  const r = roofs.finish(), w = walls.finish();
  expect(r.indices.length).toBeGreaterThan(0);
  const rise = ROOF_PITCH * minAreaOBB(house).width;
  for (let v = 0; v < r.positions.length / 3; v++) {
    expect(nrm(r, v)[1]).toBeGreaterThan(0);
    expect(pos(r, v)[1]).toBeGreaterThanOrEqual(11 - 1e-6);
    expect(pos(r, v)[1]).toBeLessThanOrEqual(11 + rise + 1e-6);
  }
  expect(Array.from(r.styles).every((s) => s === 3)).toBe(true);
  expect(gableTris(w, 11).length).toBeGreaterThan(0);
});

it('decides the roof kind from zone, footprint and override', () => {
  const L: XZ[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  const seven: XZ[] = [[0, 0], [5, 0.1], [10, 0], [10, 6], [7, 6.05], [3, 6.05], [0, 6]];
  expect(roofKind('old-core', RECT)).toBe('pitched');
  expect(roofKind('old-core', RECT.slice(0, -1))).toBe('pitched');
  expect(roofKind('suburb', RECT)).toBe('flat');
  expect(roofKind('old-core', L)).toBe('flat');
  expect(roofKind('old-core', seven)).toBe('flat');
  expect(roofKind('old-core', [...seven.slice(0, 6), seven[0]!])).toBe('pitched');
  expect(roofKind('old-core', RECT, 'flat')).toBe('flat');
  expect(roofKind('suburb', L, 'pitched')).toBe('pitched');
  expect(PITCHED_MAX_VERTICES).toBe(6);
  expect(PITCHED_MIN_FILL).toBe(0.8);
});

it('keeps flat output identical whether roof is undefined or flat', () => {
  const run = (roof?: RoofKind): Mesh[] => {
    const walls = new MeshBuilder(), roofs = new MeshBuilder();
    const ring: XZ[] = [[0, 0], [10, 0], [10, 6], [0, 6]], hole: XZ[] = [[3, 2], [5, 2], [5, 4], [3, 4]];
    extrudeBuilding({ rings: [ring, hole], baseY: 1, height: 7, style: 2, ...(roof ? { roof } : {}) }, walls, roofs);
    return [walls.finish(), roofs.finish()];
  };
  expect(run('flat')).toEqual(run());
});
