import { expect, it } from 'vitest';
import { MeshBuilder, shoelaceXZ } from './mesh.ts';
it('pushTriUp makes every triangle face +Y', () => {
  const m = new MeshBuilder();
  m.pushTriUp([0, 0, 0], [1, 0, 0], [0, 0, 1], 0);
  m.pushTriUp([0, 0, 1], [1, 0, 0], [0, 0, 0], 0);
  const d = m.finish();
  expect(d.indices).toHaveLength(6);
  for (let t = 0; t < 2; t++) {
    const [a, b, c] = [d.indices[t * 3]!, d.indices[t * 3 + 1]!, d.indices[t * 3 + 2]!];
    const P = (i: number): [number, number] => [d.positions[i * 3]!, d.positions[i * 3 + 2]!];
    expect(shoelaceXZ([P(a), P(b), P(c)])).toBeLessThan(0);
  }
});
