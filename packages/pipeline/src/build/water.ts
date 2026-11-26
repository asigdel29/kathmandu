import earcut from 'earcut';
import { BASE_ELEVATION_M } from '@ktm/geo';
import { MeshBuilder, type V3 } from '../gltf/mesh.ts';
import type { XZ } from './props.ts';

export function waterMesh(polys: XZ[][][], heightAt: (x: number, z: number) => number, m: MeshBuilder): void {
  for (const rings of polys) {
    const outer = rings[0]; if (!outer || outer.length < 3) continue;
    let y = Infinity; for (const [x, z] of outer) y = Math.min(y, heightAt(x, z));
    y = y - BASE_ELEVATION_M - 0.5;
    const flat: number[] = []; const holes: number[] = [];
    rings.forEach((r, i) => { if (i > 0) holes.push(flat.length / 2); for (const [x, z] of r) flat.push(x, z); });
    const tris = earcut(flat, holes.length ? holes : undefined, 2);
    for (let t = 0; t < tris.length; t += 3) {
      const P = (k: number): V3 => [flat[tris[t + k]! * 2]!, y, flat[tris[t + k]! * 2 + 1]!];
      m.pushTriUp(P(0), P(1), P(2), 0);
    }
  }
}
