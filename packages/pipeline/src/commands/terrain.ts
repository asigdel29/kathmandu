import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { allTileIds } from '@ktm/geo';
import { PATHS } from '../paths.ts';
import { TerrariumSource } from '../terrain/terrarium.ts';
import { buildHeightmap } from '../terrain/heightmap.ts';

export async function run(args: string[]): Promise<void> {
  mkdirSync(PATHS.terrain, { recursive: true });
  const src = new TerrariumSource(`${PATHS.data}/raw/terrarium`);
  const ids = args.length ? args : allTileIds();
  let done = 0;
  for (const id of ids) {
    const file = `${PATHS.terrain}/${id}.f32`;
    if (existsSync(file) && !args.includes('--force')) { done++; continue; }
    const hm = await buildHeightmap(src, id);
    writeFileSync(file, new Uint8Array(hm.buffer));
    if (++done % 50 === 0) console.log(`heightmaps: ${done}/${ids.length}`);
  }
  console.log(`heightmaps: ${done}/${ids.length} -> ${PATHS.terrain}`);
}
