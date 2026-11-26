import { expect, it } from 'vitest';
import { alongPolyline, pointInRing, roofProps } from './props.ts';
it('places points every 30 m with a signed perpendicular offset', () => {
  const pts = alongPolyline([[0, 0], [100, 0]], 30, 4, () => 0);
  expect(pts.map((p) => p.x)).toEqual([15, 45, 75]);
  expect(pts.every((p) => p.z === 4)).toBe(true); // +offset = +z side for an eastbound road
  expect(alongPolyline([[0, 0], [100, 0]], 30, -4, () => 0).every((p) => p.z === -4)).toBe(true);
});
it('point in ring', () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  expect(pointInRing([5, 5], sq)).toBe(true); expect(pointInRing([15, 5], sq)).toBe(false);
});
it('puts a water tank on rcc flat roofs by hash and rebar on unfinished roofs', () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  expect(roofProps(sq, 12, 'rcc_plaster_white', 0.9).map((p) => p.type)).toEqual(['water_tank']);
  expect(roofProps(sq, 12, 'rcc_plaster_white', 0.1)).toEqual([]);
  expect(roofProps(sq, 12, 'rcc_unfinished', 0.1).map((p) => p.type)).toEqual(['rebar', 'rebar', 'rebar', 'rebar']);
});
