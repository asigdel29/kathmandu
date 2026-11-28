import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PropsFile } from '@ktm/schema';
import { fixtureInputs } from '../../test/fixture-tile.ts';
import { buildTile } from './tile.ts';

const road = (id: string, coordinates: number[][], properties: object) => ({ id, kind: 'road', geometry: { type: 'LineString', coordinates }, properties: { borderStart: false, borderEnd: false, ...properties } });
const building = (id: string, x: number, z: number) => ({ id, kind: 'building', geometry: { type: 'Polygon', coordinates: [[[x, z], [x + 10, z], [x + 10, z + 8], [x, z + 8], [x, z]]] }, properties: { building: 'yes', 'building:levels': '3' } });

async function buildStreet(): Promise<{ props: PropsFile['props']; json: string }> {
  const inp = fixtureInputs();
  // A 100 m primary road with a row of ten shops on its north side (5 m from the centreline) and a dirt lane.
  const features = [
    road('r1', [[300, 400], [400, 400]], { highway: 'primary' }),
    ...Array.from({ length: 10 }, (_, i) => building(`s${i}`, 300 + i * 10, 405)),
    road('r2', [[300, 100], [400, 100]], { highway: 'residential', surface: 'dirt' }),
  ];
  writeFileSync(`${inp.featuresDir}/x14_y17.geojsonl`, features.map((f) => `${JSON.stringify(f)}\n`).join(''));
  const res = await buildTile('x14_y17', { ...inp, outDir: `${inp.outRoot}/x14_y17`, quiet: true });
  const json = readFileSync(`${res.dir}/props.json`, 'utf8');
  return { props: PropsFile.parse(JSON.parse(json)).props, json };
}

it('builds shop fronts, poles, wires, bikes and puddles onto a street and stays deterministic', async () => {
  const { props, json } = await buildStreet();
  const n = (t: string) => props.filter((p) => p.type === t).length;
  expect(n('sign')).toBeGreaterThan(10);
  expect(n('awning')).toBeGreaterThan(4);
  expect(n('shutter')).toBeGreaterThan(2);
  expect(n('powerpole')).toBeGreaterThanOrEqual(5); // 3 on the primary road, 3 on the dirt lane, one may be moved or skipped
  expect(n('wires')).toBeGreaterThanOrEqual(2);
  expect(n('parked_bike')).toBeGreaterThanOrEqual(3);
  expect(n('puddle')).toBe(2);
  expect(n('rubbish_pile')).toBeGreaterThanOrEqual(1);
  // the building has 3 levels and a flat roof: shop signs are on its south wall only, facing the road at z = 400
  expect(props.filter((p) => p.type === 'sign').every((p) => p.z < 405 && p.z > 404)).toBe(true);
  expect(props.length).toBeLessThan(6_000);
  expect((await buildStreet()).json).toBe(json);
});
