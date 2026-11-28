/**
 * Pedestrian steering: follow a polyline, keep apart from other walkers, sidestep to the left when someone comes the
 * other way, and brake to a halt on request. Pure math in the world XZ plane (metres, X east, Z = -north).
 */

export interface XZ { x: number; z: number }

/** Polyline with cumulative arc length. */
export interface Path { pts: XZ[]; cum: number[]; length: number }

export interface Walker {
  x: number; z: number; vx: number; vz: number;
  /** Progress along its path, m. */
  s: number;
  /** Preferred walking speed, m/s. */
  speed: number;
}

export interface SteerParams {
  /** Distance ahead along the path that is sought, m. */
  lookahead: number;
  /** Walkers closer than this (centre to centre) push each other apart, m. */
  separation: number;
  /** Hard minimum centre distance: two 0.35 m radius bodies touching, m. */
  minGap: number;
  maxAccel: number;
  maxSpeed: number;
  /** Strength of the sidestep to one's own left when someone is coming the other way, m/s. */
  keepLeft: number;
}

export const STEER_DEFAULTS: SteerParams = { lookahead: 1.5, separation: 0.8, minGap: 0.7, maxAccel: 3, maxSpeed: 2.2, keepLeft: 0.4 };

/** Beyond this distance from the path a walker is pulled back towards it. */
const CENTRE_DEADBAND_M = 0.3;
const CENTRE_GAIN = 1.5;
/** How far ahead an oncoming walker triggers the keep-left sidestep, m. */
const ONCOMING_RANGE_M = 3;
/** Lateral offset below which an oncoming walker counts as being in the way, m. */
const ONCOMING_LANE_M = 0.9;
/** Speed eases down over this distance before the end of the path, m. */
const ARRIVE_M = 1;
/** project() with a hint searches segments overlapping hint +- this distance, m. */
const HINT_WINDOW_M = 10;

export function makePath(input: readonly XZ[]): Path {
  const pts: XZ[] = [];
  for (const p of input) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.z !== p.z) pts.push({ x: p.x, z: p.z });
  }
  const cum = pts.map(() => 0);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  return { pts, cum, length: cum[cum.length - 1] ?? 0 };
}

/** Index i of the segment pts[i] -> pts[i + 1] that contains arc length s (s already clamped). */
function segmentAt(path: Path, s: number): number {
  let lo = 0; let hi = path.pts.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (path.cum[mid]! <= s) lo = mid; else hi = mid - 1; }
  return Math.max(0, lo);
}

/** Point at arc length s (clamped to the path) and the unit tangent of its segment. */
export function pointAt(path: Path, s: number): { x: number; z: number; tx: number; tz: number } {
  const { pts, cum } = path;
  if (pts.length === 0) return { x: 0, z: 0, tx: 1, tz: 0 };
  if (pts.length === 1) return { x: pts[0]!.x, z: pts[0]!.z, tx: 1, tz: 0 };
  const c = Math.min(path.length, Math.max(0, s));
  const i = segmentAt(path, c);
  const a = pts[i]!; const b = pts[i + 1]!;
  const len = cum[i + 1]! - cum[i]!;
  const t = len > 0 ? (c - cum[i]!) / len : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
}

/** Closest point of the polyline to p: its arc length and distance. With a hint (a previous s) only nearby segments are searched. */
export function project(path: Path, p: XZ, hint?: number): { s: number; dist: number } {
  const { pts, cum } = path;
  if (pts.length === 0) return { s: 0, dist: Infinity };
  if (pts.length === 1) return { s: 0, dist: Math.hypot(p.x - pts[0]!.x, p.z - pts[0]!.z) };
  let first = 0; let last = pts.length - 2;
  if (hint !== undefined) {
    first = segmentAt(path, Math.min(path.length, Math.max(0, hint - HINT_WINDOW_M)));
    last = segmentAt(path, Math.min(path.length, Math.max(0, hint + HINT_WINDOW_M)));
  }
  let best = { s: 0, dist: Infinity };
  for (let i = first; i <= last; i++) {
    const a = pts[i]!; const b = pts[i + 1]!;
    const dx = b.x - a.x; const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    const d = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
    if (d < best.dist) best = { s: cum[i]! + t * (cum[i + 1]! - cum[i]!), dist: d };
  }
  return best;
}

/**
 * One steering step for walker a on path (walking towards increasing s). neighbours are other walkers or obstacles
 * (such as the player) to keep away from; stop brakes to a halt. Updates a.x, a.z, a.vx, a.vz and a.s in place.
 */
