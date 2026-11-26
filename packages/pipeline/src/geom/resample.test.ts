import { expect, it } from 'vitest';
import { resamplePolyline } from './resample.ts';
import type { XZ } from './split.ts';

const gaps = (pts: XZ[]) => pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
const poly: XZ[] = [[0, 0], [12.3, 0], [12.3, 100], [14, 101], [14, 101], [0.1, 3.7]];

it('keeps endpoints', () => {
  const out = resamplePolyline(poly);
  expect(out[0]).toEqual(poly[0]);
  expect(out.at(-1)).toEqual(poly.at(-1));
});

it('max gap <= maxStep', () => {
  const out = resamplePolyline(poly);
  expect(Math.max(...gaps(out))).toBeLessThanOrEqual(5 + 1e-9);
  expect(Math.max(...gaps(resamplePolyline(poly, 2)))).toBeLessThanOrEqual(2 + 1e-9);
});

it('keeps every original vertex in order at exact coordinates', () => {
  const out = resamplePolyline(poly);
  let k = 0;
  for (const p of out) if (k < poly.length && p[0] === poly[k]![0] && p[1] === poly[k]![1]) k++;
  expect(k).toBe(poly.length);
});

it('leaves short segments unchanged', () => {
  const short: XZ[] = [[0, 0], [3, 4], [3, 4], [6, 4], [6, 8.9]];
  expect(resamplePolyline(short)).toEqual(short);
});

it('100 m straight segment gives 21 points', () => {
  const out = resamplePolyline([[0, 0], [100, 0]]);
  expect(out).toHaveLength(21);
  expect(out[10]).toEqual([50, 0]);
});

it('handles length 0 and 1 inputs', () => {
  expect(resamplePolyline([])).toEqual([]);
  const one: XZ[] = [[1, 2]];
  const out = resamplePolyline(one);
  expect(out).toEqual(one);
  expect(out).not.toBe(one);
});

it('does not mutate input', () => {
  const copy = poly.map((p) => [...p]);
  resamplePolyline(poly, 1);
  expect(poly).toEqual(copy);
});

it('throws on non-positive maxStep', () => {
  expect(() => resamplePolyline(poly, 0)).toThrow();
  expect(() => resamplePolyline(poly, -1)).toThrow();
});
