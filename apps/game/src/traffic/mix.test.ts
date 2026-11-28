import { describe, expect, it } from 'vitest';
import { VehicleType } from '@ktm/schema';
import { MIN_ROAD_WIDTH_M, SPAWN_MIX, pickVehicleType, spinStep, steerAngle } from './mix.ts';

/** Deterministic uniform [0, 1) generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function share(width: number, n = 40_000): Record<VehicleType, number> {
  const r = rng(7);
  const out = Object.fromEntries(VehicleType.options.map((t) => [t, 0])) as Record<VehicleType, number>;
  for (let i = 0; i < n; i++) out[pickVehicleType(r(), width)] += 1 / n;
  return out;
}

describe('spawn mix', () => {
  it('sums to one and covers every type', () => {
    expect(SPAWN_MIX.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 10);
    expect(new Set(SPAWN_MIX.map(([t]) => t))).toEqual(new Set(VehicleType.options));
  });

  it('gives 30 % motorbikes, 25 % taxis, 15 % micros and 10 % each of tempos, trucks and buses on a main road', () => {
    const s = share(10);
    expect(s.motorbike).toBeCloseTo(0.3, 1);
    expect(s.taxi).toBeCloseTo(0.25, 1);
    expect(s.micro).toBeCloseTo(0.15, 1);
    expect(s.tempo).toBeCloseTo(0.1, 1);
    expect(s.truck).toBeCloseTo(0.1, 1);
    expect(s.bus).toBeCloseTo(0.1, 1);
  });

  it('keeps big vehicles off narrow streets and renormalises the rest', () => {
    const lane = share(4);
    expect(lane.bus).toBe(0); expect(lane.truck).toBe(0); expect(lane.micro).toBe(0);
    expect(lane.motorbike + lane.taxi + lane.tempo).toBeCloseTo(1, 10);
    expect(lane.motorbike).toBeGreaterThan(lane.taxi);
    const residential = share(6);
    expect(residential.bus).toBe(0); expect(residential.truck).toBe(0);
    expect(residential.micro).toBeGreaterThan(0);
  });

  it('always yields a type, whatever the width and the draw', () => {
    for (const w of [0, 1, 3, 100]) for (const r of [0, 0.5, 0.999999]) expect(MIN_ROAD_WIDTH_M[pickVehicleType(r, w)]).toBeLessThanOrEqual(Math.max(w, 0));
  });
});

describe('wheel kinematics', () => {
  it('spins by distance over radius', () => {
    expect(spinStep(0, 10, 0.1, 0.5)).toBeCloseTo(2);
    expect(spinStep(1, 0, 0.1, 0.5)).toBeCloseTo(1);
    expect(spinStep(0, -5, 0.2, 0.5)).toBeCloseTo(-2);
  });

  it('wraps the spin angle so it stays precise', () => {
    const a = spinStep(0, 100, 1000, 0.3);
    expect(Math.abs(a)).toBeLessThanOrEqual(Math.PI);
  });

  it('steers by the bicycle model, left positive, clamped', () => {
    expect(steerAngle(2.5, 0, 10)).toBe(0);
    expect(steerAngle(2.5, 0.4, 10)).toBeCloseTo(Math.atan(2.5 * 0.4 / 10));
    expect(steerAngle(2.5, -0.4, 10)).toBeCloseTo(-Math.atan(2.5 * 0.4 / 10));
    expect(steerAngle(2.5, 3, 1)).toBeCloseTo(0.55);
    expect(steerAngle(2.5, -3, 1)).toBeCloseTo(-0.55);
  });

  it('does not blow up at a standstill', () => {
    expect(Number.isFinite(steerAngle(3, 1, 0))).toBe(true);
    expect(Math.abs(steerAngle(3, 1, 0))).toBeLessThanOrEqual(0.55);
  });
});
