import { describe, expect, it } from 'vitest';
import { convert, format, parseArgs } from './latlon.ts';

describe('latlon', () => {
  it('maps the projection origin to world 0,0', () => {
    const r = convert({ lat: 27.7, lon: 85.37 });
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it('puts real landmarks in the tiles named by the contracts', () => {
    expect(convert({ lat: 27.70436, lon: 85.30725 }).tile).toBe('x14_y17'); // Kathmandu Durbar Square
    expect(convert({ lat: 27.71489, lon: 85.29043 }).tile).toBe('x12_y18'); // Swayambhunath
    expect(convert({ lat: 27.72149, lon: 85.36203 }).tile).toBe('x21_y19'); // Boudhanath
  });

  it('round-trips through tile-local coordinates', () => {
    const a = convert({ lat: 27.71531, lon: 85.31226 });
    const b = convert({ tile: a.tile, lx: a.lx, lz: a.lz });
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
    expect(b.lat).toBeCloseTo(27.71531, 9);
    expect(b.lon).toBeCloseTo(85.31226, 9);
    expect(a.lx).toBeGreaterThanOrEqual(0);
    expect(a.lx).toBeLessThan(800);
  });

  it('parses both argument forms and formats one line', () => {
    expect(parseArgs(['27.7', '85.37'])).toEqual({ lat: 27.7, lon: 85.37 });
    expect(parseArgs(['--tile', 'x14_y17', '400', '400.5'])).toEqual({ tile: 'x14_y17', lx: 400, lz: 400.5 });
    expect(parseArgs(['abc', '85'])).toBeUndefined();
    expect(parseArgs(['--tile', 'nope', '1', '2'])).toBeUndefined();
    expect(parseArgs([])).toBeUndefined();
    expect(format(convert({ lat: 27.7, lon: 85.37 }))).toMatch(/^x=0\.0 z=0\.0 tile=x\d\d_y\d\d local=\d+\.\d,\d+\.\d lat=27\.700000 lon=85\.370000$/);
  });
});
