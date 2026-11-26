import { describe, expect, it } from 'vitest';
import { lonLatToLocal, localToLonLat, M_PER_DEG } from './projection.ts';

describe('projection', () => {
  it('has meters-per-degree evaluated at the origin latitude', () => {
    expect(M_PER_DEG.lat).toBeCloseTo(110814.6, 0);
    expect(M_PER_DEG.lon).toBeCloseTo(98632.5, 0);
  });
  it('places Kathmandu Durbar Square 6.21 km west and 0.48 km north of origin', () => {
    const p = lonLatToLocal(85.307, 27.7043);
    expect(p.x).toBeCloseTo(-6213.85, 1);
    expect(p.z).toBeCloseTo(-476.5, 1);
  });
  it('Durbar Square to Boudhanath is about 5.75 km', () => {
    const a = lonLatToLocal(85.307, 27.7043);
    const b = lonLatToLocal(85.362, 27.7215);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    expect(d).toBeGreaterThan(5700);
    expect(d).toBeLessThan(5800);
  });
  it('round-trips', () => {
    const { lon, lat } = localToLonLat(1234.5, -987.6);
    const p = lonLatToLocal(lon, lat);
    expect(p.x).toBeCloseTo(1234.5, 6);
    expect(p.z).toBeCloseTo(-987.6, 6);
  });
});
