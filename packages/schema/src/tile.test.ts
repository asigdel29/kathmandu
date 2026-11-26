import { describe, expect, it } from 'vitest';
import { Manifest, TileMeta } from './tile.ts';

const meta = {
  id: 'x14_y17', version: 1, kind: 'content', origin: { x: -6553.85, z: -1102.25 }, baseY: 0.0, zone: 'old-core',
  counts: { buildings: 1200, roadSegments: 340, props: 410, navNodes: 300 },
  triangles: { terrain: 8192, buildings: 150000, roads: 20000, water: 0 },
  bytes: { 'buildings.glb': 2_000_000 }, inputsHash: 'a'.repeat(64), builtAt: '2026-11-26T12:00:00Z',
};

describe('TileMeta', () => {
  it('accepts a valid meta', () => { expect(TileMeta.parse(meta).id).toBe('x14_y17'); });
  it('rejects a bad id and a short hash', () => {
    expect(() => TileMeta.parse({ ...meta, id: 'x14-y17' })).toThrow();
    expect(() => TileMeta.parse({ ...meta, inputsHash: 'abc' })).toThrow();
  });
});

describe('Manifest', () => {
  it('accepts a minimal manifest', () => {
    const m = Manifest.parse({
      version: 1, generatedAt: '2026-11-26T12:00:00Z', tileSize: 800, baseUrl: 'https://example.com/',
      grid: { cols: 45, rows: 34, xMin: -17753.85, zMax: 13297.75 },
      tiles: { x14_y17: { hash: 'a'.repeat(64), kind: 'content', zone: 'old-core', buildings: 1200 } }, heroes: {},
    });
    expect(Object.keys(m.tiles)).toEqual(['x14_y17']);
  });
});
