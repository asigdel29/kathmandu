import { inGrid, tileId, type TileId, type TileIndex } from '@ktm/geo';
import type { Lod } from './TileLoader.ts';
export const RADIUS: Record<Lod, number> = { 0: 1, 1: 3, 2: 5 };
export function desiredTiles(c: TileIndex): Map<TileId, Lod> {
  const out = new Map<TileId, Lod>();
  for (let dj = -RADIUS[2]; dj <= RADIUS[2]; dj++) for (let di = -RADIUS[2]; di <= RADIUS[2]; di++) {
    if (!inGrid(c.i + di, c.j + dj)) continue;
    const d = Math.max(Math.abs(di), Math.abs(dj));
    out.set(tileId(c.i + di, c.j + dj), d <= RADIUS[0] ? 0 : d <= RADIUS[1] ? 1 : 2);
  }
  return out;
}
