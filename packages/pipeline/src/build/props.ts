import type { Prop } from '@ktm/schema';
export type XZ = [number, number];
export type Hash = (s: string) => number;
export type YAt = (x: number, z: number) => number;

/** Height (m) above the ground at which wires leave a power pole. The wires prop is authored around this height. */
export const POLE_ATTACH_M = 7.2;
/** Span (m) the wires prop geometry is authored for; instances are scaled to the real chord. */
export const WIRE_SPAN_M = 35;
export const POWERPOLE_EVERY_M = 35;
/** Longest chord (m) that still gets a wire bundle; a longer gap means a pole was skipped or lies in another tile. */
const WIRE_MAX_M = 55;
/** A tile must carry fewer props than this; `validate` enforces it and the builder thins to fit. */
export const MAX_PROPS_PER_TILE = 6_000;
/** Facade props go on ground floors within this distance (m) of a commercial road. */
export const FACADE_REACH_M = 15;

const fract = (v: number): number => v - Math.floor(v);
/** Golden-ratio step: successive multiples are evenly spread over [0,1), so a rule such as "60 %" holds closely on short runs. */
const PHI = 0.6180339887498949;
/** Deterministic, evenly spread selection: true for about `rate` of k = 0, 1, 2, ... starting from hash h0. */
const pick = (h0: number, k: number, rate: number): boolean => fract(h0 + k * PHI) < rate;

export interface Sample { x: number; z: number; dx: number; dz: number; d: number }

/** Centreline samples every `every` m (first at every/2); (dx, dz) is the unit direction of travel, d the distance walked. */
export function sampleAlong(pts: XZ[], every: number): Sample[] {
  const out: Sample[] = [];
  let carry = every / 2, walked = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az); if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let d = carry; d <= len; d += every) out.push({ x: ax + dx * d, z: az + dz * d, dx, dz, d: walked + d });
    carry = ((carry - len) % every + every) % every;
    walked += len;
  }
  return out;
}

/** Points every `every` meters along a polyline, offset perpendicular (positive = right of travel when seen from +Y, i.e. +z for eastbound). */
export function alongPolyline(pts: XZ[], every: number, offset: number, yAt: YAt, type: Prop['type'] = 'streetlight'): Prop[] {
  return sampleAlong(pts, every).map((s) => {
    // right-hand perpendicular in XZ: for dx=1,dz=0 -> (0, 1) = +z
    const x = s.x - s.dz * offset, z = s.z + s.dx * offset;
    return { type, x, y: yAt(x, z), z, rotY: Math.atan2(s.dx, s.dz), scale: 1 };
  });
}

