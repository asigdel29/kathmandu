import { expect, it } from 'vitest';
import { laneCentre, rightPerp } from './lane.ts';

it('right-hand perpendicular of eastbound is +z (south)', () => {
  expect(rightPerp(1, 0)).toEqual({ x: 0, z: 1 });
  expect(rightPerp(0, 0)).toEqual({ x: 0, z: 0 });
  const r = rightPerp(3, 4);
  expect(Math.hypot(r.x, r.z)).toBeCloseTo(1, 12);
});

it('drives on the left: an eastbound lane centre is north of the centreline (smaller z)', () => {
  const c = laneCentre({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.5, 8);
  expect(c.x).toBeCloseTo(5, 12);
  expect(c.z).toBeCloseTo(-2, 12);
  expect(c.z).toBeLessThan(0);
});

it('westbound is south and northbound is west of the centreline', () => {
  expect(laneCentre({ x: 10, z: 0 }, { x: 0, z: 0 }, 0.5, 8).z).toBeCloseTo(2, 12);
  const n = laneCentre({ x: 0, z: 0 }, { x: 0, z: -10 }, 0.25, 8);
  expect(n.x).toBeCloseTo(-2, 12);
  expect(n.z).toBeCloseTo(-2.5, 12);
});

it('a zero-length edge gives the centre point without NaN', () => {
  expect(laneCentre({ x: 1, z: 2 }, { x: 1, z: 2 }, 0.5, 6)).toEqual({ x: 1, z: 2 });
});
