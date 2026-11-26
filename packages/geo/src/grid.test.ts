import { describe, expect, it } from 'vitest';
import { GRID, allTileIds, neighbors, parseTileId, tileBounds, tileId, tileIndexAt, tileOrigin } from './grid.ts';
import { lonLatToLocal } from './projection.ts';
import { TILE_SIZE_M } from './constants.ts';

const at = (lon: number, lat: number) => { const p = lonLatToLocal(lon, lat); const { i, j } = tileIndexAt(p.x, p.z); return tileId(i, j); };

describe('grid', () => {
  it('covers the valley with 45 x 34 cells', () => {
    expect(GRID.cols).toBe(45);
    expect(GRID.rows).toBe(34);
    expect(allTileIds()).toHaveLength(1530);
  });
  it('formats and parses ids', () => {
    expect(tileId(14, 17)).toBe('x14_y17');
    expect(parseTileId('x14_y17')).toEqual({ i: 14, j: 17 });
    expect(() => parseTileId('14_17')).toThrow();
    expect(() => tileId(45, 0)).toThrow();
  });
  it('maps landmarks to the expected tiles', () => {
    expect(at(85.307, 27.7043)).toBe('x14_y17'); // Kathmandu Durbar Square
    expect(at(85.2904, 27.7149)).toBe('x12_y18'); // Swayambhunath
    expect(at(85.362, 27.7215)).toBe('x21_y19'); // Boudhanath
  });
  it('tile-local coordinates are in [0, 800)', () => {
    const b = tileBounds('x14_y17');
    expect(b.maxX - b.minX).toBeCloseTo(TILE_SIZE_M, 6);
    expect(b.maxZ - b.minZ).toBeCloseTo(TILE_SIZE_M, 6);
    const o = tileOrigin('x14_y17');
    const p = lonLatToLocal(85.307, 27.7043);
    expect(p.x - o.x).toBeGreaterThanOrEqual(0); expect(p.x - o.x).toBeLessThan(800);
    expect(p.z - o.z).toBeGreaterThanOrEqual(0); expect(p.z - o.z).toBeLessThan(800);
  });
  it('neighbors: 8 inside, 3 at a corner', () => {
    expect(neighbors('x14_y17')).toHaveLength(8);
    expect(neighbors('x00_y00')).toEqual(['x01_y00', 'x00_y01', 'x01_y01']);
  });
});
