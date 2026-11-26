import { expect, it } from 'vitest';
import { heroTileAt } from './hero-tile.ts';

it('maps the verified landmark anchors to their tiles', () => {
  expect(heroTileAt(27.7043, 85.307)).toBe('x14_y17');
  expect(heroTileAt(27.7149, 85.2904)).toBe('x12_y18');
  expect(heroTileAt(27.7215, 85.362)).toBe('x21_y19');
});
