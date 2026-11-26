import type { XZ } from './split.ts';

/** Resample a polyline so consecutive points are at most `maxStep` metres apart. */
export function resamplePolyline(pts: XZ[], maxStep = 5): XZ[] {
  if (!(maxStep > 0)) throw new Error(`resamplePolyline: maxStep must be > 0, got ${maxStep}`);
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  const out: XZ[] = [[pts[0]![0], pts[0]![1]]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len > maxStep) {
      const n = Math.ceil(len / maxStep) - 1;
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    }
    out.push([bx, bz]);
  }
  return out;
}