export function stepWalker(a: Walker, path: Path, neighbours: readonly XZ[], dt: number, stop = false, p: Partial<SteerParams> = {}): void {
  if (dt <= 0) return;
  const o = p === STEER_DEFAULTS ? STEER_DEFAULTS : { ...STEER_DEFAULTS, ...p };
  const proj = project(path, a, a.s);
  a.s = Math.max(a.s, proj.s);

  let dvx = 0; let dvz = 0;
  if (!stop) {
    const remaining = path.length - a.s;
    const speed = a.speed * Math.min(1, Math.max(0, remaining / ARRIVE_M));
    const target = pointAt(path, a.s + o.lookahead);
    let hx = target.x - a.x; let hz = target.z - a.z;
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-6) { hx /= hl; hz /= hl; } else { const t = pointAt(path, a.s); hx = t.tx; hz = t.tz; }
    dvx = hx * speed; dvz = hz * speed;
    // Back towards the path once drifted off it.
    if (proj.dist > CENTRE_DEADBAND_M) {
      const c = pointAt(path, proj.s);
      const k = (CENTRE_GAIN * (proj.dist - CENTRE_DEADBAND_M)) / proj.dist;
      dvx += (c.x - a.x) * k; dvz += (c.z - a.z) * k;
    }
    // Left of the heading: for east (1, 0) that is north, -z.
    const lx = hz; const lz = -hx;
    for (const n of neighbours) {
      const rx = a.x - n.x; const rz = a.z - n.z;
      const d = Math.hypot(rx, rz);
      if (d < o.separation && d > 1e-9) {
        const w = (a.speed * 1.5 * (o.separation - d)) / o.separation / d;
        dvx += rx * w; dvz += rz * w;
      }
      const ahead = -(rx * hx + rz * hz);
      const side = -(rx * lx + rz * lz);
      if (ahead > 0 && ahead < ONCOMING_RANGE_M && Math.abs(side) < ONCOMING_LANE_M) {
        const w = o.keepLeft * a.speed * (1 - ahead / ONCOMING_RANGE_M) * 2;
        dvx += lx * w; dvz += lz * w;
      }
    }
  }

  // Acceleration-limited velocity change, then the speed cap.
  let ax = (dvx - a.vx) / dt; let az = (dvz - a.vz) / dt;
  const al = Math.hypot(ax, az);
  if (al > o.maxAccel) { ax *= o.maxAccel / al; az *= o.maxAccel / al; }
  a.vx += ax * dt; a.vz += az * dt;
  const v = Math.hypot(a.vx, a.vz);
  if (v > o.maxSpeed) { a.vx *= o.maxSpeed / v; a.vz *= o.maxSpeed / v; }
  if (stop && Math.hypot(a.vx, a.vz) < o.maxAccel * dt * 0.5) { a.vx = 0; a.vz = 0; }

  let nx = a.x + a.vx * dt; let nz = a.z + a.vz * dt;
  // Never end the step inside the minimum gap of a neighbour.
  for (const n of neighbours) {
    const rx = nx - n.x; const rz = nz - n.z;
    const d = Math.hypot(rx, rz);
    if (d >= o.minGap) continue;
    let ux: number; let uz: number;
    if (d > 1e-9) { ux = rx / d; uz = rz / d; } else { const pl = Math.hypot(a.x - n.x, a.z - n.z); ux = pl > 1e-9 ? (a.x - n.x) / pl : 1; uz = pl > 1e-9 ? (a.z - n.z) / pl : 0; }
    nx = n.x + ux * o.minGap; nz = n.z + uz * o.minGap;
  }
  a.x = nx; a.z = nz;
  a.s = Math.max(a.s, project(path, a, a.s).s);
}

/**
 * Push pairs apart so no two centres are closer than minGap. Fixed items (the player) do not move; the other one takes
 * the whole correction. Mutates x and z.
 */
export function resolveOverlaps(ws: (XZ & { fixed?: boolean })[], minGap = STEER_DEFAULTS.minGap): void {
  for (let i = 0; i < ws.length; i++) {
    for (let j = i + 1; j < ws.length; j++) separatePair(ws[i]!, ws[j]!, minGap);
  }
}

/** Push two items to at least minGap apart (no-op if they are both fixed). */
export function separatePair(a: XZ & { fixed?: boolean }, b: XZ & { fixed?: boolean }, minGap = STEER_DEFAULTS.minGap): void {
  if (a.fixed && b.fixed) return;
  const dx = b.x - a.x; const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= minGap) return;
  const push = minGap - d;
  // Coincident items split along x.
  const ux = d > 1e-9 ? dx / d : 1; const uz = d > 1e-9 ? dz / d : 0;
  if (a.fixed) { b.x += ux * push; b.z += uz * push; return; }
  if (b.fixed) { a.x -= ux * push; a.z -= uz * push; return; }
  a.x -= (ux * push) / 2; a.z -= (uz * push) / 2;
  b.x += (ux * push) / 2; b.z += (uz * push) / 2;
}