export function pointInRing([px, pz]: XZ, ring: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Absolute polygon area, m². */
export function ringArea(ring: XZ[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(a) / 2;
}

/**
 * Clutter on a flat roof, every role decided by hash(id + role): water tank on 70 % of RCC roofs
 * (a second one on 20 %, nested in the first), rebar on every unfinished roof, rooftop clutter on 50 %,
 * parapet pots on 25 %. Tiny roofs skip the extras.
 */
export function roofProps(ring: XZ[], roofY: number, style: string, id: string, hash: Hash = () => 0.5): Prop[] {
  const out: Prop[] = [];
  const n = ring.length; if (n < 3) return out;
  let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x / n; cz += z / n; }
  const area = ringArea(ring);
  const inward = (k: number, f: number): XZ => { const v = ring[((k % n) + n) % n]!; return [cx + (v[0] - cx) * f, cz + (v[1] - cz) * f]; };
  const put = (type: Prop['type'], [x, z]: XZ, rotY: number): boolean => {
    if (!pointInRing([x, z], ring)) return false;
    out.push({ type, x, y: roofY, z, rotY, scale: 1 }); return true;
  };
  const kTank = Math.floor(hash(`${id}:tankpos`) * n);
  let tank: XZ | undefined;
  if (style.startsWith('rcc') && area >= 20) {
    const u = hash(`${id}:tank`);
    if (u < 0.7) { tank = inward(kTank, 0.4); if (!put('water_tank', tank, hash(`${id}:tankrot`) * 6.283)) tank = undefined; }
    if (u < 0.2 && area >= 40) put('water_tank', inward(kTank + Math.max(1, Math.floor(n / 2)), 0.4), hash(`${id}:tank2rot`) * 6.283);
  }
  if (style === 'rcc_unfinished') {
    for (let k = 0; k < Math.min(4, n); k++) put('rebar', inward(Math.floor((k / 4) * n), 0.85), 0);
  }
  if (area >= 30 && hash(`${id}:clutter`) < 0.5) {
    const k = Math.floor(hash(`${id}:clutterpos`) * n) + 1;
    let p = inward(k, 0.3);
    // keep clear of the water tank
    if (tank && Math.hypot(p[0] - tank[0], p[1] - tank[1]) < 2) p = inward(k + Math.floor(n / 2), 0.3);
    put('rooftop_clutter', p, hash(`${id}:clutterrot`) * 6.283);
  }
  if (area >= 20 && hash(`${id}:pots`) < 0.25) {
    const e = Math.floor(hash(`${id}:potspos`) * n);
    const a = ring[e % n]!, b = ring[(e + 1) % n]!;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    put('parapet_pots', [mx + (cx - mx) * 0.12, mz + (cz - mz) * 0.12], Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.PI / 2);
  }
  return out;
}

/** Trees in a green ring on a 12 m jittered grid, thinned by hash. */
export function treesInRing(ring: XZ[], yAt: YAt, hash: Hash, seed: string, density = 0.5): Prop[] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const out: Prop[] = [];
  for (let x = minX; x < maxX; x += 12) for (let z = minZ; z < maxZ; z += 12) {
    const h = hash(`${seed}:${x.toFixed(0)}:${z.toFixed(0)}`);
    if (h > density) continue;
    const px = x + (h * 97 % 1) * 8, pz = z + (h * 31 % 1) * 8;
    if (pointInRing([px, pz], ring)) out.push({ type: 'tree', x: px, y: yAt(px, pz), z: pz, rotY: h * 6.283, scale: 0.8 + h * 0.6 });
  }
  return out;
}

/** Closest point of a commercial road within FACADE_REACH_M of (x, z), if any. */
export type NearestRoad = (x: number, z: number) => XZ | undefined;

/**
 * Ground-floor props on the facades of one building (outer ring, open) that face a commercial road.
 * A facade is a footprint edge of at least 2.5 m whose midpoint lies within 15 m of the road and looks towards it;
 * edges longer than 6 m are split into equal units of at most 6 m (one shop front each).
 * - sign: every 4-6 m along the edge at 3.2 m, depth from the wall alternating 0.1 / 0.6 m
 * - awning on 60 % of units, shutter on 40 % of units
 * Props sit on the wall surface with local +Z along the outward normal. `baseY` is the ground at the building.
 */
