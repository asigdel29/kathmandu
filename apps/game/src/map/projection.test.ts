import { describe, expect, it } from 'vitest';
import { bearingDeg, headingFromDirection, mapToWorld, minimapView, MINIMAP_PX, panView, worldToMap, zoomViewAt, type MapView } from './projection.ts';

const P = { x: 1234.5, z: -678.9 };
const C = MINIMAP_PX / 2;

describe('minimap projection', () => {
  it('puts the player at the centre and 150 m east at +100 px', () => {
    const v = minimapView(P.x, P.z);
    expect(worldToMap(v, P.x, P.z)).toEqual({ px: C, py: C });
    const e = worldToMap(v, P.x + 150, P.z);
    expect(e.px - C).toBeCloseTo(100, 9);
    expect(e.py).toBeCloseTo(C, 9);
  });

  it('is north-up: 150 m north is 100 px up', () => {
    const n = worldToMap(minimapView(P.x, P.z), P.x, P.z - 150);
    expect(n.px).toBeCloseTo(C, 9);
    expect(n.py - C).toBeCloseTo(-100, 9);
  });

  it('reaches the edge at the 300 m radius', () => {
    const v = minimapView(P.x, P.z);
    expect(worldToMap(v, P.x + 300, P.z).px).toBeCloseTo(MINIMAP_PX, 9);
    expect(worldToMap(v, P.x, P.z + 300).py).toBeCloseTo(MINIMAP_PX, 9);
  });

  it('round-trips world -> pixel -> world', () => {
    const views: MapView[] = [minimapView(P.x, P.z), minimapView(-17000, 13000), { cx: -500, cz: 250, pxPerM: 0.137, width: 1920, height: 1080 }];
    const pts = [[0, 0], [P.x + 150, P.z], [-17753.9, 13297.7], [9000.25, -12000.5]] as const;
    for (const v of views) for (const [x, z] of pts) {
      const { px, py } = worldToMap(v, x, z);
      const w = mapToWorld(v, px, py);
      expect(Math.abs(w.x - x)).toBeLessThan(1e-9);
      expect(Math.abs(w.z - z)).toBeLessThan(1e-9);
    }
  });
});

describe('map screen view', () => {
  const v: MapView = { cx: 100, cz: 200, pxPerM: 0.5, width: 800, height: 600 };

  it('pans with the pointer and leaves the input alone', () => {
    const before = worldToMap(v, 300, 400);
    const p = panView(v, 30, -20);
    const after = worldToMap(p, 300, 400);
    expect(after.px - before.px).toBeCloseTo(30, 9);
    expect(after.py - before.py).toBeCloseTo(-20, 9);
    expect(v).toEqual({ cx: 100, cz: 200, pxPerM: 0.5, width: 800, height: 600 });
  });

  it('zooms about the cursor and clamps the scale', () => {
    const at = mapToWorld(v, 650, 120);
    const z = zoomViewAt(v, 650, 120, 3, 0.01, 4);
    expect(z.pxPerM).toBeCloseTo(1.5, 12);
    const w = mapToWorld(z, 650, 120);
    expect(w.x).toBeCloseTo(at.x, 9);
    expect(w.z).toBeCloseTo(at.z, 9);
    expect(zoomViewAt(v, 0, 0, 100, 0.01, 4).pxPerM).toBe(4);
    expect(zoomViewAt(v, 0, 0, 1e-6, 0.01, 4).pxPerM).toBe(0.01);
    expect(v.pxPerM).toBe(0.5);
  });
});

describe('bearings', () => {
  it('measures clockwise from north', () => {
    expect(bearingDeg(0, 0, 0, -10)).toBeCloseTo(0, 9);
    expect(bearingDeg(0, 0, 10, 0)).toBeCloseTo(90, 9);
    expect(bearingDeg(0, 0, 0, 10)).toBeCloseTo(180, 9);
    expect(bearingDeg(0, 0, -10, 0)).toBeCloseTo(270, 9);
    expect(bearingDeg(5, 5, 15, -5)).toBeCloseTo(45, 9);
    expect(bearingDeg(3, 3, 3, 3)).toBe(0);
  });

  it('converts a yaw forward vector to a compass heading', () => {
    expect(headingFromDirection(Math.sin(0), Math.cos(0))).toBeCloseTo(180, 9);
    expect(headingFromDirection(Math.sin(Math.PI / 2), Math.cos(Math.PI / 2))).toBeCloseTo(90, 9);
    expect(headingFromDirection(0, -1)).toBeCloseTo(0, 9);
    expect(headingFromDirection(-1, 0)).toBeCloseTo(270, 9);
  });
});
