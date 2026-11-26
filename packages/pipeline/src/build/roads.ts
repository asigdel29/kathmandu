import { MeshBuilder, type V3 } from '../gltf/mesh.ts';
export type XZ = [number, number];
export interface RoadSpec { width: number; lanes: number; speed: number; material: 'asphalt' | 'unpaved' | 'path'; vehicle: boolean; lights: boolean }

const R = (width: number, lanes: number, speed: number, lights = false): RoadSpec => ({ width, lanes, speed, material: 'asphalt', vehicle: true, lights });
const P = (width: number): RoadSpec => ({ width, lanes: 0, speed: 5, material: 'path', vehicle: false, lights: false });
export const ROAD_SPEC: Record<string, RoadSpec> = {
  motorway: R(14, 4, 60, true), trunk: R(14, 4, 60, true), primary: R(12, 4, 50, true), secondary: R(10, 2, 40, true), tertiary: R(8, 2, 35, true),
  motorway_link: R(7, 1, 40), trunk_link: R(7, 1, 40), primary_link: R(7, 1, 40), secondary_link: R(6, 1, 30), tertiary_link: R(6, 1, 30),
  unclassified: R(5.5, 1, 25), residential: R(6, 2, 25), living_street: R(4, 1, 10), service: R(4.5, 1, 15),
  footway: P(2), path: P(1.5), pedestrian: P(4), track: P(2.5), steps: P(1.5),
};
export function roadSpec(cls: string, surface?: string): RoadSpec {
  const s = ROAD_SPEC[cls] ?? ROAD_SPEC.unclassified!;
  const unpaved = surface && /unpaved|dirt|gravel|ground|earth|compacted|fine_gravel|mud|sand/.test(surface);
  return unpaved && s.material === 'asphalt' ? { ...s, material: 'unpaved' } : s;
}

export const navNodeId = (wx: number, wz: number): string => `n_${Math.round(wx * 100)}_${Math.round(wz * 100)}`;

/** Flat ribbon along pts (tile-local), lifted above terrain. u = meters along, v in {0,1}. */
export function ribbon(pts: XZ[], width: number, yAt: (x: number, z: number) => number, m: MeshBuilder, lift: number, style = 0): void {
  if (pts.length < 2) return;
  const half = width / 2;
  const L: number[] = [], Rr: number[] = [];
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const a = pts[Math.max(i - 1, 0)]!, b = pts[Math.min(i + 1, pts.length - 1)]!;
    let dx = b[0] - a[0], dz = b[1] - a[1]; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    if (i > 0) u += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]);
    const y = yAt(p[0], p[1]) + lift;
    const n: V3 = [0, 1, 0];
    L.push(m.vertex([p[0] - dz * half, y, p[1] + dx * half], n, [u, 0], style));
    Rr.push(m.vertex([p[0] + dz * half, y, p[1] - dx * half], n, [u, 1], style));
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    m.triUp(L[i]!, Rr[i]!, Rr[i + 1]!); m.triUp(L[i]!, Rr[i + 1]!, L[i + 1]!);
  }
}
