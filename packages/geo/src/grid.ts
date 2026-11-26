import { BBOX, TILE_SIZE_M } from './constants.ts';
import { lonLatToLocal } from './projection.ts';

const sw = lonLatToLocal(BBOX.west, BBOX.south);
const ne = lonLatToLocal(BBOX.east, BBOX.north);

/** Anchor = bbox SW corner (smallest x, largest z). Column i grows east, row j grows north. */
export const GRID = {
  xMin: sw.x,
  zMax: sw.z,
  cols: Math.ceil((ne.x - sw.x) / TILE_SIZE_M),
  rows: Math.ceil((sw.z - ne.z) / TILE_SIZE_M),
} as const;

export type TileId = `x${string}_y${string}`;
export interface TileIndex { i: number; j: number }
export interface TileBounds { minX: number; maxX: number; minZ: number; maxZ: number }

export function inGrid(i: number, j: number): boolean {
  return Number.isInteger(i) && Number.isInteger(j) && i >= 0 && i < GRID.cols && j >= 0 && j < GRID.rows;
}

export function tileId(i: number, j: number): TileId {
  if (!inGrid(i, j)) throw new RangeError(`tile index outside grid: ${i},${j}`);
  return `x${String(i).padStart(2, '0')}_y${String(j).padStart(2, '0')}`;
}

export function parseTileId(id: string): TileIndex {
  const m = /^x(\d{2})_y(\d{2})$/.exec(id);
  if (!m) throw new Error(`bad tile id: ${id}`);
  return { i: Number(m[1]), j: Number(m[2]) };
}

/** Cell containing a world point. Rows are half-open on the north side: z in (minZ, maxZ]. */
export function tileIndexAt(x: number, z: number): TileIndex {
  return { i: Math.floor((x - GRID.xMin) / TILE_SIZE_M), j: Math.floor((GRID.zMax - z) / TILE_SIZE_M) };
}

export function tileBounds(id: string): TileBounds {
  const { i, j } = parseTileId(id);
  const minX = GRID.xMin + i * TILE_SIZE_M;
  const maxZ = GRID.zMax - j * TILE_SIZE_M;
  return { minX, maxX: minX + TILE_SIZE_M, minZ: maxZ - TILE_SIZE_M, maxZ };
}

/** Corner with minimum x and minimum z. tile-local = world - origin, both axes in [0, 800). */
export function tileOrigin(id: string): { x: number; z: number } {
  const b = tileBounds(id);
  return { x: b.minX, z: b.minZ };
}

export function neighbors(id: string): TileId[] {
  const { i, j } = parseTileId(id);
  const out: TileId[] = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if ((di !== 0 || dj !== 0) && inGrid(i + di, j + dj)) out.push(tileId(i + di, j + dj));
  }
  return out;
}

export function allTileIds(): TileId[] {
  const ids: TileId[] = [];
  for (let j = 0; j < GRID.rows; j++) for (let i = 0; i < GRID.cols; i++) ids.push(tileId(i, j));
  return ids;
}
