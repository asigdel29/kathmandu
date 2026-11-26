import { parseTileId } from '@ktm/geo';
import { buildTile } from '../build/tile.ts';

export async function run(args: string[]): Promise<void> {
  if (!args.length) throw new Error('usage: bun run pipeline build <tile> [<tile> ...]');
  for (const id of args) {
    parseTileId(id);
    await buildTile(id);
  }
}
