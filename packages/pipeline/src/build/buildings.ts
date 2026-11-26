import earcut from 'earcut';
import styles from '../../../../world/style/building-styles.json';
import { MeshBuilder, shoelaceXZ, type V3 } from '../gltf/mesh.ts';

export type XZ = [number, number];
export interface BuildingInput { rings: XZ[][]; baseY: number; height: number; style: number }

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
      u += len;
    }
  }
  const flat: number[] = []; const holes: number[] = [];
  for (let i = 0; i < rings.length; i++) { if (i > 0) holes.push(flat.length / 2); for (const [x, z] of rings[i]!) flat.push(x, z); }
  const tris = earcut(flat, holes.length ? holes : undefined, 2);
  for (let t = 0; t < tris.length; t += 3) {
    const P = (k: number): V3 => [flat[tris[t + k]! * 2]!, top, flat[tris[t + k]! * 2 + 1]!];
    roofs.pushTriUp(P(0), P(1), P(2), b.style);
  }
}
