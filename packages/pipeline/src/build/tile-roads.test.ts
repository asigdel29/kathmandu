import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { BASE_ELEVATION_M, HEIGHTMAP_N, HEIGHT_STEP } from '@ktm/geo';
import { Nav } from '@ktm/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixtureInputs } from '../../test/fixture-tile.ts';
import { meshHeightAt } from './flatten.ts';
import type { XZ } from './props.ts';
import { ROAD_LIFT, ROAD_SAMPLE_M, sampleRoad } from './roads.ts';
import { buildTile } from './tile.ts';

const N = HEIGHTMAP_N;
const ROAD: XZ[] = [[30, 380], [400, 430], [770, 360]];
/** Position quantisation of the written glb (14 bits over the mesh bounds). */
const QUANT = 0.1;
const hill = (x: number, z: number): number => 1350 + 0.06 * x + 0.03 * z + 40 * Math.exp(-((x - 400) ** 2 + (z - 420) ** 2) / 180 ** 2);

function segDist([px, pz]: XZ, pts: XZ[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / l2, 0), 1);
    best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
  }
  return best;
}

type P3 = [number, number, number];
/** Asphalt ribbon vertices in world space: L, C, R per centreline sample. */
async function asphaltRibbon(path: string): Promise<P3[]> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const node = doc.getRoot().listNodes().find((n) => n.getMesh())!;
  const m = node.getWorldMatrix();
  const prim = node.getMesh()!.listPrimitives().find((p) => p.getMaterial()?.getName() === 'asphalt')!;
  const pos = prim.getAttribute('POSITION')!;
  const v: P3[] = [];
  for (let i = 0; i < pos.getCount(); i++) {
    const [x, y, z] = pos.getElement(i, [0, 0, 0]) as [number, number, number];
    v.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]);
  }
  return v;
}

describe('roads on sloped terrain', () => {
  let hm: Float32Array, flat: Float32Array, verts: P3[], mid: P3[], nav: Nav;
  beforeAll(async () => {
    const inp = fixtureInputs();
    hm = new Float32Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = hill(c * HEIGHT_STEP, r * HEIGHT_STEP);
    writeFileSync(`${inp.terrainDir}/x14_y17.f32`, new Uint8Array(hm.buffer));
    const road = (id: string, highway: string, coordinates: XZ[]) => ({ id, kind: 'road', geometry: { type: 'LineString', coordinates }, properties: { highway, borderStart: false, borderEnd: false } });
    const feats = [road('w1', 'residential', ROAD), road('w2', 'footway', [[100, 600], [300, 650]])];
    writeFileSync(`${inp.featuresDir}/x14_y17.geojsonl`, feats.map((f) => `${JSON.stringify(f)}\n`).join(''));
    const dir = `${inp.outRoot}/x14_y17`;
    await buildTile('x14_y17', { ...inp, outDir: dir, quiet: true });
    const b = readFileSync(`${dir}/height.f32`);
    flat = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    verts = await asphaltRibbon(`${dir}/roads.glb`);
    mid = verts.filter((_, i) => i % 3 === 1);
    nav = Nav.parse(JSON.parse(readFileSync(`${dir}/nav.json`, 'utf8')));
  });

  it('keeps the ribbon within lift + 0.1 m of the flattened terrain at every sample', () => {
    expect(mid.length).toBeGreaterThan(100);
    for (const [x, y, z] of mid) expect(Math.abs(y - (meshHeightAt(flat, x, z) - BASE_ELEVATION_M))).toBeLessThanOrEqual(ROAD_LIFT + 0.1);
  });

  it('drapes every ribbon vertex, edges included, within lift + 0.1 m of the flattened terrain', () => {
    expect(verts.length).toBe(mid.length * 3);
    for (const [x, y, z] of verts) expect(Math.abs(y - (meshHeightAt(flat, x, z) - BASE_ELEVATION_M))).toBeLessThanOrEqual(ROAD_LIFT + 0.1);
  });

  it('samples the centreline every 5 m and keeps the original vertices', () => {
    const s = sampleRoad(ROAD, (x, z) => meshHeightAt(hm, x, z));
    for (let i = 1; i < s.pts.length; i++) expect(Math.hypot(s.pts[i]![0] - s.pts[i - 1]![0], s.pts[i]![1] - s.pts[i - 1]![1])).toBeLessThanOrEqual(ROAD_SAMPLE_M + 1e-6);
    for (const p of ROAD) expect(s.pts.some((q) => q[0] === p[0] && q[1] === p[1])).toBe(true);
    expect(mid).toHaveLength(s.pts.length);
    for (let i = 1; i < mid.length; i++) expect(Math.hypot(mid[i]![0] - mid[i - 1]![0], mid[i]![2] - mid[i - 1]![2])).toBeLessThanOrEqual(ROAD_SAMPLE_M + QUANT);
    for (const p of ROAD) expect(mid.some((q) => Math.hypot(q[0] - p[0], q[2] - p[1]) <= QUANT)).toBe(true);
  });

  it('follows the slope instead of spanning straight between vertices', () => {
    const ys = mid.map((m) => m[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
    // A ribbon through the original vertices only would cut through the hill.
    const s = sampleRoad(ROAD, (x, z) => meshHeightAt(hm, x, z));
    const vi = ROAD.map((p) => s.pts.findIndex((q) => q[0] === p[0] && q[1] === p[1]));
    let worst = 0;
    for (let k = 0; k + 1 < vi.length; k++) for (let i = vi[k]!; i <= vi[k + 1]!; i++) {
      const t = (i - vi[k]!) / (vi[k + 1]! - vi[k]!), straight = s.heights[vi[k]!]! + (s.heights[vi[k + 1]!]! - s.heights[vi[k]!]!) * t;
      worst = Math.max(worst, Math.abs(straight - s.heights[i]!));
    }
    expect(worst).toBeGreaterThan(ROAD_LIFT + 0.1);
  });

  it('flattens interior terrain near the road and never moves the border', () => {
    let changedNear = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const k = r * N + c;
      if (r === 0 || c === 0 || r === N - 1 || c === N - 1) { expect(Object.is(flat[k], hm[k])).toBe(true); continue; }
      const d = segDist([c * HEIGHT_STEP, r * HEIGHT_STEP], ROAD);
      if (d > 10) expect(flat[k]).toBe(hm[k]);
      else if (flat[k] !== hm[k]) changedNear++;
    }
    expect(changedNear).toBeGreaterThan(10);
  });

  it('puts nav nodes on the flattened surface with unchanged road topology (the footway adds one foot edge)', () => {
    expect(nav.nodes).toHaveLength(5);
    expect(nav.edges).toHaveLength(3);
    expect(nav.edges.filter((e) => e.lanes > 0)).toHaveLength(2);
    expect(nav.edges.filter((e) => e.lanes === 0)).toHaveLength(1);
    for (const n of nav.nodes) expect(Math.abs(n.y - (meshHeightAt(flat, n.x, n.z) - BASE_ELEVATION_M))).toBeLessThanOrEqual(1e-3);
    expect(nav.nodes.slice(0, 3).map((n) => [n.x, n.z])).toEqual(ROAD);
  });
});
