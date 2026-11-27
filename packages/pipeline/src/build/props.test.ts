import { expect, it } from 'vitest';
import { WIRE_HEIGHT_M, WIRE_SPAN_M, alongPolyline, facadeIndex, pointInRing, powerSpans, roofProps, shutterProps } from './props.ts';
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

it('strings sagging wires between consecutive powerpoles, pitched along slopes', () => {
  const poles = alongPolyline([[0, 0], [100, 0]], 40, 3, (x) => x * 0.1, 'powerpole'); // x = 20, 60 -> 40 m apart, 4 m rise
  expect(poles.map((p) => p.x)).toEqual([20, 60, 100]);
  const spans = powerSpans(poles);
  expect(spans).toHaveLength(poles.length - 1);
  const w = spans[0]!;
  expect(w.type).toBe('wires');
  expect([w.x, w.z]).toEqual([poles[0]!.x, poles[0]!.z]);
  expect(w.y).toBeCloseTo(poles[0]!.y + WIRE_HEIGHT_M);
  expect(w.rotY).toBeCloseTo(Math.PI / 2); // heading +X
  expect(w.pitch).toBeCloseTo(Math.atan2(4, 40));
  expect(w.scale).toBeCloseTo(Math.hypot(40, 4) / WIRE_SPAN_M);
  // a gap in the road (poles far apart) is not bridged
  expect(powerSpans([poles[0]!, { ...poles[1]!, x: poles[0]!.x + 200 }])).toEqual([]);
});

it('puts shutters on facades that face a commercial road every 6 m, turned toward the road', () => {
  const north: [number, number][] = [[0, 8], [30, 8], [30, 20], [0, 20]];
  const south: [number, number][] = [[0, -20], [30, -20], [30, -8], [0, -8]];
  const idx = facadeIndex([north, south]);
  const out = shutterProps(idx, [[0, 0], [30, 0]], 3, () => 2);
  const n = out.filter((p) => p.z > 0), s = out.filter((p) => p.z < 0);
  expect(n.map((p) => p.x)).toEqual([3, 9, 15, 21, 27]);
  expect(s.map((p) => p.x)).toEqual([3, 9, 15, 21, 27]);
  expect(n.every((p) => p.type === 'shutter' && Math.abs(Math.abs(p.rotY) - Math.PI) < 1e-9 && Math.abs(p.z - 7.97) < 1e-9 && p.y === 2)).toBe(true);
  expect(s.every((p) => p.rotY === 0 && Math.abs(p.z + 7.97) < 1e-9)).toBe(true);
  expect(shutterProps(idx, [[100, 0], [140, 0]], 3, () => 0)).toEqual([]); // nothing nearby
});
