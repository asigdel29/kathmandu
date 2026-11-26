import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { BASE_ELEVATION_M, HEIGHTMAP_N, TILE_SIZE_M, tileOrigin, type TileId } from '@ktm/geo';
import type { LoadedTile } from '../world/TileLoader.ts';

export class Physics {
  static async create(): Promise<Physics> { await RAPIER.init(); return new Physics(new RAPIER.World({ x: 0, y: -9.81, z: 0 })); }
  private colliders = new Map<TileId, RAPIER.Collider[]>();
  private constructor(readonly world: RAPIER.World) {}

  step(dt: number): void { this.world.timestep = Math.min(dt, 1 / 30); this.world.step(); }

  addTile(tile: LoadedTile): void {
    const o = tileOrigin(tile.id);
    const list: RAPIER.Collider[] = [];
    // Heightfield: Rapier wants column-major heights and a scale covering the whole extent; it is centred on the collider translation.
    // Rapier matrix rows run along local z and columns along local x, so element (row r = z index, col c = x index) lives at c * N + r.
    // height.f32 is row-major with rows north->south (z increasing) and columns west->east (x increasing).
    const n = HEIGHTMAP_N - 1;
    const heights = new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N);
    for (let r = 0; r < HEIGHTMAP_N; r++) for (let c = 0; c < HEIGHTMAP_N; c++) heights[c * HEIGHTMAP_N + r] = tile.height[r * HEIGHTMAP_N + c]! - BASE_ELEVATION_M;
    const hf = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: TILE_SIZE_M, y: 1, z: TILE_SIZE_M }).setTranslation(o.x + TILE_SIZE_M / 2, 0, o.z + TILE_SIZE_M / 2);
    list.push(this.world.createCollider(hf));
    for (const mesh of tile.buildings ?? []) {
      mesh.updateMatrixWorld(true);
      const pos = mesh.geometry.getAttribute('position');
      const out = new Float32Array(pos.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
      const idx = mesh.geometry.index ? new Uint32Array(mesh.geometry.index.array) : new Uint32Array([...Array(pos.count).keys()]);
      list.push(this.world.createCollider(RAPIER.ColliderDesc.trimesh(out, idx)));
    }
    this.colliders.set(tile.id, list);
  }

  removeTile(id: TileId): void { for (const c of this.colliders.get(id) ?? []) this.world.removeCollider(c, false); this.colliders.delete(id); }

  /** World Y of the first surface straight below (x, fromY, z). New colliders join scene queries on the next step(). */
  castDown(x: number, z: number, fromY = 2000): number | undefined {
    const hit = this.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), fromY + 10000, true);
    return hit ? fromY - hit.timeOfImpact : undefined;
  }
}
