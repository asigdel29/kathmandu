import { expect, it } from 'vitest';
import { readConfig } from './config.ts';
it('parses debug params', () => {
  const c = readConfig('?tile=x14_y17&t=06:15&view=iso&freeze=1', '/world/');
  expect(c).toMatchObject({ tile: 'x14_y17', timeOfDay: 6.25, view: 'iso', freeze: true, worldBase: '/world/' });
  expect(readConfig('', '/world/')).toMatchObject({ view: 'follow', timeOfDay: 16.5, freeze: false, tile: 'x14_y17' });
  expect(readConfig('?x=10&z=-20', '/world/').spawn).toEqual({ x: 10, z: -20 });
});
it('parses hero slug', () => {
  expect(readConfig('?tile=x12_y18&hero=test', '/world/')).toMatchObject({ hero: 'test', tile: 'x12_y18' });
  expect(readConfig('', '/world/').hero).toBeUndefined();
  expect(readConfig('?hero=Bad Slug!', '/world/').hero).toBeUndefined();
});
