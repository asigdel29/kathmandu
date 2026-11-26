import { existsSync, readFileSync } from 'node:fs';
import { parseTileId } from '@ktm/geo';
import { Nav } from '@ktm/schema';
import { PATHS } from '../paths.ts';
import { validateTile } from '../validate/validate.ts';

/** Neighbour nav from dist/tiles when that neighbour has been built; seams are checked only against built tiles. */
function neighborNav(id: string): Nav | undefined {
  const p = `${PATHS.tiles}/${id}/nav.json`;
  if (!existsSync(p)) return undefined;
  const r = Nav.safeParse(JSON.parse(readFileSync(p, 'utf8')));
  return r.success ? r.data : undefined;
}

export async function run(args: string[]): Promise<void> {
  if (!args.length) throw new Error('usage: bun run pipeline validate <tile> [<tile> ...]');
  let failed = false;
  for (const id of args) {
    parseTileId(id);
    const res = await validateTile(`${PATHS.tiles}/${id}`, { neighborNav });
    for (const w of res.warnings) console.log(`WARN ${id} ${w}`);
    if (res.ok) console.log(`OK ${id}`);
    else { failed = true; for (const e of res.errors) console.log(`ERR ${id} ${e}`); }
  }
  if (failed) process.exit(1);
}
