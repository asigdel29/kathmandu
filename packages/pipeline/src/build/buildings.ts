import earcut from 'earcut';
import styles from '../../../../world/style/building-styles.json';
import { fillRatio, minAreaOBB, type OBB } from '../geom/obb.ts';
import { MeshBuilder, shoelaceXZ, type V3 } from '../gltf/mesh.ts';

export type XZ = [number, number];
export type RoofKind = 'flat' | 'pitched';
export interface BuildingInput {
  rings: XZ[][]; baseY: number; height: number; style: number;
  /** Defaults to 'flat'. */
  roof?: RoofKind;
  /** Style index for pitched roof slopes; defaults to TILE_ROOF_STYLE. */
  roofStyle?: number;
}

/** Ridge rise = ROOF_PITCH * OBB short side. */
export const ROOF_PITCH = 0.35;
export const PITCHED_MAX_VERTICES = 6;
export const PITCHED_MIN_FILL = 0.8;
/** `_STYLE` of pitched roof slopes: index of `tile_roof` in world/style/building-styles.json (8). */
export const TILE_ROOF_STYLE = styles.styles.indexOf('tile_roof');

/**
 * Override wins ('flat' forces flat, 'pitched' forces pitched). Otherwise pitched iff the zone ends
 * with '-core' AND the open outer ring has <= PITCHED_MAX_VERTICES vertices AND its fill of the
 * minimum-area OBB exceeds PITCHED_MIN_FILL. Accepts closed or open rings.
 */
export function roofKind(zone: string, outer: XZ[], override?: RoofKind): RoofKind {
  if (override) return override;
  if (!zone.endsWith('-core')) return 'flat';
  const open = openRing(outer);
  if (open.length < 3 || open.length > PITCHED_MAX_VERTICES) return 'flat';
  return fillRatio(open) > PITCHED_MIN_FILL ? 'pitched' : 'flat';
}

function openRing(ring: XZ[]): XZ[] {
  return ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring.slice();
}

/** Gable geometry: ridge along the OBB long axis through its centre, eaves on the long sides. */
interface Gable { center: XZ; axis: XZ; n: XZ; half: number; rise: number; top: number }

function gable(obb: OBB, top: number): Gable {
  return { center: obb.center, axis: obb.axis, n: [-obb.axis[1], obb.axis[0]], half: obb.width / 2, rise: ROOF_PITCH * obb.width, top };
}
/** Signed distance from the ridge line. */
const ridgeD = (g: Gable, p: XZ): number => (p[0] - g.center[0]) * g.n[0] + (p[1] - g.center[1]) * g.n[1];
const roofH = (g: Gable, p: XZ): number => g.top + g.rise * (1 - Math.min(Math.abs(ridgeD(g, p)), g.half) / g.half);
/** Point where segment p->q crosses the ridge line, as a fraction along the segment, when d(p) and d(q) have strictly opposite signs. */
function crossing(dp: number, dq: number): number | undefined {
  return (dp > 0 && dq < 0) || (dp < 0 && dq > 0) ? dp / (dp - dq) : undefined;
}
const lerp = (p: XZ, q: XZ, t: number): XZ => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Sutherland-Hodgman clip of a polygon to the half-plane s * d >= 0. */
function clipHalf(g: Gable, ring: XZ[], s: number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    const dp = s * ridgeD(g, p), dq = s * ridgeD(g, q);
    if (dp >= 0) out.push(p);
    const t = crossing(dp, dq);
    if (t !== undefined) out.push(lerp(p, q, t));
  }
  return out;
}

/** One planar roof slope per side of the ridge, sloping down and away from it. */
function emitSlopes(g: Gable, outer: XZ[], roofs: MeshBuilder, style: number): void {
  if (g.half < 1e-9) return;
  const k = g.rise / g.half, slope = Math.hypot(1, k);
  for (const s of [1, -1]) {
    const half = clipHalf(g, outer, s);
    if (half.length < 3 || Math.abs(shoelaceXZ(half)) < 1e-9) continue;
    const nl = Math.hypot(k, 1);
    const n: V3 = [(s * k * g.n[0]) / nl, 1 / nl, (s * k * g.n[1]) / nl];
    const ids = half.map((p) => {
      const along = (p[0] - g.center[0]) * g.axis[0] + (p[1] - g.center[1]) * g.axis[1];
      const fromEave = (g.half - Math.min(Math.abs(ridgeD(g, p)), g.half)) * slope;
      return roofs.vertex([p[0], roofH(g, p), p[1]], n, [along, fromEave], style);
    });
    const tris = earcut(half.flat(), undefined, 2);
    for (let t = 0; t < tris.length; t += 3) roofs.triUp(ids[tris[t]!]!, ids[tris[t + 1]!]!, ids[tris[t + 2]!]!);
  }
}

