import { expect, it } from 'vitest';
import { featureId, readFeatures } from './read.ts';
const FIX = new URL('../../test/fixtures/mini.geojsonl', import.meta.url).pathname;

it('streams every line as a feature and exposes the osmium id', async () => {
  const ids: string[] = [];
  for await (const f of readFeatures(FIX)) ids.push(featureId(f));
  expect(ids).toEqual(['a1', 'w2', 'n3']);
});
