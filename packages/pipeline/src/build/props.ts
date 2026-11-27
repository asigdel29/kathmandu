import Flatbush from 'flatbush';
import type { Prop } from '@ktm/schema';
export type XZ = [number, number];

/** Points every `every` meters along a polyline, offset perpendicular (positive = right of travel when seen from +Y, i.e. +z for eastbound). */
export function alongPolyline(pts: XZ[], every: number, offset: number, yAt: (x: number, z: number) => number, type: Prop['type'] = 'streetlight'): Prop[] {
  const out: Prop[] = [];
  let carry = every / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az); if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = -dz, nz = dx; // right-hand perpendicular in XZ: for dx=1,dz=0 -> (0, 1) = +z
    for (let d = carry; d <= len; d += every) {
      const x = ax + dx * d + nx * offset, z = az + dz * d + nz * offset;
      out.push({ type, x, y: yAt(x, z), z, rotY: Math.atan2(dx, dz), scale: 1 });
    }
    carry = ((carry - len) % every + every) % every;
  }
  return out;
}

export function pointInRing([px, pz]: XZ, ring: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Roof clutter: water tank on 60 % of RCC roofs (h >= 0.4), rebar stubs on unfinished roofs (up to 4 corners). */
export function roofProps(ring: XZ[], roofY: number, style: string, h: number): Prop[] {
  const out: Prop[] = [];
  const n = ring.length; let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x / n; cz += z / n; }
  if (style.startsWith('rcc') && h >= 0.4) {
    const v = ring[Math.floor(h * n) % n]!;
    const x = cx + (v[0] - cx) * 0.4, z = cz + (v[1] - cz) * 0.4;
    if (pointInRing([x, z], ring)) out.push({ type: 'water_tank', x, y: roofY, z, rotY: h * 6.283, scale: 1 });
  }
  if (style === 'rcc_unfinished') {
    for (let k = 0; k < Math.min(4, n); k++) { const v = ring[Math.floor((k / 4) * n)]!; out.push({ type: 'rebar', x: cx + (v[0] - cx) * 0.85, y: roofY, z: cz + (v[1] - cz) * 0.85, rotY: 0, scale: 1 }); }
  }
  return out;
}

/** Trees in a green ring on a 12 m jittered grid, thinned by hash. */
export function treesInRing(ring: XZ[], yAt: (x: number, z: number) => number, hash: (s: string) => number, seed: string, density = 0.5): Prop[] {
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

/** Height of the span wires above the ground at a pole (insulator tips on the upper crossarm; tools/props/powerpole.py). */
export const WIRE_HEIGHT_M = 7.8;
/** Length of tools/props/wires.glb along +Z; a span's `scale` is its length divided by this. */
export const WIRE_SPAN_M = 40;
const MAX_WIRE_SPAN_M = 70;

/**
 * Wire bundles between consecutive poles of one road. The `wires` prop sits at the first pole's
 * insulator height, `rotY` is the heading toward the next pole, `pitch` the slope (radians, up is positive)
 * and `scale` the 3-D span over the 40 m the model is built for. Gaps wider than 70 m (a pole is missing) are not bridged.
 */
export function powerSpans(poles: Prop[]): Prop[] {
  const out: Prop[] = [];
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i]!, b = poles[i + 1]!;
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y, h = Math.hypot(dx, dz);
    if (h < 1 || h > MAX_WIRE_SPAN_M) continue;
    out.push({ type: 'wires', x: a.x, y: a.y + WIRE_HEIGHT_M, z: a.z, rotY: Math.atan2(dx, dz), pitch: Math.atan2(dy, h), scale: Math.hypot(h, dy) / WIRE_SPAN_M });
  }
  return out;
}

/** Building footprint edges, searchable by box. */
export interface FacadeIndex { near(x: number, z: number, r: number): { ring: number; ax: number; az: number; bx: number; bz: number }[]; rings: XZ[][] }

export function facadeIndex(rings: XZ[][]): FacadeIndex {
  const edges: { ring: number; ax: number; az: number; bx: number; bz: number }[] = [];
  rings.forEach((r, ring) => {
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i]!, [bx, bz] = r[(i + 1) % r.length]!;
      if (Math.hypot(bx - ax, bz - az) > 1e-6) edges.push({ ring, ax, az, bx, bz });
    }
  });
  const index = new Flatbush(Math.max(edges.length, 1));
  for (const e of edges) index.add(Math.min(e.ax, e.bx), Math.min(e.az, e.bz), Math.max(e.ax, e.bx), Math.max(e.az, e.bz));
  if (!edges.length) index.add(0, 0, 0, 0);
  index.finish();
  return { rings, near: (x, z, r) => (edges.length ? index.search(x - r, z - r, x + r, z + r).map((k) => edges[k]!) : []) };
}

const SHUTTER_REACH_M = 14;
const SHUTTER_MIN_EDGE_M = 3.5;
const SHUTTER_END_MARGIN_M = 1.4;
const SHUTTER_GAP_M = 3;

/**
 * Rolling shutters on ground floors along a commercial road: every `every` metres, on each side, the nearest
 * building edge that runs along the road gets one shutter, turned (rotY = heading of its outward normal) to face the road.
 */
export function shutterProps(facades: FacadeIndex, road: XZ[], halfWidth: number, yAt: (x: number, z: number) => number, every = 6): Prop[] {
  const out: Prop[] = [];
  for (const s of alongPolyline(road, every, 0, yAt)) {
    const dx = Math.sin(s.rotY), dz = Math.cos(s.rotY);
    for (const side of [1, -1]) {
      const nx = -dz * side, nz = dx * side; // unit vector from the road toward this side
      let best: { x: number; z: number; ox: number; oz: number; d: number } | undefined;
      for (const e of facades.near(s.x, s.z, halfWidth + SHUTTER_REACH_M)) {
        const ex = e.bx - e.ax, ez = e.bz - e.az, len = Math.hypot(ex, ez);
        if (len < SHUTTER_MIN_EDGE_M || Math.abs((ex * dx + ez * dz) / len) < 0.8) continue; // short or end-on to the road
        const t = ((s.x - e.ax) * ex + (s.z - e.az) * ez) / (len * len);
        const lo = SHUTTER_END_MARGIN_M / len;
        const u = Math.min(Math.max(t, lo), 1 - lo);
        const fx = e.ax + ex * u, fz = e.az + ez * u;
        const vx = fx - s.x, vz = fz - s.z, d = Math.hypot(vx, vz);
        if (d < halfWidth || (vx * nx + vz * nz) <= 0 || (best && d >= best.d)) continue;
        // outward normal of the edge, toward the road
        let ox = -ez / len, oz = ex / len;
        if (ox * (s.x - fx) + oz * (s.z - fz) < 0) { ox = -ox; oz = -oz; }
        if (!pointInRing([fx - ox * 0.2, fz - oz * 0.2], facades.rings[e.ring]!)) continue; // the edge faces the road, not the building's own yard
        best = { x: fx, z: fz, ox, oz, d };
      }
      if (!best) continue;
      const x = best.x + best.ox * 0.03, z = best.z + best.oz * 0.03;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < SHUTTER_GAP_M)) continue;
      out.push({ type: 'shutter', x, y: yAt(x, z), z, rotY: Math.atan2(best.ox, best.oz), scale: 1 });
    }
  }
  return out;
}
