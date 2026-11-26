import { BASE_ELEVATION_M, HEIGHTMAP_N } from '@ktm/geo';
import { MeshBuilder, type MeshData, type V3 } from '../gltf/mesh.ts';
import { STEP } from '../terrain/heightmap.ts';
import { pointInRing, type XZ } from './props.ts';

export interface GreenArea { ring: XZ[]; color: [number, number, number] }
export const LANDCOVER: Record<string, [number, number, number]> = {
  urban: [0.52, 0.48, 0.42], park: [0.30, 0.45, 0.22], forest: [0.16, 0.30, 0.14], farmland: [0.55, 0.47, 0.25], grass: [0.36, 0.50, 0.26], scrub: [0.33, 0.40, 0.22],
};

export function terrainMesh(hm: Float32Array, greens: GreenArea[]): MeshData {
  const m = new MeshBuilder();
  const colors: number[] = [];
  const H = (r: number, c: number) => hm[Math.min(Math.max(r, 0), HEIGHTMAP_N - 1) * HEIGHTMAP_N + Math.min(Math.max(c, 0), HEIGHTMAP_N - 1)]! - BASE_ELEVATION_M;
  for (let r = 0; r < HEIGHTMAP_N; r++) for (let c = 0; c < HEIGHTMAP_N; c++) {
    const x = c * STEP, z = r * STEP, y = H(r, c);
    const n: V3 = [(H(r, c - 1) - H(r, c + 1)) / (2 * STEP), 1, (H(r - 1, c) - H(r + 1, c)) / (2 * STEP)];
    const l = Math.hypot(...n); n[0] /= l; n[1] /= l; n[2] /= l;
    m.vertex([x, y, z], n, [x / 10, z / 10], 0);
    let col = LANDCOVER.urban!;
    for (const g of greens) if (pointInRing([x, z], g.ring)) { col = g.color; break; }
    colors.push(...col);
  }
  for (let r = 0; r + 1 < HEIGHTMAP_N; r++) for (let c = 0; c + 1 < HEIGHTMAP_N; c++) {
    const a = r * HEIGHTMAP_N + c, b = a + 1, d = a + HEIGHTMAP_N, e = d + 1;
    m.triUp(a, b, d); m.triUp(b, e, d);
  }
  const data = m.finish();
  return { ...data, colors: new Float32Array(colors) };
}
