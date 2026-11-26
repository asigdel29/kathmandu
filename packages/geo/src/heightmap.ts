import { HEIGHTMAP_N, TILE_SIZE_M } from './constants.ts';

export const HEIGHT_STEP = TILE_SIZE_M / (HEIGHTMAP_N - 1); // 12.5 m

/** Bilinear height (m a.s.l.) at tile-local (x, z); clamps to the tile. Rows north->south, columns west->east. */
export function heightAt(hm: Float32Array, x: number, z: number): number {
  const max = HEIGHTMAP_N - 1 - 1e-6;
  const fx = Math.min(Math.max(x / HEIGHT_STEP, 0), max), fz = Math.min(Math.max(z / HEIGHT_STEP, 0), max);
  const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r;
  const h = (rr: number, cc: number) => hm[rr * HEIGHTMAP_N + cc]!;
  return (h(r, c) * (1 - tx) + h(r, c + 1) * tx) * (1 - tz) + (h(r + 1, c) * (1 - tx) + h(r + 1, c + 1) * tx) * tz;
}
