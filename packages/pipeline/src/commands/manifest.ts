import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { GRID, TILE_SIZE_M, lonLatToLocal, tileId, tileIndexAt } from '@ktm/geo';
import { Hero, Manifest, TileMeta } from '@ktm/schema';
import { PATHS } from '../paths.ts';

export interface ManifestOptions { tilesDir: string; worldDir: string; baseUrl: string; merge?: Manifest; now?: Date }

export function requireBaseUrl(v: string | undefined): string {
  if (!v) throw new Error('WORLD_BASE_URL is required, e.g. WORLD_BASE_URL=http://localhost:5173/world/');
  if (!v.endsWith('/')) throw new Error(`WORLD_BASE_URL must end with "/": ${v}`);
  return v;
}

function heroTile(h: Hero): string {
  if (h.tile) return h.tile;
  const p = lonLatToLocal(h.lon, h.lat);
  const { i, j } = tileIndexAt(p.x, p.z);
  return tileId(i, j);
}

/** Local tiles and heroes win; with `merge`, entries only present remotely are kept. */
export function buildManifest(o: ManifestOptions): Manifest {
  const tiles: Manifest['tiles'] = {};
  if (existsSync(o.tilesDir)) {
    for (const id of readdirSync(o.tilesDir).sort()) {
      const p = `${o.tilesDir}/${id}/meta.json`;
      if (!existsSync(p)) continue;
      const m = TileMeta.parse(JSON.parse(readFileSync(p, 'utf8')));
      tiles[m.id] = { hash: m.inputsHash, kind: m.kind, zone: m.zone, buildings: m.counts.buildings };
    }
  }
  const heroes: Manifest['heroes'] = {};
  const heroDir = `${o.worldDir}/heroes`;
  if (existsSync(heroDir)) {
    for (const slug of readdirSync(heroDir).sort()) {
      const p = `${heroDir}/${slug}/hero.json`;
      if (!existsSync(p)) continue;
      const h = Hero.parse(JSON.parse(readFileSync(p, 'utf8')));
      if (!h.model) continue;
      heroes[h.slug] = { tile: heroTile(h), url: `${o.baseUrl}heroes/${h.slug}/${h.model.sha256}/model.glb`, sha256: h.model.sha256, lat: h.lat, lon: h.lon, rotationDeg: h.rotationDeg, scale: h.scale };
    }
  }
  return Manifest.parse({
    version: 1,
    generatedAt: (o.now ?? new Date()).toISOString(),
    tileSize: TILE_SIZE_M,
    baseUrl: o.baseUrl,
    grid: { cols: GRID.cols, rows: GRID.rows, xMin: GRID.xMin, zMax: GRID.zMax },
    tiles: { ...(o.merge?.tiles ?? {}), ...tiles },
    heroes: { ...(o.merge?.heroes ?? {}), ...heroes },
  });
}

/** Remote (http/https) or local manifest to merge with. A missing remote manifest (404) means a first publish. */
export async function loadMergeSource(src: string): Promise<Manifest | undefined> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { cache: 'no-store' });
    if (res.status === 404) { console.log(`merge: ${src} not found, starting fresh`); return undefined; }
    if (!res.ok) throw new Error(`merge: HTTP ${res.status} for ${src}`);
    return Manifest.parse(await res.json());
  }
  if (!existsSync(src)) { console.log(`merge: ${src} not found, starting fresh`); return undefined; }
  return Manifest.parse(JSON.parse(readFileSync(src, 'utf8')));
}

export async function run(args: string[]): Promise<void> {
  const baseUrl = requireBaseUrl(process.env.WORLD_BASE_URL);
  const k = args.indexOf('--merge');
  let merge: Manifest | undefined;
  if (k >= 0) {
    const src = args[k + 1] ?? `${baseUrl}manifest.json`;
    merge = await loadMergeSource(src);
  }
  const manifest = buildManifest({ tilesDir: PATHS.tiles, worldDir: PATHS.world, baseUrl, merge });
  const out = `${PATHS.dist}/manifest.json`;
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`manifest: ${Object.keys(manifest.tiles).length} tiles, ${Object.keys(manifest.heroes).length} heroes`);
  console.log(`output: ${out}`);
}
