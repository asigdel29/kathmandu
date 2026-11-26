import * as THREE from 'three/webgpu';
import { heightAt, parseTileId, tileId, tileIndexAt, tileOrigin, type TileId } from '@ktm/geo';
import type { Physics } from '../physics/Physics.ts';
import type { PropsRenderer } from './PropsRenderer.ts';
import { desiredTiles } from './rings.ts';
import type { Lod, LoadedTile, TileLoader } from './TileLoader.ts';

const MAX_CONCURRENT = 4;

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  group.removeFromParent();
}

export class TileStreamer {
  private tiles = new Map<TileId, LoadedTile>();
  private pending?: Promise<void>;

  constructor(private scene: THREE.Scene, private physics: Physics, private props: PropsRenderer, private loader: TileLoader) {}

  /** Reconcile loaded tiles with desiredTiles(tileIndexAt(pos)). awaitCenter=true blocks until the lod-0 ring is in. */
  async update(pos: THREE.Vector3, awaitCenter = false): Promise<void> {
    if (this.pending) { if (awaitCenter) { await this.pending; return this.update(pos, true); } return; }
    const { center, all } = this.reconcile(pos);
    this.pending = all.finally(() => { this.pending = undefined; });
    return awaitCenter ? center : this.pending;
  }

  /** Starts one reconciliation; `center` settles when the lod-0 ring is in, `all` when every ring is. */
  private reconcile(pos: THREE.Vector3): { center: Promise<void>; all: Promise<void> } {
    const c = tileIndexAt(pos.x, pos.z);
    const want = desiredTiles(c);
    for (const [id, tile] of this.tiles) if (want.get(id) !== tile.lod) this.unload(id);

    const dist = (id: TileId) => { const t = parseTileId(id); return Math.max(Math.abs(t.i - c.i), Math.abs(t.j - c.j)); };
    const queue = [...want].filter(([id]) => !this.tiles.has(id)).sort((a, b) => dist(a[0]) - dist(b[0]));

    const run = async (items: [TileId, Lod][]) => {
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const [id, lod] = items[next++]!;
          try { const tile = await this.loader.load(id, lod); if (tile) this.add(tile); }
          catch (e) { console.warn(`tile ${id} lod ${lod}:`, e); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, items.length) }, worker));
    };
    const center = run(queue.filter(([, lod]) => lod === 0));
    const all = center.then(() => run(queue.filter(([, lod]) => lod !== 0)));
    return { center, all };
  }

  private add(tile: LoadedTile): void {
    this.tiles.set(tile.id, tile);
    this.scene.add(tile.group);
    if (tile.lod === 0) { this.physics.addTile(tile); this.props.addTile(tile); }
  }

  private unload(id: TileId): void {
    const tile = this.tiles.get(id);
    if (!tile) return;
    if (tile.lod === 0) { this.physics.removeTile(id); this.props.removeTile(id); }
    disposeGroup(tile.group);
    this.tiles.delete(id);
  }

  heightAt(worldX: number, worldZ: number): number | undefined {
    const c = tileIndexAt(worldX, worldZ);
    const tile = this.tiles.get(tileId(c.i, c.j));
    if (!tile) return undefined;
    const o = tileOrigin(tile.id);
    return heightAt(tile.height, worldX - o.x, worldZ - o.z);
  }

  loaded(): ReadonlyMap<TileId, LoadedTile> { return this.tiles; }
}
