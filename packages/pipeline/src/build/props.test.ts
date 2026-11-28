import { expect, it } from 'vitest';
import { hash01 } from '@ktm/geo';
import type { Prop } from '@ktm/schema';
import { capProps } from './budget.ts';
import { POLE_ATTACH_M, WIRE_SPAN_M, alongPolyline, facadeProps, pointInRing, roofProps, streetProps, utilityProps, type RoadInfo, type XZ } from './props.ts';

const flat = (): number => 0;
const count = (props: Prop[], type: Prop['type']): number => props.filter((p) => p.type === type).length;
/** The rule says `expected`; the built count must be within +-15 % of it. */
const expectWithin15 = (actual: number, expected: number): void => {
  expect(actual).toBeGreaterThanOrEqual(expected * 0.85);
  expect(actual).toBeLessThanOrEqual(expected * 1.15);
};
const road = (lengthM: number, over: Partial<RoadInfo> = {}): RoadInfo => ({
  id: 'test-road', pts: [[0, 0], [lengthM, 0]], width: 8, highway: 'residential', unpaved: false, vehicle: true, commercial: false, core: false, ...over,
});

it('places points every 30 m with a signed perpendicular offset', () => {
  const pts = alongPolyline([[0, 0], [100, 0]], 30, 4, () => 0);
  expect(pts.map((p) => p.x)).toEqual([15, 45, 75]);
  expect(pts.every((p) => p.z === 4)).toBe(true); // +offset = +z side for an eastbound road
  expect(alongPolyline([[0, 0], [100, 0]], 30, -4, () => 0).every((p) => p.z === -4)).toBe(true);
});

