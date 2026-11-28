import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { HEIGHTMAP_N, localToLonLat, tileOrigin } from '@ktm/geo';
import { Nav, PropsFile, TileMeta } from '@ktm/schema';
import { fixtureInputs } from '../../test/fixture-tile.ts';
import { buildTile } from './tile.ts';

it('builds a fixture tile with valid meta, nav and props', async () => {
  const inp = fixtureInputs();
  const dir = `${inp.outRoot}/x14_y17`;
  const res = await buildTile('x14_y17', { ...inp, outDir: dir, quiet: true });
  const meta = TileMeta.parse(JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8')));
  expect(meta.counts.buildings).toBe(1);
  expect(meta.counts.roadSegments).toBe(1);
  expect(meta.triangles.terrain).toBe(64 * 64 * 2);
  expect(meta.baseY).toBe(50);
  const nav = Nav.parse(JSON.parse(readFileSync(`${dir}/nav.json`, 'utf8')));
  expect(nav.nodes).toHaveLength(2);
  expect(nav.edges).toHaveLength(1);
  const props = PropsFile.parse(JSON.parse(readFileSync(`${dir}/props.json`, 'utf8')));
  expect(props.props.filter((p) => p.type === 'streetlight')).toHaveLength(3);
  expect(readFileSync(`${dir}/height.f32`).byteLength).toBe(HEIGHTMAP_N * HEIGHTMAP_N * 4);
  expect(res.meta.inputsHash).toBe(meta.inputsHash);
});

it('gables the 20x15 fixture building in a core zone unless overridden flat', async () => {
  // Flat: 8 wall + 2 roof triangles. Pitched: 8 wall + 2 gable + 4 slope triangles, no roof props.
  const cases: [object, number][] = [
    [{ zone: 'old-core' }, 14],
    [{ zone: 'old-core', buildings: { w100: { roof: 'flat' } } }, 10],
    [{ zone: 'suburb' }, 10],
    [{ zone: 'suburb', buildings: { w100: { roof: 'pitched' } } }, 14],
  ];
  for (const [ov, tris] of cases) {
    const inp = fixtureInputs();
    mkdirSync(`${inp.worldDir}/tiles/x14_y17`, { recursive: true });
    writeFileSync(`${inp.worldDir}/tiles/x14_y17/overrides.json`, JSON.stringify(ov));
    const res = await buildTile('x14_y17', { ...inp, outDir: `${inp.outRoot}/x14_y17`, quiet: true });
    expect(res.meta.triangles.buildings).toBe(tris);
    if (tris === 14) {
      const props = PropsFile.parse(JSON.parse(readFileSync(`${res.dir}/props.json`, 'utf8')));
      expect(props.props.some((p) => p.type === 'water_tank' || p.type === 'rebar')).toBe(false);
    }
  }
});

it('hashes inputs deterministically', async () => {
  const inp = fixtureInputs();
  const a = await buildTile('x14_y17', { ...inp, outDir: `${inp.outRoot}/a`, quiet: true });
  const b = await buildTile('x14_y17', { ...inp, outDir: `${inp.outRoot}/b`, quiet: true });
  expect(a.meta.inputsHash).toBe(b.meta.inputsHash);
});

it('keeps the border flag when a road vertex lies within 1 cm of the tile edge', async () => {
  const inp = fixtureInputs();
  const dir = `${inp.outRoot}/x14_y17`;
  // A junction vertex at x = 799.999 and the seam crossing at x = 800 quantise to the same nav id.
  // One road runs west from the junction; the other is only the 1 mm stub up to the seam.
  const road = (id: string, coordinates: number[][], borderEnd: boolean) => ({ id, kind: 'road', geometry: { type: 'LineString', coordinates }, properties: { highway: 'residential', borderStart: false, borderEnd } });
  const roads = [road('w300', [[799.999, 400], [700, 400]], false), road('w301', [[799.999, 400], [800, 400]], true)];
  writeFileSync(`${inp.featuresDir}/x14_y17.geojsonl`, roads.map((r) => `${JSON.stringify(r)}\n`).join(''));
  await buildTile('x14_y17', { ...inp, outDir: dir, quiet: true });
  const nav = Nav.parse(JSON.parse(readFileSync(`${dir}/nav.json`, 'utf8')));
  expect(nav.nodes).toHaveLength(2);
  const border = nav.nodes.filter((n) => n.border);
  expect(border).toHaveLength(1);
  expect(border[0]!.x).toBeCloseTo(800, 2);
  expect(nav.edges).toHaveLength(1);
});

it('drops generated props inside a hero footprint and keeps curated ones', async () => {
  const id = 'x14_y17';
  const origin = tileOrigin(id);
  const box = { x0: 300, z0: 300, x1: 500, z1: 500 };
  const inBox = (p: { x: number; z: number }) => p.x >= box.x0 && p.x <= box.x1 && p.z >= box.z0 && p.z <= box.z1;
  const build = async (withHero: boolean) => {
    const inp = fixtureInputs();
    const forest = { id: 'g1', kind: 'green', geometry: { type: 'Polygon', coordinates: [[[0, 0], [790, 0], [790, 790], [0, 790], [0, 0]]] }, properties: { landuse: 'forest' } };
    writeFileSync(`${inp.featuresDir}/${id}.geojsonl`, `${JSON.stringify(forest)}\n`);
    mkdirSync(`${inp.worldDir}/tiles/${id}`, { recursive: true });
    const curated = { type: 'tree', x: 400, y: 1350, z: 400, rotY: 0, scale: 1 };
    writeFileSync(`${inp.worldDir}/tiles/${id}/props.extra.json`, JSON.stringify({ props: [curated] }));
    if (withHero) {
      const ring = [[box.x0, box.z0], [box.x1, box.z0], [box.x1, box.z1], [box.x0, box.z1], [box.x0, box.z0]]
        .map(([x, z]) => { const p = localToLonLat(origin.x + x!, origin.z + z!); return [p.lon, p.lat]; });
      mkdirSync(`${inp.worldDir}/heroes/fixture`, { recursive: true });
      writeFileSync(`${inp.worldDir}/heroes/fixture/hero.json`, JSON.stringify({ slug: 'fixture', name: 'Fixture', tier: 'A', lat: 27.7, lon: 85.3, footprint: ring }));
    }
    const res = await buildTile(id, { ...inp, outDir: `${inp.outRoot}/${id}`, quiet: true });
    return PropsFile.parse(JSON.parse(readFileSync(`${res.dir}/props.json`, 'utf8'))).props;
  };
  const without = await build(false);
  expect(without.filter((p) => p.type === 'tree' && inBox(p)).length).toBeGreaterThan(1);
  const withHero = await build(true);
  const inside = withHero.filter(inBox);
  expect(inside).toEqual([{ type: 'tree', x: 400, y: 1350, z: 400, rotY: 0, scale: 1 }]);
  expect(withHero.filter((p) => p.type === 'tree').length).toBeGreaterThan(1);
});

it('exports foot-class ways to nav.json as lanes 0, speed 5 edges with the ROAD_SPEC width', async () => {
  const inp = fixtureInputs();
  const dir = `${inp.outRoot}/x14_y17`;
  const way = (id: string, highway: string, coordinates: number[][]) => ({ id, kind: 'road', geometry: { type: 'LineString', coordinates }, properties: { highway, borderStart: false, borderEnd: false } });
  const ways = [
    way('w1', 'residential', [[100, 100], [200, 100]]),
    way('w2', 'footway', [[200, 100], [200, 160]]),
    way('w3', 'path', [[200, 160], [260, 160]]),
    way('w4', 'pedestrian', [[200, 100], [260, 100]]),
    way('w5', 'steps', [[260, 100], [260, 130]]),
    way('w6', 'track', [[260, 130], [300, 130]]),
  ];
  writeFileSync(`${inp.featuresDir}/x14_y17.geojsonl`, ways.map((r) => `${JSON.stringify(r)}\n`).join(''));
  await buildTile('x14_y17', { ...inp, outDir: dir, quiet: true });
  const nav = Nav.parse(JSON.parse(readFileSync(`${dir}/nav.json`, 'utf8')));
  const byCls = new Map(nav.edges.map((e) => [e.cls, e]));
  expect([...byCls.keys()].sort()).toEqual(['footway', 'path', 'pedestrian', 'residential', 'steps']);
  const widths: Record<string, number> = { footway: 2, path: 1.5, pedestrian: 4, steps: 1.5 };
  for (const [cls, w] of Object.entries(widths)) {
    const e = byCls.get(cls)!;
    expect(e).toMatchObject({ lanes: 0, speed: 5, width: w, oneway: false });
  }
  expect(byCls.get('residential')).toMatchObject({ lanes: 2, speed: 25, width: 6 });
  // Foot ways join the road at shared nodes; every edge endpoint exists and no node is orphaned.
  const ids = new Set(nav.nodes.map((n) => n.id));
  for (const e of nav.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
  expect(nav.nodes).toHaveLength(6);
});
