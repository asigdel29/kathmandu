import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import styles from '../../../../world/style/building-styles.json';
import { FACADE_STYLES, FACADE_TEXTURE_FILES, facadeTextureUrl, STYLE_TILING_M, STYLE_TINT, TILE_ROOF_INDEX, FLAT_ROOF_INDEX } from './facadeTextures.ts';

const dir = fileURLToPath(new URL('../../public/textures/facades/', import.meta.url));

it('covers every building style in StyleId order', () => {
  expect([...FACADE_STYLES]).toEqual(styles.styles);
  expect(STYLE_TILING_M).toHaveLength(styles.styles.length);
  expect(STYLE_TINT).toHaveLength(styles.styles.length);
  expect(FACADE_STYLES[TILE_ROOF_INDEX]).toBe('tile_roof');
  expect(FACADE_STYLES[FLAT_ROOF_INDEX]).toBe('rcc_unfinished');
});

it('uses the contract tiling for brick, plaster, concrete and tin', () => {
  const m = (s: string) => STYLE_TILING_M[styles.styles.indexOf(s)];
  expect(m('newari_brick')).toBe(2.4);
  expect(m('temple_brick')).toBe(2.4);
  expect(m('rcc_plaster_white')).toBe(3);
  expect(m('rcc_plaster_pastel')).toBe(3);
  expect(m('rcc_unfinished')).toBe(2);
  expect(m('tin_shed')).toBe(1.2);
});

it('ships diffuse, normal and roughness jpgs per style within the byte budgets', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  expect(files).toEqual([...FACADE_TEXTURE_FILES].sort());
  let total = 0;
  for (const f of files) {
    const bytes = statSync(dir + f).size;
    expect(bytes, f).toBeLessThan(400 * 1024);
    total += bytes;
  }
  expect(total).toBeLessThan(6 * 1024 * 1024);
});

it('builds texture urls under the base path', () => {
  expect(facadeTextureUrl('/', 'tin_shed', 'diff')).toBe('/textures/facades/tin_shed_diff.jpg');
});
