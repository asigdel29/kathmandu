import { describe, expect, it } from 'vitest';
import { lonLatToLocal, tileOrigin } from '@ktm/geo';
import type { Manifest } from '@ktm/schema';
import { resolveLandmarks } from './MapScreen.ts';

const sha = 'a'.repeat(64);
const manifest = {
  version: 1, generatedAt: '2026-11-26T00:00:00.000Z', tileSize: 800, baseUrl: 'http://localhost/world/',
  grid: { cols: 45, rows: 34, xMin: 0, zMax: 0 }, tiles: {},
  heroes: { boudhanath: { tile: 'x21_y19', url: 'http://localhost/b.glb', sha256: sha }, 'not-in-catalog': { tile: 'x14_y17', url: 'http://localhost/n.glb', sha256: sha } },
} as Manifest;

describe('resolveLandmarks', () => {
  it('places manifest landmarks at their catalog lon/lat, else at the tile centre', () => {
    const out = resolveLandmarks(manifest, [{ slug: 'boudhanath', name: 'Boudhanath Stupa', lat: 27.7215, lon: 85.362 }, { slug: 'unlisted', name: 'Unlisted', lat: 27.7, lon: 85.3 }]);
    expect(out).toHaveLength(2);
    const b = lonLatToLocal(85.362, 27.7215);
    expect(out[0]).toEqual({ name: 'Boudhanath Stupa', x: b.x, z: b.z });
    const o = tileOrigin('x14_y17');
    expect(out[1]).toEqual({ name: 'not-in-catalog', x: o.x + 400, z: o.z + 400 });
  });
});
