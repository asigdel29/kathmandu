import { describe, expect, it } from 'vitest';
import { convexHull, fillRatio, minAreaOBB, type XZ } from './obb.ts';

const rotate = (pts: XZ[], deg: number, about: XZ): XZ[] => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map(([x, z]) => {
    const dx = x - about[0], dz = z - about[1];
    return [about[0] + dx * c - dz * s, about[1] + dx * s + dz * c];
  });
};

describe('minAreaOBB', () => {
  const rect: XZ[] = [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]];

  it('fits an axis-aligned rectangle exactly', () => {
    const o = minAreaOBB(rect);
    expect(o.length).toBeCloseTo(10, 9);
    expect(o.width).toBeCloseTo(6, 9);
    expect(o.area).toBeCloseTo(60, 9);
    expect(o.center[0]).toBeCloseTo(5, 9);
    expect(o.center[1]).toBeCloseTo(3, 9);
    expect(Math.abs(o.axis[0])).toBeCloseTo(1, 9);
    expect(Math.hypot(o.axis[0], o.axis[1])).toBeCloseTo(1, 9);
    expect(fillRatio(rect, o)).toBeCloseTo(1, 9);
  });

  it('follows a rotated rectangle', () => {
    const pts = rotate(rect, 30, [3, -7]);
    const o = minAreaOBB(pts);
    expect(o.length).toBeCloseTo(10, 9);
    expect(o.width).toBeCloseTo(6, 9);
    expect(o.area).toBeCloseTo(60, 9);
    const c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6);
    expect(Math.abs(o.axis[0] * c30 + o.axis[1] * s30)).toBeCloseTo(1, 9);
    const ctr = rotate([[5, 3]], 30, [3, -7])[0]!;
    expect(o.center[0]).toBeCloseTo(ctr[0], 9);
    expect(o.center[1]).toBeCloseTo(ctr[1], 9);
    expect(fillRatio(pts)).toBeCloseTo(1, 9);
  });

  it('boxes an L-shape in its 10x10 square', () => {
    // L area = 10*10 - 6*6 = 64
    const l: XZ[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    const o = minAreaOBB(l);
    expect(o.area).toBeCloseTo(100, 9);
    expect(o.length).toBeCloseTo(10, 9);
    expect(o.width).toBeCloseTo(10, 9);
    expect(fillRatio(l, o)).toBeCloseTo(0.64, 9);
  });

  it('picks the minimum over hull edges for a 3-4-5 triangle', () => {
    const t: XZ[] = [[0, 0], [4, 0], [0, 3]];
    const o = minAreaOBB(t);
    expect(o.area).toBeCloseTo(12, 9);
    expect(o.length).toBeGreaterThanOrEqual(o.width);
    expect(fillRatio(t)).toBeCloseTo(0.5, 9);
  });

  it('returns a zero-area box for collinear input without throwing', () => {
    const line: XZ[] = [[0, 0], [1, 1], [3, 3], [2, 2]];
    const o = minAreaOBB(line);
    expect(o.area).toBe(0);
    expect(o.width).toBe(0);
    expect(o.length).toBeCloseTo(3 * Math.SQRT2, 9);
    expect(Math.abs(o.axis[0] * Math.SQRT1_2 + o.axis[1] * Math.SQRT1_2)).toBeCloseTo(1, 9);
    expect(o.center[0]).toBeCloseTo(1.5, 9);
    expect(o.center[1]).toBeCloseTo(1.5, 9);
    expect(fillRatio(line)).toBe(0);
    expect(() => minAreaOBB([])).not.toThrow();
    expect(minAreaOBB([[2, 5]]).area).toBe(0);
    expect(fillRatio([[1, 1], [1, 1]])).toBe(0);
  });
});

describe('convexHull', () => {
  const corners: XZ[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const key = (pts: XZ[]) => pts.map((p) => p.join(',')).sort();

  it('drops interior and collinear points', () => {
    const pts: XZ[] = [[0, 0], [2, 0], [4, 0], [4, 2], [4, 4], [1, 1], [2, 3], [2, 4], [0, 4], [0, 2]];
    const h = convexHull(pts);
    expect(h).toHaveLength(4);
    expect(key(h)).toEqual(key(corners));
  });

  it('is independent of input winding and a closing duplicate', () => {
    const ccw = convexHull([...corners, corners[0]!]);
    const cw = convexHull([...corners].reverse());
    expect(ccw).toHaveLength(4);
    expect(key(ccw)).toEqual(key(corners));
    expect(key(cw)).toEqual(key(corners));
    expect(ccw).toEqual(cw);
    const ccwRect = minAreaOBB([...corners].reverse());
    expect(ccwRect.area).toBeCloseTo(16, 9);
  });
});
