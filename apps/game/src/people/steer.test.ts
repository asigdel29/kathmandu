import { describe, expect, it } from 'vitest';
import { makePath, pointAt, project, resolveOverlaps, STEER_DEFAULTS, stepWalker, type Walker, type XZ } from './steer.ts';

const DT = 1 / 30;
const walker = (p: XZ, speed = 1.4): Walker => ({ x: p.x, z: p.z, vx: 0, vz: 0, s: 0, speed });

describe('path geometry', () => {
  it('measures, samples and projects a polyline', () => {
    const path = makePath([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]);
    expect(path.pts).toHaveLength(3);
    expect(path.length).toBeCloseTo(20);
    expect(path.cum).toEqual([0, 10, 20]);
    const p = pointAt(path, 15);
    expect(p.x).toBeCloseTo(10); expect(p.z).toBeCloseTo(5);
    expect(p.tx).toBeCloseTo(0); expect(p.tz).toBeCloseTo(1);
    expect(pointAt(path, -5).x).toBeCloseTo(0);
    expect(pointAt(path, 99).z).toBeCloseTo(10);
    const q = project(path, { x: 4, z: -3 });
    expect(q.s).toBeCloseTo(4); expect(q.dist).toBeCloseTo(3);
    const r = project(path, { x: 12, z: 7 }, 16);
    expect(r.s).toBeCloseTo(17); expect(r.dist).toBeCloseTo(2);
  });
});

describe('stepWalker', () => {
  it('stays within 1.5 m of a 100 m zig-zag polyline for 1,000 steps', () => {
    const pts: XZ[] = [];
    for (let i = 0; i <= 10; i++) pts.push({ x: i * 7, z: i % 2 === 0 ? 0 : 7 }); // 45 degree legs, 90 degree corners
    const path = makePath(pts);
    expect(path.length).toBeGreaterThanOrEqual(98);
    const a = walker(pts[0]!);
    for (let i = 0; i < 1000; i++) {
      stepWalker(a, path, [], DT);
      expect(project(path, a).dist).toBeLessThanOrEqual(1.5);
    }
    expect(a.s).toBeGreaterThan(40);
  });

  it('never lets two walkers on a head-on course overlap, and they pass each other', () => {
    const fwd = makePath([{ x: 0, z: 0 }, { x: 30, z: 0 }]);
    const back = makePath([{ x: 30, z: 0 }, { x: 0, z: 0 }]);
    const a = walker({ x: 0, z: 0 }); const b = walker({ x: 30, z: 0 });
    for (let i = 0; i < 600; i++) {
      const pa = { x: a.x, z: a.z }; const pb = { x: b.x, z: b.z };
      stepWalker(a, fwd, [pb], DT);
      stepWalker(b, back, [pa], DT);
      resolveOverlaps([a, b]);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.7 - 1e-9);
    }
    expect(a.x).toBeGreaterThan(20);
    expect(b.x).toBeLessThan(10);
  });

  it('never lets two walkers on crossing paths overlap', () => {
    const pa = makePath([{ x: -15, z: 0 }, { x: 15, z: 0 }]);
    const pb = makePath([{ x: 0, z: -15 }, { x: 0, z: 15 }]);
    const a = walker({ x: -15, z: 0 }); const b = walker({ x: 0, z: -15 });
    for (let i = 0; i < 600; i++) {
      const qa = { x: a.x, z: a.z }; const qb = { x: b.x, z: b.z };
      stepWalker(a, pa, [qb], DT);
      stepWalker(b, pb, [qa], DT);
      resolveOverlaps([a, b]);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.7 - 1e-9);
    }
    expect(a.x).toBeGreaterThan(5);
    expect(b.z).toBeGreaterThan(5);
  });

  it('does not walk into a neighbour that does not move', () => {
    const path = makePath([{ x: 0, z: 0 }, { x: 20, z: 0 }]);
    const a = walker({ x: 0, z: 0 });
    const still = { x: 5, z: 0 };
    for (let i = 0; i < 300; i++) {
      stepWalker(a, path, [still], DT);
      expect(Math.hypot(a.x - still.x, a.z - still.z)).toBeGreaterThanOrEqual(0.7 - 1e-9);
    }
  });

  it('brakes to a halt within the stopping distance when told to stop', () => {
    const path = makePath([{ x: 0, z: 0 }, { x: 50, z: 0 }]);
    const a = walker({ x: 0, z: 0 }, 1.4);
    for (let i = 0; i < 90; i++) stepWalker(a, path, [], DT);
    const v = Math.hypot(a.vx, a.vz);
    expect(v).toBeGreaterThan(1.2);
    const x0 = a.x;
    for (let i = 0; i < 120; i++) stepWalker(a, path, [], DT, true);
    expect(Math.hypot(a.vx, a.vz)).toBe(0);
    expect(a.x - x0).toBeLessThanOrEqual((v * v) / (2 * STEER_DEFAULTS.maxAccel) + 0.1);
  });

  it('stops at the end of its path', () => {
    const path = makePath([{ x: 0, z: 0 }, { x: 5, z: 0 }]);
    const a = walker({ x: 0, z: 0 });
    for (let i = 0; i < 300; i++) stepWalker(a, path, [], DT);
    expect(a.s).toBeCloseTo(path.length, 0);
    expect(Math.hypot(a.vx, a.vz)).toBeLessThan(0.05);
  });
});

describe('resolveOverlaps', () => {
  it('moves only the free item away from a fixed one', () => {
    const player = { x: 0, z: 0, fixed: true };
    const w = { x: 0.3, z: 0 };
    resolveOverlaps([player, w]);
    expect(player.x).toBe(0);
    expect(w.x).toBeCloseTo(0.7);
  });

  it('splits the correction between two free items', () => {
    const a = { x: 0, z: 0 }; const b = { x: 0.5, z: 0 };
    resolveOverlaps([a, b]);
    expect(a.x).toBeCloseTo(-0.1); expect(b.x).toBeCloseTo(0.6);
  });
});
