import { expect, it } from 'vitest';
import { desiredTiles } from './rings.ts';
it('wants 3x3 at lod0, 7x7 at lod1, 11x11 at lod2, clipped to the grid', () => {
  const d = desiredTiles({ i: 14, j: 17 });
  const count = (lod: number) => [...d.values()].filter((l) => l === lod).length;
  expect(count(0)).toBe(9); expect(count(1)).toBe(49 - 9); expect(count(2)).toBe(121 - 49);
  expect(d.get('x14_y17')).toBe(0); expect(d.get('x16_y17')).toBe(1); expect(d.get('x19_y17')).toBe(2);
  expect([...desiredTiles({ i: 0, j: 0 }).keys()]).toHaveLength(36);
});
