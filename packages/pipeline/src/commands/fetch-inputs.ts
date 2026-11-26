import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { parseTileId } from '@ktm/geo';
import { PATHS } from '../paths.ts';
import { requireBaseUrl } from './manifest.ts';

export interface FetchResult { features: 'fetched' | 'present' | 'absent'; terrain: 'fetched' | 'present' }

async function download(url: string, dest: string): Promise<boolean> {
  const res = await fetch(url);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const tmp = `${dest}.part`;
  writeFileSync(tmp, new Uint8Array(await res.arrayBuffer()));
  renameSync(tmp, dest);
  return true;
}

/** Downloads one tile's pipeline inputs from `${baseUrl}data/v1/`. Terrain-only tiles have no features file. */
export async function fetchInputs(id: string, baseUrl: string, dataDir: string = PATHS.data): Promise<FetchResult> {
  parseTileId(id);
  const fDir = `${dataDir}/features`, tDir = `${dataDir}/terrain`;
  mkdirSync(fDir, { recursive: true }); mkdirSync(tDir, { recursive: true });
  const fPath = `${fDir}/${id}.geojsonl`, tPath = `${tDir}/${id}.f32`;
  const features = existsSync(fPath) ? 'present' : (await download(`${baseUrl}data/v1/features/${id}.geojsonl`, fPath)) ? 'fetched' : 'absent';
  let terrain: FetchResult['terrain'] = 'present';
  if (!existsSync(tPath)) {
    if (!(await download(`${baseUrl}data/v1/terrain/${id}.f32`, tPath))) throw new Error(`no heightmap published for ${id} at ${baseUrl}data/v1/terrain/${id}.f32`);
    terrain = 'fetched';
  }
  return { features, terrain };
}

export async function run(args: string[]): Promise<void> {
  if (!args.length) throw new Error('usage: bun run pipeline fetch-inputs <tile> [<tile> ...]');
  const baseUrl = requireBaseUrl(process.env.WORLD_BASE_URL);
  for (const id of args) {
    const r = await fetchInputs(id, baseUrl);
    console.log(`${id}: features ${r.features}, terrain ${r.terrain}`);
  }
}