export function facadeProps(ring: XZ[], baseY: number, height: number, id: string, nearestRoad: NearestRoad, hash: Hash): Prop[] {
  const out: Prop[] = [];
  const n = ring.length;
  if (n < 3 || height < 3.5 || ringArea(ring) < 12) return out;
  for (let e = 0; e < n; e++) {
    const [ax, az] = ring[e]!, [bx, bz] = ring[(e + 1) % n]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 2.5) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = tz, nz = -tx;
    if (pointInRing([mx + nx * 0.2, mz + nz * 0.2], ring)) { nx = -nx; nz = -nz; }
    const road = nearestRoad(mx, mz);
    if (!road) continue;
    const rd = Math.hypot(road[0] - mx, road[1] - mz) || 1;
    if (((road[0] - mx) * nx + (road[1] - mz) * nz) / rd < 0.5) continue;
    const rotY = Math.atan2(nx, nz);
    const key = `${id}:${e}`;

    // signs, 4-6 m apart, alternating flush (0.1 m) and projecting (0.6 m)
    let s = 1.5 + hash(`${key}:sign0`) * 1.5, k = 0;
    while (s <= len - 1) {
      const depth = k % 2 === 0 ? 0.1 : 0.6;
      out.push({ type: 'sign', x: ax + tx * s + nx * depth, y: baseY, z: az + tz * s + nz * depth, rotY, scale: 1 });
      s += 4 + 2 * hash(`${key}:sign${k + 1}`); k++;
    }

    // awnings and shutters per shop-front unit
    const units = Math.ceil(len / 6), w = len / units;
    const hAwn = hash(`${key}:awning`), hShut = hash(`${key}:shutter`);
    // Awnings project 1.25 m at scale 1; on a narrow lane they shrink so opposite fronts do not meet.
    const awningMax = rd * 0.28;
    for (let u = 0; u < units; u++) {
      const c = (u + 0.5) * w;
      const x = ax + tx * c, z = az + tz * c;
      if (awningMax >= 0.6 && pick(hAwn, u, 0.6)) out.push({ type: 'awning', x: x + nx * 0.05, y: baseY, z: z + nz * 0.05, rotY, scale: Math.min(awningMax, 1.3, Math.max(0.7, w / 2.5)) });
      if (pick(hShut, u, 0.4)) out.push({ type: 'shutter', x, y: baseY, z, rotY, scale: Math.min(1.3, Math.max(0.7, w / 2.2)) });
    }
  }
  return out;
}

/** True where something stands already (a building footprint) so a prop must not go there. */
export type Blocked = (x: number, z: number) => boolean;
const never: Blocked = () => false;

export interface RoadInfo { id: string; pts: XZ[]; width: number; highway: string; unpaved: boolean; vehicle: boolean; commercial: boolean; core: boolean }

/** Perpendicular unit vector to the right of travel, same convention as alongPolyline. */
const rightOf = (s: Sample): XZ => [-s.dz, s.dx];

/**
 * Utility poles every 35 m on a vehicle road, on the road's preferred side (the other side when a building is in the way),
 * a transformer on every 6th pole, and a wire bundle between consecutive poles.
 * The wire prop is authored for a 35 m span with its origin at the attach height; its scale is chord / 35,
 * its y is the mean pole attach height and `pitch` follows the slope.
 */
export function utilityProps(road: RoadInfo, yAt: YAt, hash: Hash, blocked: Blocked = never): Prop[] {
  const out: Prop[] = [];
  if (!road.vehicle) return out;
  const pref = hash(`${road.id}:pole`) < 0.5 ? 1 : -1;
  const off = road.width / 2 + 0.6;
  const poles: { x: number; y: number; z: number }[] = [];
  for (const s of sampleAlong(road.pts, POWERPOLE_EVERY_M)) {
    const [rx, rz] = rightOf(s);
    for (const side of [pref, -pref]) {
      const x = s.x + rx * off * side, z = s.z + rz * off * side;
      if (blocked(x, z)) continue;
      const rotY = Math.atan2(s.dx, s.dz), y = yAt(x, z);
      out.push({ type: 'powerpole', x, y, z, rotY, scale: 1 });
      if (poles.length % 6 === 5) out.push({ type: 'transformer', x, y, z, rotY, scale: 1 });
      poles.push({ x, y, z });
      break;
    }
  }
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i]!, b = poles[i + 1]!;
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run < 4 || run > WIRE_MAX_M) continue;
    const chord = Math.hypot(run, b.y - a.y);
    out.push({
      type: 'wires', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + POLE_ATTACH_M, z: (a.z + b.z) / 2,
      rotY: Math.atan2(b.x - a.x, b.z - a.z), scale: chord / WIRE_SPAN_M, pitch: Math.atan2(b.y - a.y, run),
    });
  }
  return out;
}

