import { expect, it } from 'vitest';
import { Clock, DAY_ELEVATION_DEG, NIGHT_ELEVATION_DEG, nightAmount, sunElevation } from './Clock.ts';

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

it('night is 0 at noon, 1 at 22:00, 0.5 at the dusk midpoint crossing', () => {
  expect(nightAmount(12)).toBe(0);
  expect(nightAmount(22)).toBe(1);
  const mid = (DAY_ELEVATION_DEG + NIGHT_ELEVATION_DEG) / 2;
  const t = 12 + (12 * Math.acos((rad(mid) + 0.2) / 1.2)) / Math.PI;
  expect(deg(sunElevation(t))).toBeCloseTo(mid, 9);
  expect(nightAmount(t)).toBeCloseTo(0.5, 6);
});

it('night is 0 while the sun is high and never decreases from noon to 22:00', () => {
  expect(deg(sunElevation(15))).toBeGreaterThanOrEqual(DAY_ELEVATION_DEG);
  expect(nightAmount(15)).toBe(0);
  let prev = nightAmount(12);
  for (let i = 1; i <= 100; i++) {
    const n = nightAmount(12 + i * 0.1);
    expect(n).toBeGreaterThanOrEqual(prev);
    prev = n;
  }
});

it('advances one game hour per 120 real seconds', () => {
  expect(new Clock(10).advance(120)).toBe(11);
  const c = new Clock(10);
  for (let i = 0; i < 7200; i++) c.advance(1 / 60);
  expect(c.time).toBeCloseTo(11, 9);
});

it('wraps past midnight', () => {
  expect(new Clock(23.5).advance(120)).toBeCloseTo(0.5);
  expect(new Clock(25).time).toBe(1);
});

it('does not advance while paused and resumes after toggling again', () => {
  const c = new Clock(8);
  c.togglePause();
  expect(c.paused).toBe(true);
  expect(c.advance(600)).toBe(8);
  expect(c.time).toBe(8);
  c.togglePause();
  expect(c.paused).toBe(false);
  expect(c.advance(120)).toBe(9);
});

it('a frozen clock never advances, even after togglePause', () => {
  const c = new Clock(16.5, { frozen: true });
  expect(c.frozen).toBe(true);
  expect(c.paused).toBe(true);
  expect(c.advance(600)).toBe(16.5);
  c.togglePause();
  expect(c.paused).toBe(true);
  expect(c.advance(600)).toBe(16.5);
  c.togglePause();
  expect(c.advance(600)).toBe(16.5);
});
