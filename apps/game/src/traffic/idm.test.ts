import { describe, expect, it } from 'vitest';
import { IDM, idmAccel, idmStep } from './idm.ts';

describe('idmAccel', () => {
  it('accelerates from rest on a free road at the maximum rate', () => {
    expect(idmAccel(0, 10, Infinity, 0)).toBeCloseTo(IDM.a, 9);
  });
  it('is about zero at the desired speed on a free road', () => {
    expect(idmAccel(10, 10, Infinity, 0)).toBeCloseTo(0, 9);
  });
  it('brakes for a stopped leader close ahead', () => {
    expect(idmAccel(8, 10, 10, 8)).toBeLessThan(-IDM.b);
  });
  it('never returns NaN and clamps emergencies', () => {
    for (const a of [idmAccel(5, 10, 0, 5), idmAccel(0, 0, Infinity, 0), idmAccel(3, 0, 10, 0), idmAccel(0, 10, -1, 0)]) {
      expect(Number.isNaN(a)).toBe(false);
      expect(a).toBeGreaterThanOrEqual(-9);
    }
    expect(idmAccel(5, 10, 0, 5)).toBe(-9);
  });
});

describe('idmStep', () => {
  it('stops within the step instead of reversing', () => {
    const r = idmStep(1, -9, 1, 10);
    expect(r.v).toBe(0);
    expect(r.ds).toBeCloseTo(1 / 18, 9);
  });
  it('never exceeds vMax and never overruns the gap', () => {
    const r = idmStep(9.9, 1.5, 1, 10);
    expect(r.v).toBe(10);
    expect(r.ds).toBeLessThanOrEqual(10);
    expect(idmStep(10, 0, 1, 10, 3).ds).toBeCloseTo(2.9, 9);
    expect(idmStep(10, 0, 1, 10, 0).ds).toBe(0);
  });
});

it('a 1,000-step simulation of 10 vehicles on a 500 m loop keeps every gap non-negative and every speed within the limit', () => {
  const RING = 500; const LEN = 4; const N = 10; const DT = 0.1;
  const limit = 25 / 3.6;
  // Uneven start: a tight platoon followed by long empty stretches, mixed speeds.
  const spacing = [8, 8, 8, 9, 30, 60, 100, 120, 80, 77];
  expect(spacing.reduce((a, b) => a + b, 0)).toBe(RING);
  const pos: number[] = []; let p = 0;
  for (const s of spacing) { pos.push(p); p += s; }
  const vel = [6.9, 2, 6, 0, 5, 6.9, 1, 3, 6.5, 4];
  const gapOf = (i: number) => { const lead = (i + 1) % N; return (((pos[lead]! - pos[i]!) % RING) + RING) % RING - LEN; };
  let minGap = Infinity; let maxV = 0;
  for (let step = 0; step < 1000; step++) {
    const gaps = pos.map((_, i) => gapOf(i));
    const acc = pos.map((_, i) => idmAccel(vel[i]!, limit, gaps[i]!, vel[i]! - vel[(i + 1) % N]!));
    for (let i = 0; i < N; i++) {
      const r = idmStep(vel[i]!, acc[i]!, DT, limit, gaps[i]!);
      vel[i] = r.v; pos[i] = (pos[i]! + r.ds) % RING;
    }
    for (let i = 0; i < N; i++) {
      const g = gapOf(i);
      minGap = Math.min(minGap, g); maxV = Math.max(maxV, vel[i]!);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(vel[i]!).toBeGreaterThanOrEqual(0);
      expect(vel[i]!).toBeLessThanOrEqual(limit + 1e-9);
    }
  }
  // Traffic actually flowed and settled near the equilibrium gap rather than freezing.
  expect(maxV).toBeGreaterThan(limit * 0.9);
  expect(minGap).toBeGreaterThan(0);
});