/** Wall extension between the eave line and the roof above edge p->q; wound like the wall quads below it. */
function emitGableWall(g: Gable, p: XZ, q: XZ, n: V3, u: number, len: number, baseY: number, walls: MeshBuilder, style: number): void {
  const pts: { p: XZ; y: number; u: number }[] = [{ p, y: g.top, u }];
  const hp = roofH(g, p), hq = roofH(g, q);
  if (hp - g.top > 1e-6) pts.push({ p, y: hp, u });
  const t = crossing(ridgeD(g, p), ridgeD(g, q));
  if (t !== undefined) { const r = lerp(p, q, t); pts.push({ p: r, y: roofH(g, r), u: u + t * len }); }
  if (hq - g.top > 1e-6) pts.push({ p: q, y: hq, u: u + len });
  pts.push({ p: q, y: g.top, u: u + len });
  if (pts.length < 3) return;
  const ids = pts.map((v) => walls.vertex([v.p[0], v.y, v.p[1]], n, [v.u, v.y - baseY], style));
  for (let i = 1; i + 1 < ids.length; i++) walls.tri(ids[0]!, ids[i]!, ids[i + 1]!);
}

export function buildingHeight(tags: Record<string, string | boolean>, ov: { levels?: number; height?: number } | undefined, zoneLevels: number): number {
  if (ov?.height) return ov.height;
  const h = parseFloat(String(tags.height ?? ''));
  if (ov?.levels === undefined && Number.isFinite(h) && h > 0) return h;
  const levels = ov?.levels ?? (parseInt(String(tags['building:levels'] ?? ''), 10) || zoneLevels);
  return levels * styles.levelHeightM + styles.parapetM;
}

function orient(ring: XZ[], positive: boolean): XZ[] {
  const open = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring.slice();
  const a = shoelaceXZ(open);
  return (a > 0) === positive ? open : open.reverse();
}

/** Outer ring oriented to positive XZ shoelace; holes negative, so the same wall formula faces courtyards. */
export function extrudeBuilding(b: BuildingInput, walls: MeshBuilder, roofs: MeshBuilder): void {
  const rings = b.rings.map((r, i) => orient(r, i === 0)).filter((r) => r.length >= 3);
  if (!rings.length) return;
  const top = b.baseY + b.height;
  const g = b.roof === 'pitched' ? gable(minAreaOBB(rings[0]!), top) : undefined;
  for (const ring of rings) {
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
      const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const n: V3 = [dz / len, 0, -dx / len];
      const b0 = walls.vertex([p[0], b.baseY, p[1]], n, [u, 0], b.style);
      const t0 = walls.vertex([p[0], top, p[1]], n, [u, b.height], b.style);
      const t1 = walls.vertex([q[0], top, q[1]], n, [u + len, b.height], b.style);
      const b1 = walls.vertex([q[0], b.baseY, q[1]], n, [u + len, 0], b.style);
      walls.tri(b0, t0, t1); walls.tri(b0, t1, b1);
      if (g && ring === rings[0]) emitGableWall(g, p, q, n, u, len, b.baseY, walls, b.style);
      u += len;
    }
  }
  if (g) { emitSlopes(g, rings[0]!, roofs, b.roofStyle ?? TILE_ROOF_STYLE); return; }
  const flat: number[] = []; const holes: number[] = [];
  for (let i = 0; i < rings.length; i++) { if (i > 0) holes.push(flat.length / 2); for (const [x, z] of rings[i]!) flat.push(x, z); }
  const tris = earcut(flat, holes.length ? holes : undefined, 2);
  for (let t = 0; t < tris.length; t += 3) {
    const P = (k: number): V3 => [flat[tris[t + k]! * 2]!, top, flat[tris[t + k]! * 2 + 1]!];
    roofs.pushTriUp(P(0), P(1), P(2), b.style);
  }
}
