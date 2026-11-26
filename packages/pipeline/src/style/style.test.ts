import { expect, it } from 'vitest';
import { TILE_ROOF_STYLE } from '../build/buildings.ts';
import { pickStyle, styleIndex, zoneAt, defaultLevels } from './style.ts';
it('zones by circle, then hills, then suburb', () => {
  expect(zoneAt(85.307, 27.7043, 1300)).toBe('old-core');
  expect(zoneAt(85.3251, 27.6727, 1320)).toBe('patan-core');
  expect(zoneAt(85.45, 27.80, 1900)).toBe('hills');
  expect(zoneAt(85.33, 27.69, 1310)).toBe('suburb');
});
it('keeps tile_roof at style index 8 and never picks it for a facade', () => {
  expect(styleIndex('tile_roof')).toBe(8);
  expect(TILE_ROOF_STYLE).toBe(8);
  for (const zone of ['old-core', 'suburb', 'commercial', 'hills', 'industrial', 'airport'] as const)
    for (let h = 0; h < 1; h += 0.01) expect(pickStyle({ building: 'yes' }, zone, false, h)).not.toBe('tile_roof');
});
it('picks deterministic styles with tag precedence', () => {
  expect(pickStyle({ building: 'temple' }, 'suburb', false, 0.5)).toBe('temple_brick');
  expect(pickStyle({ amenity: 'school', building: 'yes' }, 'suburb', false, 0.5)).toBe('institutional');
  expect(pickStyle({ building: 'yes' }, 'old-core', false, 0.1)).toBe('newari_brick');
  expect(pickStyle({ building: 'yes' }, 'old-core', false, 0.9)).toBe('rcc_plaster_pastel');
  expect(pickStyle({ building: 'yes' }, 'suburb', true, 0.9)).toBe('rcc_unfinished'); // near a commercial road -> commercial mix
  expect(styleIndex('temple_brick')).toBe(6);
  expect(defaultLevels('old-core')).toBe(4);
});
