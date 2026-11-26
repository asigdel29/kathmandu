import { describe, expect, it } from 'vitest';
import { decodeTerrarium, lonLatToPixel, sampleElevation, type PixelSource } from './terrarium.ts';
import { buildHeightmap, heightAt } from './heightmap.ts';
import { HEIGHTMAP_N } from '@ktm/geo';

const constant = (v: number): PixelSource => ({ elevationAt: async () => v });

describe('terrarium', () => {
  it('decodes RGB to meters', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(133, 32, 0)).toBe(1312);
    expect(decodeTerrarium(133, 32, 128)).toBeCloseTo(1312.5, 6);
  });
  it('maps Durbar Square into zoom-14 tile x=12074, y=6878', () => {
    // Row 6879 starts at 27.7020° N, just south of Durbar Square.
    const p = lonLatToPixel(85.307, 27.7043, 14);
    expect(Math.floor(p.x / 256)).toBe(12074);
    expect(Math.floor(p.y / 256)).toBe(6878);
  });
  it('bilinear sampling of a constant field is constant', async () => {
    expect(await sampleElevation(constant(1350), 85.3, 27.7)).toBeCloseTo(1350, 9);
  });
});

describe('heightmap', () => {
  it('builds a 65x65 grid', async () => {
    const hm = await buildHeightmap(constant(1400), 'x14_y17');
    expect(hm).toHaveLength(HEIGHTMAP_N * HEIGHTMAP_N);
    expect(heightAt(hm, 123.4, 567.8)).toBeCloseTo(1400, 9);
  });
  it('interpolates bilinearly between rows', () => {
    const ramp = new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N).map((_, i) => Math.floor(i / HEIGHTMAP_N)); // value = row
    expect(heightAt(ramp, 0, 12.5)).toBeCloseTo(1, 9);
    expect(heightAt(ramp, 400, 18.75)).toBeCloseTo(1.5, 9);
  });
});
