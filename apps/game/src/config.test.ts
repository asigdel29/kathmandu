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
it('parses vehicle params', () => {
  expect(readConfig('?vehicle=taxi&autodrive=1', '/world/')).toMatchObject({ vehicle: 'taxi', autodrive: true });
  expect(readConfig('?vehicle=motorbike', '/world/')).toMatchObject({ vehicle: 'motorbike', autodrive: false });
  expect(readConfig('', '/world/')).toMatchObject({ vehicle: undefined, autodrive: false });
  expect(readConfig('?vehicle=bus', '/world/')).toMatchObject({ vehicle: 'bus' });
  expect(readConfig('?vehicle=hovercraft&autodrive=yes', '/world/')).toMatchObject({ vehicle: undefined, autodrive: false });
});
it('enables traffic unless traffic=0', () => {
  expect(readConfig('', '/world/').traffic).toBe(true);
  expect(readConfig('?traffic=1', '/world/').traffic).toBe(true);
  expect(readConfig('?traffic=0', '/world/').traffic).toBe(false);
});
it('enables pedestrians unless peds=0', () => {
  expect(readConfig('', '/world/').peds).toBe(true);
  expect(readConfig('?peds=1', '/world/').peds).toBe(true);
  expect(readConfig('?peds=0', '/world/').peds).toBe(false);
});
it('parses post-processing params', () => {
  expect(readConfig('', '/world/')).toMatchObject({ quality: undefined, taa: true, wet: false });
  expect(readConfig('?quality=low', '/world/').quality).toBe('low');
  expect(readConfig('?quality=ultra', '/world/').quality).toBeUndefined();
  // scripted captures are pinned to high
  expect(readConfig('?freeze=1', '/world/').quality).toBe('high');
  expect(readConfig('?freeze=1&quality=med', '/world/').quality).toBe('med');
  expect(readConfig('?taa=0&wet=1', '/world/')).toMatchObject({ taa: false, wet: true });
});
it('parses the debug mission param and whether a tile was given', () => {
  expect(readConfig('?mission=thamel-to-patan&autodrive=1', '/world/')).toMatchObject({ mission: 'thamel-to-patan', autodrive: true, tileGiven: false });
  expect(readConfig('?tile=x15_y18', '/world/')).toMatchObject({ mission: undefined, tileGiven: true });
  expect(readConfig('?mission=', '/world/').mission).toBeUndefined();
});
