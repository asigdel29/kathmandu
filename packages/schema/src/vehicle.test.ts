import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VehicleTunings } from './vehicle.ts';

const raw: unknown = JSON.parse(readFileSync(new URL('../../../world/vehicles.json', import.meta.url), 'utf8'));
const clone = (): any => structuredClone(raw);

describe('VehicleTunings', () => {
  it('parses world/vehicles.json', () => {
    expect(() => VehicleTunings.parse(raw)).not.toThrow();
  });

  it('has the expected per-type values', () => {
    const { vehicles: v } = VehicleTunings.parse(raw);
    expect(v.tempo).toMatchObject({ wheels: 3, maxSpeedKmh: 45, width: 1.2, leanMaxDeg: 0 });
    expect(v.taxi).toMatchObject({ wheels: 4, maxSpeedKmh: 90, width: 1.7, leanMaxDeg: 0 });
    expect(v.motorbike).toMatchObject({ wheels: 2, maxSpeedKmh: 80, width: 0.6 });
    expect(v.motorbike.leanMaxDeg).toBeGreaterThan(0);
    for (const t of [v.tempo, v.taxi, v.motorbike]) expect(t.steerFadeStartKmh).toBe(60);
  });

  it('has the three heavier traffic types', () => {
    const { vehicles: v } = VehicleTunings.parse(raw);
    expect(v.bus.massKg).toBeGreaterThan(v.truck.massKg);
    expect(v.truck.massKg).toBeGreaterThan(v.micro.massKg);
    expect(v.micro.massKg).toBeGreaterThan(v.taxi.massKg);
    for (const t of [v.bus, v.truck, v.micro]) expect(t.wheels).toBe(4);
  });

  it('keeps optional axle positions inside the chassis', () => {
    const { vehicles: v } = VehicleTunings.parse(raw);
    for (const t of Object.values(v)) {
      for (const a of [t.frontAxle, t.rearAxle]) if (a !== undefined) expect(a).toBeLessThan(t.length / 2);
    }
    expect(v.bus.frontAxle).toBeDefined();
    const bad = clone();
    bad.vehicles.bus.frontAxle = -1;
    expect(() => VehicleTunings.parse(bad)).toThrow();
  });

  it('rejects an unknown key', () => {
    const d = clone();
    d.vehicles.taxi.turbo = true;
    expect(() => VehicleTunings.parse(d)).toThrow();
  });

  it('rejects a wheels value of 5', () => {
    const d = clone();
    d.vehicles.taxi.wheels = 5;
    expect(() => VehicleTunings.parse(d)).toThrow();
  });

  it('rejects a missing vehicle type', () => {
    const d = clone();
    delete d.vehicles.motorbike;
    expect(() => VehicleTunings.parse(d)).toThrow();
  });

  it('rejects steerFadeEndKmh <= steerFadeStartKmh', () => {
    const eq = clone();
    eq.vehicles.tempo.steerFadeEndKmh = eq.vehicles.tempo.steerFadeStartKmh;
    expect(() => VehicleTunings.parse(eq)).toThrow();
    const lt = clone();
    lt.vehicles.tempo.steerFadeEndKmh = 30;
    expect(() => VehicleTunings.parse(lt)).toThrow();
  });
});
