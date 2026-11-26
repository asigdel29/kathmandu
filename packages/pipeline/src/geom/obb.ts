import { shoelaceXZ } from '../gltf/mesh.ts';

export type XZ = [number, number];

export interface OBB {
  /** Centre of the rectangle. */
  center: XZ;
  /** Unit vector along the long side. */
  axis: XZ;
  /** Extent along `axis` (long side); length >= width. */
  length: number;
  /** Extent across `axis` (short side). */
  width: number;
  /** length * width. */
  area: number;
}

const EPS = 1e-12;

/** Drop a duplicated closing point (first == last) so the ring is open. */
function openRing(ring: XZ[]): XZ[] {
  if (ring.length > 1) {
    const a = ring[0]!, b = ring[ring.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

const cross = (o: XZ, a: XZ, b: XZ): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull (CCW, open ring, no duplicate closing point, collinear points dropped). Monotone chain. */
export function convexHull(points: XZ[]): XZ[] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const uniq: XZ[] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) uniq.push(p);
  }
  if (uniq.length < 3) return uniq.map((p) => [p[0], p[1]]);
  const lower: XZ[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XZ[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper).map((p) => [p[0], p[1]]);
}

/** Zero-area box along the longest extent of a point set whose hull has fewer than 3 vertices. */
function degenerateOBB(hull: XZ[]): OBB {
  const a = hull[0], b = hull[hull.length - 1];
  if (!a || !b) return { center: [0, 0], axis: [1, 0], length: 0, width: 0, area: 0 };
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const axis: XZ = len > 0 ? [dx / len, dz / len] : [1, 0];
  return { center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], axis, length: len, width: 0, area: 0 };
}

/**
 * Minimum-area enclosing rectangle via rotating calipers over hull edges: for each hull edge
 * direction, project the hull onto the edge direction and its perpendicular and keep the
 * smallest area (first minimum wins). Accepts closed or open rings. Degenerate input returns a
 * zero-width box along the longest extent.
 */
export function minAreaOBB(ring: XZ[]): OBB {
  const hull = convexHull(openRing(ring));
  if (hull.length < 3) return degenerateOBB(hull);

  let best: { u: XZ; minU: number; maxU: number; minV: number; maxV: number; area: number } | undefined;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i]!, q = hull[(i + 1) % hull.length]!;
    const ex = q[0] - p[0], ez = q[1] - p[1], el = Math.hypot(ex, ez);
    if (el < EPS) continue;
    const u: XZ = [ex / el, ez / el];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const h of hull) {
      const pu = h[0] * u[0] + h[1] * u[1];
      const pv = -h[0] * u[1] + h[1] * u[0];
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { u, minU, maxU, minV, maxV, area };
  }
  if (!best) return degenerateOBB(hull);

  const { u, minU, maxU, minV, maxV } = best;
  const v: XZ = [-u[1], u[0]];
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  const center: XZ = [cu * u[0] + cv * v[0], cu * u[1] + cv * v[1]];
  const du = maxU - minU, dv = maxV - minV;
  const [axis, length, width]: [XZ, number, number] = du >= dv ? [u, du, dv] : [v, dv, du];
  return { center, axis, length, width, area: length * width };
}

/** |polygon area| / OBB area, in [0,1]. Accepts closed or open rings. Returns 0 when the OBB area is ~0. */
export function fillRatio(ring: XZ[], obb?: OBB): number {
  const open = openRing(ring);
  const box = obb ?? minAreaOBB(open);
  if (box.area < EPS) return 0;
  const poly = Math.abs(shoelaceXZ(open)) / 2;
  return Math.min(1, Math.max(0, poly / box.area));
}
