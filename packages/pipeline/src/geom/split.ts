import { GRID, TILE_SIZE_M, inGrid, tileId, type TileId } from '@ktm/geo';

export type XZ = [number, number];
export interface Piece { tile: TileId; pts: XZ[]; borderStart: boolean; borderEnd: boolean }

function cellOf(x: number, z: number): { i: number; j: number } {
  return { i: Math.floor((x - GRID.xMin) / TILE_SIZE_M), j: Math.floor((GRID.zMax - z) / TILE_SIZE_M) };
}

/**
 * Split a world-space polyline into per-tile pieces. The crossing point is computed once and
 * pushed into both pieces, so neighbouring tiles get bit-identical border coordinates.
 */
export function splitPolylineByGrid(pts: XZ[]): Piece[] {
  const pieces: Piece[] = [];
  if (pts.length < 2) return pieces;
  let cell = cellOf(pts[0]![0], pts[0]![1]);
  let cur: XZ[] = [pts[0]!];
  let borderStart = false;
  const flush = (borderEnd: boolean) => {
    if (cur.length >= 2 && inGrid(cell.i, cell.j)) pieces.push({ tile: tileId(cell.i, cell.j), pts: cur, borderStart, borderEnd });
  };
  for (let k = 1; k < pts.length; k++) {
    let [px, pz] = cur[cur.length - 1]!;
    const [qx, qz] = pts[k]!;
    const target = cellOf(qx, qz);
    let guard = 0;
    while ((cell.i !== target.i || cell.j !== target.j) && guard++ < 10_000) {
      const dx = qx - px, dz = qz - pz;
      let tx = Infinity, ni = cell.i;
      if (dx > 0) { ni = cell.i + 1; tx = (GRID.xMin + ni * TILE_SIZE_M - px) / dx; }
      else if (dx < 0) { ni = cell.i - 1; tx = (GRID.xMin + cell.i * TILE_SIZE_M - px) / dx; }
      let tz = Infinity, nj = cell.j;
      if (dz > 0) { nj = cell.j - 1; tz = (GRID.zMax - cell.j * TILE_SIZE_M - pz) / dz; }       // moving south -> row below
      else if (dz < 0) { nj = cell.j + 1; tz = (GRID.zMax - (cell.j + 1) * TILE_SIZE_M - pz) / dz; } // moving north -> row above
      const t = Math.min(tx, tz);
      if (!(t >= 0 && t <= 1)) break;
      const r: XZ = [px + dx * t, pz + dz * t];
      cur.push(r);
      flush(true);
      cell = { i: tx <= tz ? ni : cell.i, j: tz <= tx ? nj : cell.j };
      cur = [r];
      borderStart = true;
      px = r[0]; pz = r[1];
    }
    cur.push([qx, qz]);
  }
  flush(false);
  return pieces;
}
