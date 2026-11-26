import { expect, it } from 'vitest';
import { classify, isPoi, keepTags } from './classify.ts';
const f = (geometry: string, properties: Record<string, string>) => ({ type: 'Feature', geometry: { type: geometry, coordinates: [] }, properties }) as never;

it('classifies the layers we build', () => {
  expect(classify(f('Polygon', { building: 'yes' }))).toBe('building');
  expect(classify(f('Polygon', { building: 'no' }))).toBe('skip');
  expect(classify(f('LineString', { highway: 'residential' }))).toBe('road');
  expect(classify(f('LineString', { highway: 'proposed' }))).toBe('skip');
  expect(classify(f('Polygon', { natural: 'water' }))).toBe('water');
  expect(classify(f('Polygon', { leisure: 'park' }))).toBe('green');
  expect(classify(f('Polygon', { landuse: 'industrial' }))).toBe('landuse');
  expect(classify(f('Point', { place: 'suburb', name: 'Thamel' }))).toBe('place');
  expect(classify(f('Point', { amenity: 'place_of_worship', name: 'Shrine' }))).toBe('poi');
  expect(classify(f('Point', { amenity: 'bench' }))).toBe('skip');
});
it('flags POI tags on buildings and whitelists tags', () => {
  expect(isPoi({ building: 'temple', amenity: 'place_of_worship' })).toBe(true);
  expect(isPoi({ building: 'house' })).toBe(false);
  expect(keepTags({ building: 'yes', 'building:levels': '3', 'source': 'survey', name: 'X' })).toEqual({ building: 'yes', 'building:levels': '3', name: 'X' });
});
