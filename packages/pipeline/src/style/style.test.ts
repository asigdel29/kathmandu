import { expect, it } from 'vitest';
import { pickStyle, styleIndex, zoneAt, defaultLevels } from './style.ts';
it('zones by circle, then hills, then suburb', () => {
  expect(zoneAt(85.307, 27.7043, 1300)).toBe('old-core');
  expect(zoneAt(85.3251, 27.6727, 1320)).toBe('patan-core');
  expect(zoneAt(85.45, 27.80, 1900)).toBe('hills');
  expect(zoneAt(85.33, 27.69, 1310)).toBe('suburb');
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
