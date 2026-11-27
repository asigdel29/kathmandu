import { expect, it } from 'vitest';
import { readConfig } from './config.ts';
it('parses debug params', () => {
  const c = readConfig('?tile=x14_y17&t=06:15&view=iso&freeze=1', '/world/');
  expect(c).toMatchObject({ tile: 'x14_y17', timeOfDay: 6.25, view: 'iso', freeze: true, worldBase: '/world/' });
  expect(readConfig('', '/world/')).toMatchObject({ view: 'follow', timeOfDay: 16.5, freeze: false, tile: 'x14_y17' });
  expect(readConfig('?x=10&z=-20', '/world/').spawn).toEqual({ x: 10, z: -20 });
});
it('parses vehicle params', () => {
  expect(readConfig('?vehicle=taxi&autodrive=1', '/world/')).toMatchObject({ vehicle: 'taxi', autodrive: true });
  expect(readConfig('?vehicle=motorbike', '/world/')).toMatchObject({ vehicle: 'motorbike', autodrive: false });
  expect(readConfig('', '/world/')).toMatchObject({ vehicle: undefined, autodrive: false });
  expect(readConfig('?vehicle=bus&autodrive=yes', '/world/')).toMatchObject({ vehicle: undefined, autodrive: false });
});
it('enables traffic unless traffic=0', () => {
  expect(readConfig('', '/world/').traffic).toBe(true);
  expect(readConfig('?traffic=1', '/world/').traffic).toBe(true);
  expect(readConfig('?traffic=0', '/world/').traffic).toBe(false);
});
it('parses the debug mission param and whether a tile was given', () => {
  expect(readConfig('?mission=thamel-to-patan&autodrive=1', '/world/')).toMatchObject({ mission: 'thamel-to-patan', autodrive: true, tileGiven: false });
  expect(readConfig('?tile=x15_y18', '/world/')).toMatchObject({ mission: undefined, tileGiven: true });
  expect(readConfig('?mission=', '/world/').mission).toBeUndefined();
});
