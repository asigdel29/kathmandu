import { inGrid, lonLatToLocal, localToLonLat, parseTileId, tileId, tileIndexAt, tileOrigin, type TileId } from '@ktm/geo';

export type LatLonInput = { lat: number; lon: number } | { tile: TileId; lx: number; lz: number };
export interface LatLonResult { x: number; z: number; tile: TileId; lx: number; lz: number; lat: number; lon: number }

const USAGE = 'usage: latlon <lat> <lon> | latlon --tile <id> <localX> <localZ>';

/** World x,z, tile id and tile-local x,z for a WGS84 point, or for a tile-local point. */
export function convert(input: LatLonInput): LatLonResult {
  let x: number; let z: number;
  if ('tile' in input) {
    const o = tileOrigin(input.tile);
    x = o.x + input.lx; z = o.z + input.lz;
  } else {
    ({ x, z } = lonLatToLocal(input.lon, input.lat));
  }
  const { i, j } = tileIndexAt(x, z);
  if (!inGrid(i, j)) throw new RangeError(`point outside the tile grid: ${x.toFixed(1)},${z.toFixed(1)}`);
  const tile = tileId(i, j);
  const o = tileOrigin(tile);
  const { lon, lat } = localToLonLat(x, z);
  return { x, z, tile, lx: x - o.x, lz: z - o.z, lat, lon };
}

export function parseArgs(args: string[]): LatLonInput | undefined {
  const nums = (xs: string[]) => (xs.every((s) => s.trim() !== '' && Number.isFinite(Number(s))) ? xs.map(Number) : undefined);
  if (args[0] === '--tile') {
    if (args.length !== 4) return undefined;
    try { parseTileId(args[1]!); } catch { return undefined; }
    const n = nums(args.slice(2));
    return n ? { tile: args[1] as TileId, lx: n[0]!, lz: n[1]! } : undefined;
  }
  if (args.length !== 2) return undefined;
  const n = nums(args);
  return n ? { lat: n[0]!, lon: n[1]! } : undefined;
}

export function format(r: LatLonResult): string {
  return `x=${r.x.toFixed(1)} z=${r.z.toFixed(1)} tile=${r.tile} local=${r.lx.toFixed(1)},${r.lz.toFixed(1)} lat=${r.lat.toFixed(6)} lon=${r.lon.toFixed(6)}`;
}

export async function run(args: string[]): Promise<void> {
  const input = parseArgs(args);
  if (!input) { console.error(USAGE); process.exit(2); }
  try {
    console.log(format(convert(input)));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
