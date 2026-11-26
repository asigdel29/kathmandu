import { describe, expect, it } from 'vitest';
import type { VehicleTuning } from '@ktm/schema';
import { approach, kmhToMs, msToKmh, steerLimit } from './Vehicle.ts';

const tuning: VehicleTuning = {
  wheels: 4, maxSpeedKmh: 90, width: 1.7, length: 4, height: 1.5, massKg: 1100,
  engineForce: 4500, brakeForce: 60, handbrakeForce: 120, maxSteerDeg: 32,
  steerFadeStartKmh: 60, steerFadeEndKmh: 120, wheelRadius: 0.32, suspensionRestLength: 0.3,
  suspensionStiffness: 30, suspensionCompression: 4.4, suspensionRelaxation: 2.3, frictionSlip: 2.5, leanMaxDeg: 0,
};
const maxSteer = (32 * Math.PI) / 180;

describe('unit conversion', () => {
  it('converts m/s and km/h', () => {
    expect(msToKmh(10)).toBeCloseTo(36);
    expect(kmhToMs(90)).toBeCloseTo(25);
    expect(kmhToMs(msToKmh(7.3))).toBeCloseTo(7.3);
  });
});

describe('steerLimit', () => {
  it('is the full lock up to the fade start', () => {
    expect(steerLimit(0, tuning)).toBeCloseTo(maxSteer);
    expect(steerLimit(60, tuning)).toBeCloseTo(maxSteer);
  });
  it('eases to half lock midway through the fade', () => {
    const mid = steerLimit(90, tuning);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(maxSteer);
    expect(mid).toBeCloseTo(maxSteer / 2);
  });
  it('is zero at and beyond the fade end', () => {
    expect(steerLimit(120, tuning)).toBe(0);
    expect(steerLimit(150, tuning)).toBe(0);
  });
  it('never increases with speed', () => {
    let prev = Infinity;
    for (let k = 0; k <= 150; k += 0.5) {
      const v = steerLimit(k, tuning);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it('is symmetric in reverse', () => {
    for (const k of [0, 30, 75, 90, 110, 150]) expect(steerLimit(-k, tuning)).toBeCloseTo(steerLimit(k, tuning));
  });
});

describe('approach', () => {
  it('moves toward the target without overshooting and reaches it', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) {
      const next = approach(v, 0.5, 2, 1 / 60);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(0.5);
      v = next;
    }
    expect(v).toBe(0.5);
    let w = 0.4;
    for (let i = 0; i < 100; i++) { w = approach(w, -0.2, 3, 1 / 60); expect(w).toBeGreaterThanOrEqual(-0.2); }
    expect(w).toBe(-0.2);
    expect(approach(1, 0, 100, 1)).toBe(0);
  });
});
