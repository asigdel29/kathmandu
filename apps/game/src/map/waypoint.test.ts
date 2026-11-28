import { describe, expect, it } from 'vitest';
import { formatDistance, Waypoint, WAYPOINT_REACHED_M } from './waypoint.ts';

describe('Waypoint', () => {
  it('reports nothing without a target', () => {
    expect(new Waypoint().update(0, 0)).toBeUndefined();
  });

  it('reports distance and bearing until reached, then clears', () => {
    const w = new Waypoint();
    w.set(0, -400);
    const a = w.update(0, 0)!;
    expect(a.distance).toBeCloseTo(400, 9);
    expect(a.bearing).toBeCloseTo(0, 9);
    w.set(300, 0);
    expect(w.update(0, 0)!.bearing).toBeCloseTo(90, 9);
    expect(w.update(300 - WAYPOINT_REACHED_M - 1, 0)).toBeDefined();
    expect(w.update(300 - WAYPOINT_REACHED_M + 1, 0)).toBeUndefined();
    expect(w.target).toBeUndefined();
  });

  it('clears on request', () => {
    const w = new Waypoint();
    w.set(10, 10); w.clear();
    expect(w.target).toBeUndefined();
  });

  it('formats distances', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1234)).toBe('1.2 km');
  });
});