it('point in ring', () => {
  const sq: XZ[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  expect(pointInRing([5, 5], sq)).toBe(true); expect(pointInRing([15, 5], sq)).toBe(false);
});

// ---- rooftops ----

/** n square 12 m roofs with distinct ids. */
const roofs = (n: number, style: string): Prop[][] => Array.from({ length: n }, (_, i) => {
  const x = (i % 50) * 20, z = Math.floor(i / 50) * 20;
  const ring: XZ[] = [[x, z], [x + 12, z], [x + 12, z + 12], [x, z + 12]];
  return roofProps(ring, 12, style, `b${i}`, hash01);
});

it('puts rebar on every unfinished roof and no tank on a non-RCC roof', () => {
  for (const props of roofs(50, 'rcc_unfinished')) expect(count(props, 'rebar')).toBe(4);
  for (const props of roofs(200, 'newari_brick')) expect(count(props, 'water_tank') + count(props, 'rebar')).toBe(0);
});

it('follows the rooftop rules on RCC roofs: tanks 70 %, second tank 20 %, clutter 50 %, pots 25 %', () => {
  const n = 2000;
  const all = roofs(n, 'rcc_plaster_white');
  expectWithin15(all.filter((p) => count(p, 'water_tank') >= 1).length, n * 0.7);
  expectWithin15(all.filter((p) => count(p, 'water_tank') >= 2).length, n * 0.2);
  expectWithin15(all.filter((p) => count(p, 'rooftop_clutter') >= 1).length, n * 0.5);
  expectWithin15(all.filter((p) => count(p, 'parapet_pots') >= 1).length, n * 0.25);
  // everything stands on the roof, inside the footprint
  for (const p of all.flat()) { expect(p.y).toBe(12); expect(p.x).toBeGreaterThan(-1); }
});

it('is deterministic and keeps roof props inside the ring', () => {
  const ring: XZ[] = [[0, 0], [14, 0], [14, 9], [0, 9]];
  const a = roofProps(ring, 10, 'rcc_plaster_pastel', 'w42', hash01);
  expect(roofProps(ring, 10, 'rcc_plaster_pastel', 'w42', hash01)).toEqual(a);
  for (const p of a) expect(pointInRing([p.x, p.z], ring)).toBe(true);
});

// ---- facades ----

/** One long building north of an east-west road at z = 0; its south wall (z = 5) faces the road. */
const frontage = (lengthM: number, id: string, side: 1 | -1 = 1): Prop[] => {
  const z0 = side * 5, z1 = side * 13;
  const ring: XZ[] = side === 1 ? [[0, z0], [lengthM, z0], [lengthM, z1], [0, z1]] : [[0, z1], [lengthM, z1], [lengthM, z0], [0, z0]];
  const nearest = (x: number, z: number): XZ | undefined => (Math.abs(z) <= 15 ? [Math.min(Math.max(x, 0), lengthM), 0] : undefined);
  return facadeProps(ring, 0, 12, id, nearest, hash01);
};

it('puts signs every 4-6 m on a 100 m frontage, alternating 0.1 and 0.6 m from the wall', () => {
  const props = frontage(100, 'shopfront');
  const signs = props.filter((p) => p.type === 'sign').sort((a, b) => a.x - b.x);
  expectWithin15(signs.length, 100 / 5);
  for (let i = 1; i < signs.length; i++) {
    const gap = signs[i]!.x - signs[i - 1]!.x;
    expect(gap).toBeGreaterThanOrEqual(4 - 1e-9); expect(gap).toBeLessThanOrEqual(6 + 1e-9);
    // depth from the wall (z = 5, the sign stands towards the road at -z): alternates between flush and projecting
    expect(Math.abs((signs[i]!.z - 5) - (signs[i - 1]!.z - 5))).toBeCloseTo(0.5, 6);
  }
  expect(5 - signs[0]!.z).toBeCloseTo(0.1, 6);
  // the sign faces the road: local +Z points to -z, so rotY = atan2(0, -1) = pi
  for (const s of signs) { expect(Math.abs(s.rotY)).toBeCloseTo(Math.PI, 6); expect(s.y).toBe(0); }
});

it('puts awnings on 60 % and shutters on 40 % of ground-floor units along 200 m of frontage', () => {
  // 200 m of frontage in 17-unit buildings gives 34 units (6 m or less each)
  const props = [...frontage(100, 'north-side', 1), ...frontage(100, 'south-side', -1)];
  expectWithin15(count(props, 'awning'), 34 * 0.6);
  expectWithin15(count(props, 'shutter'), 34 * 0.4);
});

it('ignores a building whose wall faces away from the road, is out of reach or is too low', () => {
  const ring: XZ[] = [[0, 40], [30, 40], [30, 50], [0, 50]];
  const nearest = (x: number, z: number): XZ | undefined => (Math.abs(z) <= 15 ? [x, 0] : undefined);
  expect(facadeProps(ring, 0, 12, 'far', nearest, hash01)).toEqual([]);
  expect(frontage(30, 'x').length).toBeGreaterThan(0);
  const low: XZ[] = [[0, 5], [30, 5], [30, 13], [0, 13]];
  expect(facadeProps(low, 0, 2.5, 'shed', (x) => [x, 0], hash01)).toEqual([]);
  // only the south wall faces a road on the south: the north, east and west walls get nothing
  const props = frontage(30, 'one');
  expect(props.every((p) => p.z < 7)).toBe(true);
});

// ---- utility ----

it('puts a pole every 35 m, a transformer on every 6th pole and a wire bundle between neighbours', () => {
  const props = utilityProps(road(500), flat, hash01);
  const poles = props.filter((p) => p.type === 'powerpole');
  expectWithin15(poles.length, 500 / 35);
  expectWithin15(count(props, 'transformer'), poles.length / 6);
  expect(count(props, 'wires')).toBe(poles.length - 1);
  const [a, b] = poles;
  expect(Math.hypot(b!.x - a!.x, b!.z - a!.z)).toBeCloseTo(35, 6);
  const w = props.find((p) => p.type === 'wires')!;
  expect(w.scale).toBeCloseTo(1, 6); expect(w.pitch).toBeCloseTo(0, 9);
  expect(w.y).toBeCloseTo(POLE_ATTACH_M, 9);
  expect(w.x).toBeCloseTo((a!.x + b!.x) / 2, 9);
  // the transformer sits on the 6th pole
  const t = props.find((p) => p.type === 'transformer')!;
  expect(t.x).toBeCloseTo(poles[5]!.x, 9);
});

it('tilts and stretches the wires to follow a slope', () => {
  const props = utilityProps(road(100), (x) => 0.1 * x, hash01);
  const [a, b] = props.filter((p) => p.type === 'powerpole');
  const w = props.find((p) => p.type === 'wires')!;
  expect(w.pitch).toBeCloseTo(Math.atan(0.1), 6);
  expect(w.scale).toBeCloseTo(Math.hypot(35, 3.5) / WIRE_SPAN_M, 6);
  expect(w.y).toBeCloseTo((a!.y + b!.y) / 2 + POLE_ATTACH_M, 9);
  // rotY points along the span, so the wire ends meet the poles
  const dx = Math.sin(w.rotY) * 17.5, dz = Math.cos(w.rotY) * 17.5;
  expect(w.x - dx).toBeCloseTo(a!.x, 6); expect(w.z - dz).toBeCloseTo(a!.z, 6);
});

it('moves a pole to the other kerb when a building stands in its place, and skips footways', () => {
  const free = utilityProps(road(100), flat, hash01).filter((p) => p.type === 'powerpole');
  const side = Math.sign(free[0]!.z);
  const moved = utilityProps(road(100), flat, hash01, (_x, z) => Math.sign(z) === side).filter((p) => p.type === 'powerpole');
  expect(moved.length).toBe(free.length);
  expect(moved.every((p) => Math.sign(p.z) === -side)).toBe(true);
  expect(utilityProps(road(100, { vehicle: false }), flat, hash01)).toEqual([]);
});

// ---- street level ----

it('parks clusters of 3-8 bikes every 25 m at the kerb of a commercial 100 m road', () => {
  const bikes = streetProps(road(100, { commercial: true, highway: 'tertiary' }), flat, hash01).filter((p) => p.type === 'parked_bike').sort((a, b) => a.x - b.x);
  const clusters: Prop[][] = [];
  for (const b of bikes) {
    const last = clusters.at(-1);
    if (last && b.x - last.at(-1)!.x < 5) last.push(b); else clusters.push([b]);
  }
  expectWithin15(clusters.length, 100 / 25);
  for (const c of clusters) { expect(c.length).toBeGreaterThanOrEqual(3); expect(c.length).toBeLessThanOrEqual(8); }
  for (const b of bikes) expect(Math.abs(Math.abs(b.z) - 3)).toBeLessThan(0.01); // width 8 -> kerb at 4, bikes 1 m in
});

it('puts 2 puddles per 100 m on unpaved roads and none on asphalt', () => {
  const props = streetProps(road(100, { unpaved: true }), flat, hash01);
  expectWithin15(count(props, 'puddle'), 2);
  for (const p of props.filter((q) => q.type === 'puddle')) { expect(p.scale).toBeGreaterThanOrEqual(1); expect(p.scale).toBeLessThanOrEqual(2); }
  expect(count(streetProps(road(100), flat, hash01), 'puddle')).toBe(0);
});

it('follows the sparse street rules on a 480 m road (a 100 m road is shorter than their spacing)', () => {
  const core = streetProps(road(480, { commercial: true, core: true, highway: 'tertiary' }), flat, hash01);
  expectWithin15(count(core, 'banner'), 480 / 40);
  expectWithin15(count(core, 'vendor_cart'), 480 / 60);
  const res = streetProps(road(480), flat, hash01);
  expectWithin15(count(res, 'rubbish_pile'), 480 / 80);
  expectWithin15(count(res, 'tree'), 480 / 30);
  // a residential road is not commercial: no bikes, banners or carts
  expect(count(res, 'parked_bike') + count(res, 'banner') + count(res, 'vendor_cart')).toBe(0);
});

it('plants trees only where the road is at least 6 m wide, and keeps street props out of buildings', () => {
  expect(count(streetProps(road(300, { width: 5.5, highway: 'residential' }), flat, hash01), 'tree')).toBe(0);
  expect(count(streetProps(road(300, { width: 6, highway: 'residential' }), flat, hash01), 'tree')).toBe(10);
  const blockedAll = streetProps(road(480, { commercial: true, core: true }), flat, hash01, () => true);
  expect(count(blockedAll, 'tree') + count(blockedAll, 'parked_bike') + count(blockedAll, 'vendor_cart') + count(blockedAll, 'rubbish_pile')).toBe(0);
});

// ---- budget ----

it('thins the elastic types to fit the budget, keeps fixed props and every kind, and is deterministic', () => {
  const mk = (type: Prop['type'], n: number): Prop[] => Array.from({ length: n }, (_, i) => ({ type, x: i * 0.37, y: 0, z: (i * 7.13) % 800, rotY: 0, scale: 1 }));
  const props = [...mk('powerpole', 300), ...mk('wires', 300), ...mk('sign', 4000), ...mk('awning', 3000), ...mk('shutter', 2000), ...mk('parked_bike', 1500), ...mk('puddle', 10)];
  const a = capProps(props, 5_999, hash01);
  expect(a.props.length).toBeLessThanOrEqual(5_999);
  expect(a.props.length).toBeGreaterThan(5_900);
  expect(count(a.props, 'powerpole')).toBe(300);
  expect(count(a.props, 'wires')).toBe(300);
  for (const t of ['sign', 'awning', 'shutter', 'parked_bike'] as const) expect(count(a.props, t)).toBeGreaterThan(300);
  expect(capProps(props, 5_999, hash01).props).toEqual(a.props);
  expect(capProps(props.slice(0, 100), 5_999, hash01)).toEqual({ props: props.slice(0, 100), dropped: {} });
  // fixed props alone over the limit: trees go
  const trees = [...mk('powerpole', 5_990), ...mk('tree', 30)];
  const b = capProps(trees, 5_999, hash01);
  expect(b.props.length).toBe(5_999);
  expect(count(b.props, 'powerpole')).toBe(5_990);
});
