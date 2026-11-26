import { describe, expect, it } from 'vitest';
import type { Prop } from '@ktm/schema';
import { fallbackSpawns, fixedSteps, nearestWithin, propSpawns, yawTowards } from './Garage.ts';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('yawTowards', () => {
  it('uses forward = (sin yaw, cos yaw)', () => {
    expect(yawTowards({ x: 0, z: 0 }, { x: 0, z: 10 })).toBeCloseTo(0);
    expect(yawTowards({ x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(yawTowards({ x: 5, z: 5 }, { x: 5, z: 5 })).toBe(0);
  });
});

describe('fallbackSpawns', () => {
  const start = { x: 100, z: 200 }; const lookAt = { x: 100, z: 260 };
  const spawns = fallbackSpawns(start, lookAt);
  it('places one of each type 15 m from the spawn', () => {
    expect(spawns.map((s) => s.type).sort()).toEqual(['motorbike', 'taxi', 'tempo']);
    for (const s of spawns) expect(dist(s, start)).toBeCloseTo(15);
  });
  it('keeps them a few metres apart, behind the spawn, facing down the street', () => {
    for (let i = 0; i < spawns.length; i++) for (let j = i + 1; j < spawns.length; j++) expect(dist(spawns[i]!, spawns[j]!)).toBeGreaterThan(3);
    for (const s of spawns) { expect(s.z).toBeLessThan(start.z); expect(s.yaw).toBeCloseTo(0); }
  });
  it('copes with a look-at on top of the spawn', () => {
    for (const s of fallbackSpawns(start, start)) expect(dist(s, start)).toBeCloseTo(15);
  });
});

describe('propSpawns', () => {
  const prop = (type: Prop['type'], x: number, z: number, rotY = 0): Prop => ({ type, x, y: 0, z, rotY, scale: 1 });
  it('turns taxi_spawn props into world-space spawns cycling the vehicle types', () => {
    const tiles = [
      { origin: { x: 1000, z: 2000 }, props: [prop('tree', 1, 1), prop('taxi_spawn', 10, 20, 1.5), prop('taxi_spawn', 30, 40)] },
      { origin: { x: 0, z: 0 }, props: [prop('taxi_spawn', 5, 5)] },
    ];
    const s = propSpawns(tiles, { x: 1000, z: 2000 });
    expect(s).toHaveLength(3);
    expect(s.map((v) => v.type)).toEqual(['tempo', 'taxi', 'motorbike']);
    expect(s[0]).toMatchObject({ x: 1010, z: 2020, yaw: 1.5 });
  });
  it('keeps only the nearest when there are too many', () => {
    const props = Array.from({ length: 10 }, (_, i) => prop('taxi_spawn', i * 10, 0));
    const s = propSpawns([{ origin: { x: 0, z: 0 }, props }], { x: 0, z: 0 }, 4);
    expect(s.map((v) => v.x)).toEqual([0, 10, 20, 30]);
  });
});

describe('nearestWithin', () => {
  const items = [{ id: 'a', position: { x: 0, y: 5, z: 0 } }, { id: 'b', position: { x: 2, y: 0, z: 0 } }, { id: 'c', position: { x: 2.5, y: 0, z: 0 } }];
  it('returns the closest item within the radius on the ground plane', () => {
    expect(nearestWithin({ x: 2.4, z: 0 }, items, 3)?.id).toBe('c');
    expect(nearestWithin({ x: 0.5, z: 0 }, items, 3)?.id).toBe('a');
    expect(nearestWithin({ x: 10, z: 0 }, items, 3)).toBeUndefined();
    expect(nearestWithin({ x: 0, z: 0 }, [], 3)).toBeUndefined();
  });
});

describe('fixedSteps', () => {
  it('runs whole 1/60 s steps and carries the remainder', () => {
    const r = fixedSteps(0, 1 / 30 + 0.001, 1 / 60, 8);
    expect(r.steps).toBe(2);
    expect(r.acc).toBeCloseTo(0.001);
    expect(fixedSteps(0, 0.005, 1 / 60, 8)).toMatchObject({ steps: 0, acc: 0.005 });
  });
  it('caps the steps per frame and drops the backlog', () => {
    const r = fixedSteps(0, 0.2, 1 / 60, 8);
    expect(r.steps).toBe(8);
    expect(r.acc).toBeLessThan(1 / 60);
  });
  it('clamps the frame time to 0.25 s and ignores negative time', () => {
    expect(fixedSteps(0, 5, 1 / 60, 100).steps).toBe(15);
    // Headless test runs raise the frame clamp so a 1 fps software renderer still simulates in real time.
    expect(fixedSteps(0, 1.2, 1 / 60, 200, 1.5).steps).toBe(72);
    expect(fixedSteps(0, 5, 1 / 60, 200, 1.5).steps).toBe(90);
    expect(fixedSteps(0, -1, 1 / 60, 8)).toMatchObject({ steps: 0, acc: 0 });
  });
});
