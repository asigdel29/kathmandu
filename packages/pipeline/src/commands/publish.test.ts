import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { Manifest } from '@ktm/schema';
import { fixtureInputs } from '../../test/fixture-tile.ts';
import { buildTile } from '../build/tile.ts';
import { fetchInputs } from './fetch-inputs.ts';
import { buildManifest, requireBaseUrl } from './manifest.ts';
import { inputUploads, putCommand, tileUploads } from './upload.ts';

const BASE = 'http://localhost:5173/world/';
const SHA = 'a'.repeat(64);

async function builtFixture() {
  const inp = fixtureInputs();
  const res = await buildTile('x14_y17', { ...inp, outDir: `${inp.outRoot}/x14_y17`, quiet: true });
  return { ...inp, meta: res.meta };
}

it('writes a schema-valid manifest from built tiles and modelled heroes', async () => {
  const f = await builtFixture();
  mkdirSync(`${f.worldDir}/heroes/test-stupa`, { recursive: true });
  writeFileSync(`${f.worldDir}/heroes/test-stupa/hero.json`, JSON.stringify({
    slug: 'test-stupa', name: 'Test Stupa', tier: 'C', lat: 27.7043, lon: 85.307,
    footprint: [[85.3069, 27.7042], [85.3071, 27.7042], [85.3071, 27.7044]], model: { sha256: SHA, triangles: 100 },
  }));
  mkdirSync(`${f.worldDir}/heroes/unmodelled`, { recursive: true });
  writeFileSync(`${f.worldDir}/heroes/unmodelled/hero.json`, JSON.stringify({ slug: 'unmodelled', name: 'U', tier: 'C', lat: 27.7, lon: 85.3, footprint: [[85.3, 27.7], [85.31, 27.7], [85.31, 27.71]] }));
  const m = Manifest.parse(buildManifest({ tilesDir: f.outRoot, worldDir: f.worldDir, baseUrl: BASE }));
  expect(m.tiles).toEqual({ x14_y17: { hash: f.meta.inputsHash, kind: 'terrain', zone: f.meta.zone, buildings: 1 } });
  expect(Object.keys(m.heroes)).toEqual(['test-stupa']);
  expect(m.heroes['test-stupa']).toEqual({ tile: 'x14_y17', url: `${BASE}heroes/test-stupa/${SHA}/model.glb`, sha256: SHA });
});

it('merge keeps remote tiles that were not rebuilt and lets local builds win', async () => {
  const f = await builtFixture();
  const remote = buildManifest({ tilesDir: '/nonexistent', worldDir: '/nonexistent', baseUrl: BASE });
  remote.tiles.x01_y01 = { hash: SHA, kind: 'content', zone: 'suburb', buildings: 9 };
  remote.tiles.x14_y17 = { hash: SHA, kind: 'content', zone: 'suburb', buildings: 9 };
  const m = buildManifest({ tilesDir: f.outRoot, worldDir: f.worldDir, baseUrl: BASE, merge: remote });
  expect(Object.keys(m.tiles).sort()).toEqual(['x01_y01', 'x14_y17']);
  expect(m.tiles.x14_y17!.hash).toBe(f.meta.inputsHash);
});

it('requires a base url ending in a slash', () => {
  expect(() => requireBaseUrl(undefined)).toThrow(/WORLD_BASE_URL/);
  expect(() => requireBaseUrl('http://x/world')).toThrow(/end with/);
  expect(requireBaseUrl(BASE)).toBe(BASE);
});

it('plans hash-addressed immutable uploads with wrangler --remote', async () => {
  const f = await builtFixture();
  const items = tileUploads('x14_y17', f.outRoot);
  expect(items.map((i) => i.key.split('/').at(-1))).toEqual(['buildings.glb', 'height.f32', 'meta.json', 'nav.json', 'props.json', 'roads.glb', 'terrain.glb']);
  for (const i of items) expect(i.key.startsWith(`tiles/x14_y17/${f.meta.inputsHash}/`)).toBe(true);
  const glb = items.find((i) => i.key.endsWith('.glb'))!;
  expect(putCommand(glb)).toEqual(['wrangler', 'r2', 'object', 'put', `kathmandu-world/${glb.key}`, '--remote', '--file', glb.file, '--content-type', 'model/gltf-binary', '--cache-control', 'public, max-age=31536000, immutable']);
  const data = mkdtempSync(`${tmpdir()}/ktm-data-`);
  mkdirSync(`${data}/terrain`); writeFileSync(`${data}/terrain/x14_y17.f32`, new Uint8Array(4));
  expect(inputUploads('x14_y17', data).map((i) => i.key)).toEqual(['data/v1/terrain/x14_y17.f32']);
});

it('fetches published inputs and skips files already present', async () => {
  const served: string[] = [];
  const server = createServer((req, res) => {
    served.push(req.url!);
    if (req.url === '/world/data/v1/terrain/x14_y17.f32') { res.end(Buffer.from([1, 2, 3, 4])); return; }
    if (req.url === '/world/data/v1/features/x14_y17.geojsonl') { res.end('{"id":"w1"}\n'); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/world/`;
  try {
    const data = mkdtempSync(`${tmpdir()}/ktm-fetch-`);
    expect(await fetchInputs('x14_y17', base, data)).toEqual({ features: 'fetched', terrain: 'fetched' });
    expect(readFileSync(`${data}/features/x14_y17.geojsonl`, 'utf8')).toBe('{"id":"w1"}\n');
    expect(await fetchInputs('x14_y17', base, data)).toEqual({ features: 'present', terrain: 'present' });
    expect(served).toHaveLength(2);
    await expect(fetchInputs('x00_y00', base, data)).rejects.toThrow(/no heightmap/);
  } finally {
    server.close();
  }
});
