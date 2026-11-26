import { HEIGHTMAP_N, HEIGHT_STEP } from '@ktm/geo';
import { expect, it } from 'vitest';
import { flattenUnderRoads, meshHeightAt } from './flatten.ts';

const N = HEIGHTMAP_N, S = HEIGHT_STEP;
const plane = (x: number, z: number) => 1350 + 0.1 * x + 0.05 * z;
const slope = () => {
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = plane(c * S, r * S);
  return hm;
};
const border = (r: number, c: number) => r === 0 || c === 0 || r === N - 1 || c === N - 1;

it('flattens samples under a straight road to road height minus lift, leaving borders and far samples', () => {
  const hm = slope(), copy = hm.slice();
  const pts: [number, number][] = [[-10, 400], [810, 400]];
  const out = flattenUnderRoads(hm, [{ pts, heights: pts.map(([x, z]) => plane(x, z)), width: 6 }], 0.08);
  expect(hm).toEqual(copy);
  expect(out).not.toBe(hm);
  let flat = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = r * N + c, x = c * S, z = r * S;
    if (border(r, c)) expect(out[i]).toBe(hm[i]);
    else if (Math.abs(z - 400) <= 4) { expect(out[i]).toBeCloseTo(Math.fround(plane(x, 400) - 0.08), 5); flat++; }
    else expect(out[i]).toBe(hm[i]);
  }
  expect(flat).toBe(N - 2);
});

it('interpolates heights along diagonal and sloped roads', () => {
  const hm = slope();
  const diag = flattenUnderRoads(hm, [{ pts: [[0, 0], [800, 800]], heights: [1400, 1420], width: 8 }], 0.1);
  expect(diag[32 * N + 32]).toBeCloseTo(1410 - 0.1, 3);
  expect(diag[16 * N + 16]).toBeCloseTo(1405 - 0.1, 3);
  expect(diag[16 * N + 20]).toBe(hm[16 * N + 20]);
  const ns = flattenUnderRoads(hm, [{ pts: [[300, 100], [300, 700]], heights: [1400, 1420], width: 6 }], 0);
  expect(ns[32 * N + 24]).toBeCloseTo(1400 + 20 * (300 / 600), 3); // z = 400, x = 300
});

it('takes the nearer road when several qualify', () => {
  const hm = slope();
  const out = flattenUnderRoads(hm, [
    { pts: [[0, 397], [800, 397]], heights: [1500, 1500], width: 10 },
    { pts: [[0, 402], [800, 402]], heights: [1600, 1600], width: 10 },
  ], 0);
  expect(out[32 * N + 10]).toBeCloseTo(1600, 5); // z = 400: 2 m to the second road, 3 m to the first
  expect(out[31 * N + 10]).toBe(hm[31 * N + 10]); // z = 387.5: beyond 6 m of either
});

it('ignores empty roads and treats single points and zero-length segments as points', () => {
  const hm = slope();
  const out = flattenUnderRoads(hm, [
    { pts: [], heights: [], width: 10 },
    { pts: [[400, 400]], heights: [1700], width: 2 },
    { pts: [[200, 200], [200, 200]], heights: [1800, 1800], width: 2 },
  ], 0);
  expect(out[32 * N + 32]).toBe(1700);
  expect(out[16 * N + 16]).toBe(1800);
  expect(out[32 * N + 33]).toBe(hm[32 * N + 33]);
});

it('meshHeightAt matches vertices, planes and the mesh triangle split', () => {
  const hm = slope();
  for (const [r, c] of [[0, 0], [10, 20], [64, 64], [64, 0], [33, 7]] as const)
    expect(meshHeightAt(hm, c * S, r * S)).toBe(hm[r * N + c]);
  for (const [x, z] of [[3.3, 7.1], [401.2, 123.9], [799.9, 0.4], [612.5, 612.5]] as const)
    expect(meshHeightAt(hm, x, z)).toBeCloseTo(plane(x, z), 3);
  expect(meshHeightAt(hm, -50, 900)).toBe(hm[64 * N]);
  // non-planar cell r=1,c=1: a=0, b=0, d=0, e=10
  const bump = new Float32Array(N * N);
  bump[2 * N + 2] = 10;
  expect(meshHeightAt(bump, S * 1.3, S * 1.4)).toBe(0); // tx+tz = 0.7 -> triangle a,b,d
  expect(meshHeightAt(bump, S * 1.75, S * 1.5)).toBeCloseTo(2.5, 6); // E*(1-(1-tx)-(1-tz)) = 10*0.25
  // a=4, b=0, d=0, e=0
  const pit = new Float32Array(N * N);
  pit[N + 1] = 4;
  expect(meshHeightAt(pit, S * 1.25, S * 1.25)).toBeCloseTo(2, 6); // 4*(1-0.25-0.25)
  expect(meshHeightAt(pit, S * 1.75, S * 1.75)).toBe(0);
});
