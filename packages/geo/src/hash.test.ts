import { expect, it } from 'vitest';
import { hash01 } from './hash.ts';
it('is deterministic, in [0,1), and spreads', () => {
  expect(hash01('a246912')).toBe(hash01('a246912'));
  for (const s of ['a', 'b', 'w1', 'w2', 'x14_y17']) { const h = hash01(s); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
  expect(hash01('a')).not.toBe(hash01('b'));
});