/**
 * Street-level props along one road. Roads of a *-core zone get a banner every 40 m and a vendor cart every 60 m;
 * commercial roads get a cluster of 3-8 parked bikes every 25 m at the kerb. Residential roads get a rubbish pile every 80 m
 * and, where 6 m wide or more, a tree every 30 m. Unpaved roads get 2 puddles per 100 m.
 */
export function streetProps(road: RoadInfo, yAt: YAt, hash: Hash, blocked: Blocked = never): Prop[] {
  const out: Prop[] = [];
  const { id, pts, width } = road;
  const side = (key: string): number => (hash(`${id}:${key}`) < 0.5 ? 1 : -1);
  const at = (s: Sample, lateral: number): XZ => { const [rx, rz] = rightOf(s); return [s.x + rx * lateral, s.z + rz * lateral]; };

  if (road.vehicle && road.commercial) {
    sampleAlong(pts, 25).forEach((s, k) => {
      const n = 3 + Math.min(5, Math.floor(hash(`${id}:bikes:${k}`) * 6));
      const across = width >= 7;
      const lateral = side(`bside:${k}`) * (width / 2 - (across ? 1.0 : 0.5));
      const gap = across ? 0.7 : 2.1;
      const heading = Math.atan2(s.dx, s.dz);
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) / 2) * gap;
        const [x, z] = at({ ...s, x: s.x + s.dx * along, z: s.z + s.dz * along }, lateral);
        if (blocked(x, z)) continue;
        const jitter = (hash(`${id}:bikes:${k}:${i}`) - 0.5) * 0.3;
        out.push({ type: 'parked_bike', x, y: yAt(x, z), z, rotY: heading + (across ? Math.PI / 2 : 0) + jitter, scale: 1 });
      }
    });
  }
  if (road.vehicle && road.core && width >= 3) {
    for (const s of sampleAlong(pts, 40)) {
      out.push({ type: 'banner', x: s.x, y: yAt(s.x, s.z), z: s.z, rotY: Math.atan2(s.dx, s.dz), scale: Math.min(1.6, Math.max(0.8, width / 6)) });
    }
    sampleAlong(pts, 60).forEach((s, k) => {
      const [x, z] = at(s, side(`cart:${k}`) * (width / 2 - 0.9));
      if (!blocked(x, z)) out.push({ type: 'vendor_cart', x, y: yAt(x, z), z, rotY: Math.atan2(s.dx, s.dz), scale: 1 });
    });
  }
  if (road.highway === 'residential' || road.highway === 'living_street' || road.highway === 'unclassified') {
    sampleAlong(pts, 80).forEach((s, k) => {
      const [x, z] = at(s, side(`rub:${k}`) * (width / 2 + 0.4));
      if (!blocked(x, z)) out.push({ type: 'rubbish_pile', x, y: yAt(x, z), z, rotY: hash(`${id}:rubrot:${k}`) * 6.283, scale: 0.8 + hash(`${id}:rubsize:${k}`) * 0.5 });
    });
  }
  if (road.highway === 'residential' && width >= 6) {
    sampleAlong(pts, 30).forEach((s, k) => {
      const [x, z] = at(s, (k % 2 === 0 ? 1 : -1) * (width / 2 + 2.2));
      if (!blocked(x, z)) out.push({ type: 'tree', x, y: yAt(x, z), z, rotY: hash(`${id}:treerot:${k}`) * 6.283, scale: 0.8 + hash(`${id}:treesize:${k}`) * 0.6 });
    });
  }
  if (road.unpaved) {
    sampleAlong(pts, 50).forEach((s, k) => {
      const [x, z] = at(s, (hash(`${id}:pud:${k}`) - 0.5) * width * 0.6);
      out.push({ type: 'puddle', x, y: yAt(x, z), z, rotY: hash(`${id}:pudrot:${k}`) * 6.283, scale: 1 + hash(`${id}:pudsize:${k}`) });
    });
  }
  return out;
}
