import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { Hero } from '@ktm/schema';
import { heroUpload, putCommand, writeHeroModel } from './upload.ts';

const BYTES = Buffer.from('glTF fake model bytes');
const SHA = createHash('sha256').update(BYTES).digest('hex');

function fixture(heroJson: string, triangles = 39986) {
  const root = mkdtempSync(`${tmpdir()}/ktm-hero-`);
  const distDir = `${root}/dist`, worldDir = `${root}/world`;
  mkdirSync(`${distDir}/heroes/stupa`, { recursive: true });
  mkdirSync(`${worldDir}/heroes/stupa`, { recursive: true });
  writeFileSync(`${distDir}/heroes/stupa/model.glb`, BYTES);
  writeFileSync(`${distDir}/heroes/stupa/build.json`, JSON.stringify({ triangles, bytes: BYTES.length, sha256: SHA }));
  writeFileSync(`${worldDir}/heroes/stupa/hero.json`, heroJson);
  return { distDir, worldDir, heroPath: `${worldDir}/heroes/stupa/hero.json` };
}

const BASE = `{
  "slug": "stupa",
  "name": "Stupa",
  "tier": "C",
  "lat": 27.7,
  "lon": 85.3,
  "footprint": [
    [85.3, 27.7],
    [85.31, 27.7],
    [85.31, 27.71]
  ]
}
`;

it('plans one immutable, hash-addressed model upload', () => {
  const f = fixture(BASE);
  const { item, model } = heroUpload('stupa', { distDir: f.distDir });
  expect(item).toEqual({
    file: `${f.distDir}/heroes/stupa/model.glb`,
    key: `heroes/stupa/${SHA}/model.glb`,
    contentType: 'model/gltf-binary',
    cacheControl: 'public, max-age=31536000, immutable',
    skipIfExists: true,
  });
  expect(model).toEqual({ sha256: SHA, triangles: 39986 });
  expect(putCommand(item)).toContain(`kathmandu-world/heroes/stupa/${SHA}/model.glb`);
});

it('hashes the file itself, not the value recorded in build.json', () => {
  const f = fixture(BASE);
  writeFileSync(`${f.distDir}/heroes/stupa/model.glb`, 'changed after the build');
  expect(() => heroUpload('stupa', { distDir: f.distDir })).toThrow(/rebuild/);
});

it('rejects a missing build and a bad slug', () => {
  const f = fixture(BASE);
  expect(() => heroUpload('nope', { distDir: f.distDir })).toThrow(/bun run heroes build nope/);
  expect(() => heroUpload('../x', { distDir: f.distDir })).toThrow(/slug/);
});

it('appends model to hero.json and keeps the rest of the file byte for byte', () => {
  const f = fixture(BASE);
  writeHeroModel('stupa', { sha256: SHA, triangles: 39986 }, f.worldDir);
  const text = readFileSync(f.heroPath, 'utf8');
  expect(text).toBe(BASE.replace('\n  ]\n}\n', `\n  ],\n  "model": {\n    "sha256": "${SHA}",\n    "triangles": 39986\n  }\n}\n`));
  expect(Hero.parse(JSON.parse(text)).model).toEqual({ sha256: SHA, triangles: 39986 });
});

it('replaces an existing model in place and is idempotent', () => {
  const old = BASE.replace('"tier"', `"model": { "sha256": "${'0'.repeat(64)}", "triangles": 5 },\n  "tier"`);
  const f = fixture(old);
  writeHeroModel('stupa', { sha256: SHA, triangles: 7 }, f.worldDir);
  const once = readFileSync(f.heroPath, 'utf8');
  expect(JSON.parse(once).model).toEqual({ sha256: SHA, triangles: 7 });
  expect(Object.keys(JSON.parse(once))).toEqual(['slug', 'name', 'model', 'tier', 'lat', 'lon', 'footprint']);
  writeHeroModel('stupa', { sha256: SHA, triangles: 7 }, f.worldDir);
  expect(readFileSync(f.heroPath, 'utf8')).toBe(once);
});

it('refuses to write into a missing hero.json', () => {
  const f = fixture(BASE);
  expect(() => writeHeroModel('other', { sha256: SHA, triangles: 1 }, f.worldDir)).toThrow(/hero\.json/);
});
