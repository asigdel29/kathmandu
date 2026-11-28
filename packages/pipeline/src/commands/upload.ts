import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseTileId } from '@ktm/geo';
import { TileMeta } from '@ktm/schema';
import { PATHS } from '../paths.ts';

export const BUCKET = 'kathmandu-world';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MIME: Record<string, string> = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.f32': 'application/octet-stream', '.geojsonl': 'application/octet-stream' };

export interface UploadItem { file: string; key: string; contentType: string; cacheControl: string; skipIfExists: boolean }

const mime = (f: string): string => MIME[f.slice(f.lastIndexOf('.'))] ?? 'application/octet-stream';

/** Every artifact of a built tile, keyed by its inputs hash so published objects never change. */
export function tileUploads(id: string, tilesDir: string = PATHS.tiles): UploadItem[] {
  parseTileId(id);
  const dir = `${tilesDir}/${id}`;
  if (!existsSync(`${dir}/meta.json`)) throw new Error(`no build for ${id}; run: bun run pipeline build ${id}`);
  const meta = TileMeta.parse(JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8')));
  return readdirSync(dir).sort().map((f) => ({ file: `${dir}/${f}`, key: `tiles/${id}/${meta.inputsHash}/${f}`, contentType: mime(f), cacheControl: IMMUTABLE, skipIfExists: true }));
}

export function manifestUpload(distDir: string = PATHS.dist): UploadItem {
  const file = `${distDir}/manifest.json`;
  if (!existsSync(file)) throw new Error('no dist/manifest.json; run: bun run pipeline manifest');
  return { file, key: 'manifest.json', contentType: 'application/json', cacheControl: 'no-cache', skipIfExists: false };
}

/** Pipeline inputs for one tile, so CI and workers can build without the 1 GB OSM extract. */
export function inputUploads(id: string, dataDir: string = PATHS.data): UploadItem[] {
  parseTileId(id);
  const out: UploadItem[] = [];
  const features = `${dataDir}/features/${id}.geojsonl`;
  if (existsSync(features)) out.push({ file: features, key: `data/v1/features/${id}.geojsonl`, contentType: mime(features), cacheControl: IMMUTABLE, skipIfExists: true });
  const terrain = `${dataDir}/terrain/${id}.f32`;
  if (!existsSync(terrain)) throw new Error(`no heightmap for ${id}; run: bun run pipeline terrain ${id}`);
  out.push({ file: terrain, key: `data/v1/terrain/${id}.f32`, contentType: mime(terrain), cacheControl: IMMUTABLE, skipIfExists: true });
  return out;
}

const HERO_SLUG = /^[a-z0-9-]+$/;
export interface HeroModel { sha256: string; triangles: number }

/** A built hero model, keyed by the sha256 of the GLB so published objects never change. */
export function heroUpload(slug: string, dirs: { distDir?: string } = {}): { item: UploadItem; model: HeroModel } {
  if (!HERO_SLUG.test(slug)) throw new Error(`invalid hero slug "${slug}"`);
  const dir = `${dirs.distDir ?? PATHS.dist}/heroes/${slug}`;
  if (!existsSync(`${dir}/model.glb`) || !existsSync(`${dir}/build.json`)) throw new Error(`no build for ${slug}; run: bun run heroes build ${slug}`);
  const build = JSON.parse(readFileSync(`${dir}/build.json`, 'utf8')) as { sha256?: string; triangles?: number };
  const sha256 = createHash('sha256').update(readFileSync(`${dir}/model.glb`)).digest('hex');
  if (build.sha256 !== sha256 || !Number.isInteger(build.triangles)) throw new Error(`dist/heroes/${slug}/build.json does not match model.glb; rebuild: bun run heroes build ${slug}`);
  return {
    item: { file: `${dir}/model.glb`, key: `heroes/${slug}/${sha256}/model.glb`, contentType: 'model/gltf-binary', cacheControl: IMMUTABLE, skipIfExists: true },
    model: { sha256, triangles: build.triangles! },
  };
}

/** Records the published model in hero.json, touching nothing else in the file. */
export function writeHeroModel(slug: string, model: HeroModel, worldDir: string = PATHS.world): void {
  const path = `${worldDir}/heroes/${slug}/hero.json`;
  if (!existsSync(path)) throw new Error(`no world/heroes/${slug}/hero.json`);
  const text = readFileSync(path, 'utf8');
  JSON.parse(text);
  const block = `{\n    "sha256": "${model.sha256}",\n    "triangles": ${model.triangles}\n  }`;
  const existing = /("model"\s*:\s*)\{[^{}]*\}/;
  const next = existing.test(text)
    ? text.replace(existing, (_m, key: string) => key + block)
    : text.replace(/\s*\}(\s*)$/, (_m, tail: string) => `,\n  "model": ${block}\n}${tail}`);
  JSON.parse(next);
  writeFileSync(path, next);
}

/** wrangler 4 defaults to local (miniflare) storage; --remote targets the real bucket. */
export function putCommand(it: UploadItem, wrangler: string[] = ['wrangler']): string[] {
  return [...wrangler, 'r2', 'object', 'put', `${BUCKET}/${it.key}`, '--remote', '--file', it.file, '--content-type', it.contentType, '--cache-control', it.cacheControl];
}

function wranglerCmd(): string[] { return (process.env.WRANGLER ?? 'wrangler').split(' ').filter(Boolean); }

function exists(key: string): boolean {
  const p = Bun.spawnSync([...wranglerCmd(), 'r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--pipe'], { stdout: 'ignore', stderr: 'ignore' });
  return p.exitCode === 0;
}

function upload(items: UploadItem[]): void {
  let put = 0, skipped = 0;
  for (const it of items) {
    if (it.skipIfExists && exists(it.key)) { skipped++; console.log(`skip ${it.key}`); continue; }
    const p = Bun.spawnSync(putCommand(it, wranglerCmd()), { stdout: 'ignore', stderr: 'inherit' });
    if (p.exitCode !== 0) throw new Error(`upload failed: ${it.key}`);
    put++; console.log(`put ${it.key}`);
  }
  console.log(`upload: ${put} put, ${skipped} already present`);
}

export async function run(args: string[]): Promise<void> {
  const a = args[0];
  if (a === '--manifest') return upload([manifestUpload()]);
  if (a === '--inputs') {
    const ids = args.slice(1);
    if (!ids.length) throw new Error('usage: bun run pipeline upload --inputs <tile> [<tile> ...]');
    return upload(ids.flatMap((id) => inputUploads(id)));
  }
  if (a === '--hero') {
    const slug = args[1];
    if (!slug || args.length !== 2) throw new Error('usage: bun run pipeline upload --hero <slug>');
    const { item, model } = heroUpload(slug);
    upload([item]);
    writeHeroModel(slug, model);
    console.log(`${slug}: model ${model.sha256}, ${model.triangles} triangles recorded in hero.json`);
    return;
  }
  if (!a || a.startsWith('--')) throw new Error('usage: bun run pipeline upload <tile> [<tile> ...] | --manifest | --inputs <tile> | --hero <slug>');
  return upload(args.flatMap((id) => tileUploads(id)));
}
