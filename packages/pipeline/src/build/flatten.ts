import { HEIGHTMAP_N, HEIGHT_STEP } from '@ktm/geo';
import type { XZ } from './props.ts';

/** heights[i] = road surface height (m a.s.l.) at pts[i]; tile-local xz. */
export interface RoadLine { pts: XZ[]; heights: number[]; width: number }

const N = HEIGHTMAP_N, M = N - 1;

/** Height of the rendered terrain surface (m a.s.l.) at tile-local (x, z): piecewise-planar on the mesh triangles (a,b,d)/(b,e,d), NOT bilinear. Clamps x,z to [0, 800]. */
export function meshHeightAt(hm: Float32Array, x: number, z: number): number {
  const fx = Math.min(Math.max(x / HEIGHT_STEP, 0), M), fz = Math.min(Math.max(z / HEIGHT_STEP, 0), M);
  const c = Math.min(Math.floor(fx), M - 1), r = Math.min(Math.floor(fz), M - 1), tx = fx - c, tz = fz - r;
  const a = r * N + c, A = hm[a]!, B = hm[a + 1]!, D = hm[a + N]!, E = hm[a + N + 1]!;
  return tx + tz <= 1 ? A + (B - A) * tx + (D - A) * tz : E + (D - E) * (1 - tx) + (B - E) * (1 - tz);
}

/** Returns a NEW heightmap (input untouched): every NON-border sample within width/2 + 1 m (inclusive) of any road centreline segment is set to (road height at the nearest centreline point) - lift. Border samples are never moved, so neighbouring tiles keep identical edges. */
export function flattenUnderRoads(hm: Float32Array, roads: RoadLine[], lift: number): Float32Array {
  const out = hm.slice();
  const best = new Float64Array(N * N).fill(Infinity), target = new Float64Array(N * N);
  for (const road of roads) {
    const { pts, heights } = road, reach = road.width / 2 + 1;
    if (pts.length < 1) continue;
    for (let i = 0; i < Math.max(pts.length - 1, 1); i++) {
      const [x0, z0] = pts[i]!, [x1, z1] = pts[Math.min(i + 1, pts.length - 1)]!;
      const h0 = heights[i]!, h1 = heights[Math.min(i + 1, pts.length - 1)]!;
      const dx = x1 - x0, dz = z1 - z0, len2 = dx * dx + dz * dz;
      const c0 = Math.max(1, Math.ceil((Math.min(x0, x1) - reach) / HEIGHT_STEP)), c1 = Math.min(M - 1, Math.floor((Math.max(x0, x1) + reach) / HEIGHT_STEP));
      const r0 = Math.max(1, Math.ceil((Math.min(z0, z1) - reach) / HEIGHT_STEP)), r1 = Math.min(M - 1, Math.floor((Math.max(z0, z1) + reach) / HEIGHT_STEP));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const px = c * HEIGHT_STEP - x0, pz = r * HEIGHT_STEP - z0;
        const t = len2 > 0 ? Math.min(Math.max((px * dx + pz * dz) / len2, 0), 1) : 0;
        const d = Math.hypot(px - dx * t, pz - dz * t), k = r * N + c;
        if (d <= reach && d < best[k]!) { best[k] = d; target[k] = h0 + (h1 - h0) * t; }
      }
    }
  }
  for (let k = 0; k < N * N; k++) if (best[k]! < Infinity) out[k] = target[k]! - lift;
  return out;
}
