import { lonLatToLocal, tileId, tileIndexAt } from '@ktm/geo';

/** Authoritative tile id for a landmark anchor. */
export function heroTileAt(lat: number, lon: number): string {
  const p = lonLatToLocal(lon, lat);
  const { i, j } = tileIndexAt(p.x, p.z);
  return tileId(i, j);
}

export async function run(args: string[]): Promise<void> {
  const [lat, lon] = args.map(Number);
  if (args.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('usage: bun run pipeline hero-tile <lat> <lon>');
  console.log(heroTileAt(lat!, lon!));
}
