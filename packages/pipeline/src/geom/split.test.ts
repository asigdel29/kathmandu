import { describe, expect, it } from 'vitest';
import { tileBounds } from '@ktm/geo';
import { splitPolylineByGrid } from './split.ts';

describe('splitPolylineByGrid', () => {
  const b = tileBounds('x14_y17');
  const zMid = (b.minZ + b.maxZ) / 2;
  it('keeps an inside polyline whole', () => {
    const p = splitPolylineByGrid([[b.minX + 10, zMid], [b.minX + 300, zMid + 100]]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ tile: 'x14_y17', borderStart: false, borderEnd: false });
  });
  it('splits at a vertical border and both pieces share the exact border point', () => {
    const p = splitPolylineByGrid([[b.minX + 700, zMid], [b.maxX + 100, zMid]]);
    expect(p.map((x) => x.tile)).toEqual(['x14_y17', 'x15_y17']);
    expect(p[0]!.pts.at(-1)).toEqual(p[1]!.pts[0]);
    expect(p[0]!.pts.at(-1)![0]).toBeCloseTo(b.maxX, 9);
    expect(p[0]!.borderEnd).toBe(true);
    expect(p[1]!.borderStart).toBe(true);
  });
  it('crosses two borders in order (north first, then east)', () => {
    const p = splitPolylineByGrid([[b.maxX - 60, b.minZ + 40], [b.maxX + 40, b.minZ - 60]]);
    expect(p.map((x) => x.tile)).toEqual(['x14_y17', 'x14_y18', 'x15_y18']);
  });
  it('drops pieces outside the grid', () => {
    const w = tileBounds('x00_y00');
    const p = splitPolylineByGrid([[w.minX - 500, w.maxZ - 10], [w.minX + 100, w.maxZ - 10]]);
    expect(p.map((x) => x.tile)).toEqual(['x00_y00']);
  });
});
