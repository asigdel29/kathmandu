import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import Flatbush from 'flatbush';
import { BASE_ELEVATION_M, HEIGHTMAP_N, PIPELINE_VERSION, TILE_SIZE_M, hash01, heightAt, localToLonLat, lonLatToLocal, tileOrigin } from '@ktm/geo';
import { Hero, Nav, Overrides, PropsFile, TileMeta, type Prop } from '@ktm/schema';
import { resamplePolyline } from '../geom/resample.ts';
import { MeshBuilder } from '../gltf/mesh.ts';
import { writeGlb } from '../gltf/write.ts';
import { PATHS } from '../paths.ts';
import { defaultLevels, pickStyle, styleIndex, zoneAt, type Zone } from '../style/style.ts';
import { buildingHeight, extrudeBuilding, roofKind } from './buildings.ts';
import { flattenUnderRoads, meshHeightAt, type RoadLine } from './flatten.ts';
import { FACADE_REACH_M, MAX_PROPS_PER_TILE, alongPolyline, facadeProps, pointInRing, roofProps, streetProps, treesInRing, utilityProps, type RoadInfo, type XZ } from './props.ts';
import { capProps } from './budget.ts';
import { ROAD_LIFT, ROAD_SAMPLE_M, NAV_FOOT_CLASSES, navNodeId, ribbon, roadSpec, sampleRoad, type RoadSpec } from './roads.ts';
import { LANDCOVER, terrainMesh, type GreenArea } from './terrain.ts';
import { waterMesh } from './water.ts';

/** Same thresholds as osm/partition.ts. */
const CONTENT_MIN_BUILDINGS = 5;
const CONTENT_MIN_ROADS = 3;
const COMMERCIAL_ROADS = new Set(['trunk', 'primary', 'secondary']);
const COMMERCIAL_ROAD_DIST_M = 40;
/** Roads whose frontage gets shop-front props; every road of a *-core zone counts too. */
const SHOP_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

export interface BuildOptions {
  featuresDir?: string; terrainDir?: string; worldDir?: string; outDir?: string;
  /** Suppress the per-artifact report. */
  quiet?: boolean;
}
export interface BuildResult { dir: string; meta: TileMeta; lines: string[] }

interface Feature { id: string; kind: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, string | boolean> }
type NavNode = Nav['nodes'][number];
type NavEdge = Nav['edges'][number];

const readText = (p: string, dflt: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : dflt);
const fmt = (n: number): string => n.toLocaleString('en-US');

function greenColor(t: Record<string, string | boolean>): { key: keyof typeof LANDCOVER; trees: number } | null {
  if (t.leisure === 'park' || t.leisure === 'garden') return { key: 'park', trees: 0.5 };
  if (t.landuse === 'forest' || t.natural === 'wood') return { key: 'forest', trees: 0.8 };
  if (t.landuse === 'farmland' || t.landuse === 'orchard') return { key: 'farmland', trees: 0 };
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.leisure === 'pitch') return { key: 'grass', trees: 0.5 };
  if (t.natural === 'scrub' || t.natural === 'grassland') return { key: 'scrub', trees: 0 };
  return null;
}

function polys(g: Feature['geometry']): XZ[][][] {
  if (g.type === 'Polygon') return [g.coordinates as XZ[][]];
  if (g.type === 'MultiPolygon') return g.coordinates as XZ[][][];
  return [];
}

function openRing(r: XZ[]): XZ[] {
  return r.length > 1 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1] ? r.slice(0, -1) : r;
}
function centroid(r: XZ[]): XZ {
  const o = openRing(r); let x = 0, z = 0;
  for (const p of o) { x += p[0]; z += p[1]; }
  return [x / o.length, z / o.length];
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / l2, 0), 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function ringBox(r: XZ[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of r) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
  return [a, b, c, d];
}

/** Heroes whose footprint bbox overlaps the tile, with footprints in tile-local coords. */
function heroFootprints(worldDir: string, origin: { x: number; z: number }): { slug: string; ring: XZ[] }[] {
  const dir = `${worldDir}/heroes`;
  if (!existsSync(dir)) return [];
  const out: { slug: string; ring: XZ[] }[] = [];
  for (const slug of readdirSync(dir).sort()) {
    const file = `${dir}/${slug}/hero.json`;
    if (!existsSync(file)) continue;
    const hero = Hero.parse(JSON.parse(readFileSync(file, 'utf8')));
    const ring = hero.footprint.map(([lon, lat]): XZ => { const p = lonLatToLocal(lon, lat); return [p.x - origin.x, p.z - origin.z]; });
    const [x0, z0, x1, z1] = ringBox(ring);
    if (x1 < 0 || z1 < 0 || x0 > TILE_SIZE_M || z0 > TILE_SIZE_M) continue;
    out.push({ slug: hero.slug, ring });
  }
  return out;
}

const inTile = (p: Prop): boolean => p.x >= 0 && p.x < TILE_SIZE_M && p.z >= 0 && p.z < TILE_SIZE_M;

export async function buildTile(id: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const featuresDir = opts.featuresDir ?? PATHS.features;
  const terrainDir = opts.terrainDir ?? PATHS.terrain;
  const worldDir = opts.worldDir ?? PATHS.world;
  const dir = opts.outDir ?? `${PATHS.tiles}/${id}`;
  const origin = tileOrigin(id);

  // 1. inputs
  const featuresPath = `${featuresDir}/${id}.geojsonl`;
  const featuresBytes = existsSync(featuresPath) ? readFileSync(featuresPath) : new Uint8Array();
  const terrainPath = `${terrainDir}/${id}.f32`;
  if (!existsSync(terrainPath)) throw new Error(`missing heightmap ${terrainPath}; run: bun run pipeline terrain ${id}`);
  const terrainBytes = readFileSync(terrainPath);
  if (terrainBytes.byteLength !== HEIGHTMAP_N * HEIGHTMAP_N * 4) throw new Error(`bad heightmap size ${terrainBytes.byteLength} in ${terrainPath}`);
  const hm = new Float32Array(terrainBytes.buffer.slice(terrainBytes.byteOffset, terrainBytes.byteOffset + terrainBytes.byteLength));
  const overridesText = readText(`${worldDir}/tiles/${id}/overrides.json`, '{}');
  const overrides = Overrides.parse(JSON.parse(overridesText));
  const propsExtraText = readText(`${worldDir}/tiles/${id}/props.extra.json`, '{"props":[]}');
  const propsExtra = PropsFile.parse(JSON.parse(propsExtraText));
  const heroes = heroFootprints(worldDir, origin);
  const features: Feature[] = new TextDecoder().decode(featuresBytes).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Feature);
  const roads = features.filter((f) => f.kind === 'road' && f.geometry.type === 'LineString');
  const roadList: { f: Feature; pts: XZ[]; spec: RoadSpec; sampled: XZ[] }[] = [];
  const roadLines: RoadLine[] = [];
  for (const f of roads) {
    const ov = overrides.roads[f.id];
    if (ov?.remove) continue;
    const pts = f.geometry.coordinates as XZ[];
    if (pts.length < 2) continue;
    const t = f.properties;
    const base = roadSpec(String(t.highway), ov?.surface ?? (typeof t.surface === 'string' ? t.surface : undefined));
    const spec = { ...base, width: ov?.width ?? base.width, lanes: ov?.lanes ?? base.lanes };
    if (spec.vehicle) {
      // Road heights come from the original terrain; the ground under vehicle roads is then
      // flattened to them. Border samples never move, so tile seams stay identical.
      const s = sampleRoad(pts, (x, z) => meshHeightAt(hm, x, z));
      roadLines.push({ ...s, width: spec.width });
      roadList.push({ f, pts, spec, sampled: s.pts });
    } else roadList.push({ f, pts, spec, sampled: resamplePolyline(pts, ROAD_SAMPLE_M) });
  }
  const flat = flattenUnderRoads(hm, roadLines, ROAD_LIFT);

  // 2. inputs hash
  const hasher = createHash('sha256');
  hasher.update(String(PIPELINE_VERSION)); hasher.update(featuresBytes); hasher.update(terrainBytes);
  hasher.update(overridesText); hasher.update(propsExtraText); hasher.update(JSON.stringify(heroes));
  const inputsHash = hasher.digest('hex');

  // 3. zone
  let minH = Infinity, sumH = 0;
  for (const h of hm) { minH = Math.min(minH, h); sumH += h; }
  const center = localToLonLat(origin.x + TILE_SIZE_M / 2, origin.z + TILE_SIZE_M / 2);
  const zone: Zone = overrides.zone ?? zoneAt(center.lon, center.lat, sumH / hm.length);
  const baseY = minH - BASE_ELEVATION_M;
  // Everything placed on the ground follows the flattened surface the terrain mesh renders.
  const yAt = (x: number, z: number): number => meshHeightAt(flat, x, z) - BASE_ELEVATION_M;

  // 4-5. greens and terrain
  const greens: (GreenArea & { id: string; trees: number })[] = [];
  for (const f of features) {
    if (f.kind !== 'green') continue;
    const g = greenColor(f.properties); if (!g) continue;
    for (const rings of polys(f.geometry)) if (rings[0] && rings[0].length >= 3) greens.push({ ring: rings[0], color: LANDCOVER[g.key]!, id: f.id, trees: g.trees });
  }
  mkdirSync(dir, { recursive: true });
  const terrain = await writeGlb(`${dir}/terrain.glb`, [{ name: 'terrain', data: terrainMesh(flat, greens), baseColor: [1, 1, 1, 1], withColor: true }]);

  // 6. commercial-road index
  const segs: [number, number, number, number][] = [];
  for (const r of roads) {
    if (!COMMERCIAL_ROADS.has(String(r.properties.highway))) continue;
    const pts = r.geometry.coordinates as XZ[];
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]]);
  }
  const index = segs.length ? new Flatbush(segs.length) : null;
  if (index) { for (const [ax, az, bx, bz] of segs) index.add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)); index.finish(); }
  const nearCommercialRoad = ([x, z]: XZ): boolean => {
    if (!index) return false;
    const d = COMMERCIAL_ROAD_DIST_M;
    return index.search(x - d, z - d, x + d, z + d).some((k) => { const s = segs[k]!; return segDist(x, z, s[0], s[1], s[2], s[3]) <= d; });
  };

  // 6b. shop-front roads: the road kinds above plus every road of a *-core zone. Facade props use the
  // closest such road within FACADE_REACH_M; street props use the same set.
  const core = zone.endsWith('-core');
  const isShopRoad = (highway: string, spec: RoadSpec): boolean => SHOP_ROADS.has(highway) || (core && (spec.vehicle || highway === 'pedestrian'));
  const shopSegs: [number, number, number, number][] = [];
  for (const { f, pts, spec } of roadList) {
    if (!isShopRoad(String(f.properties.highway), spec)) continue;
    for (let i = 0; i + 1 < pts.length; i++) shopSegs.push([pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]]);
  }
  const shopIndex = shopSegs.length ? new Flatbush(shopSegs.length) : null;
  if (shopIndex) { for (const [ax, az, bx, bz] of shopSegs) shopIndex.add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)); shopIndex.finish(); }
  const nearestShopRoad = (x: number, z: number): XZ | undefined => {
    if (!shopIndex) return undefined;
    const d = FACADE_REACH_M;
    let best: XZ | undefined, bestD = d;
    for (const k of shopIndex.search(x - d, z - d, x + d, z + d)) {
      const [ax, az, bx, bz] = shopSegs[k]!;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / l2, 0), 1) : 0;
      const px = ax + dx * t, pz = az + dz * t, dist = Math.hypot(x - px, z - pz);
      if (dist <= bestD) { bestD = dist; best = [px, pz]; }
    }
    return best;
  };

  // 6c. footprints that street props must keep clear of (heroes' buildings are not built, so they do not count)
  const footprints: XZ[][] = [];
  for (const f of features) {
    if (f.kind !== 'building' || overrides.buildings[f.id]?.remove) continue;
    const outer = polys(f.geometry)[0]?.[0];
    if (!outer || outer.length < 3 || heroes.some((h) => pointInRing(centroid(outer), h.ring))) continue;
    footprints.push(openRing(outer));
  }
  const fpIndex = footprints.length ? new Flatbush(footprints.length) : null;
  if (fpIndex) { for (const r of footprints) { const [a, b, c, d] = ringBox(r); fpIndex.add(a, b, c, d); } fpIndex.finish(); }
  const inBuilding = (x: number, z: number): boolean => !!fpIndex && fpIndex.search(x, z, x, z).some((k) => pointInRing([x, z], footprints[k]!));

  // 7. buildings
  const walls = new MeshBuilder(), roofs = new MeshBuilder();
  const generated: Prop[] = [];
  let buildingCount = 0;
  for (const f of features) {
    if (f.kind !== 'building') continue;
    const ov = overrides.buildings[f.id];
    if (ov?.remove) continue;
    const rings = polys(f.geometry)[0];
    const outer = rings?.[0];
    if (!rings || !outer || outer.length < 3) continue;
    const c = centroid(outer);
    if (heroes.some((h) => pointInRing(c, h.ring))) continue;
    const style = ov?.style ?? pickStyle(f.properties, zone, nearCommercialRoad(c), hash01(f.id));
    const height = buildingHeight(f.properties, ov, overrides.defaultLevels ?? defaultLevels(zone));
    let minY = Infinity; for (const [x, z] of outer) minY = Math.min(minY, yAt(x, z));
    const by = minY - 0.3;
    const roof = roofKind(zone, outer, ov?.roof);
    extrudeBuilding({ rings, baseY: by, height, style: styleIndex(style), roof, roofStyle: styleIndex('tile_roof') }, walls, roofs);
    // Water tanks, rebar and the other roof clutter stand on flat roofs only.
    if (roof === 'flat') generated.push(...roofProps(openRing(outer), by + height, style, f.id, hash01));
    generated.push(...facadeProps(openRing(outer), by + 0.3, height, f.id, nearestShopRoad, hash01));
    buildingCount++;
  }

  // 8. roads, nav, roadside props
  const mats = { asphalt: new MeshBuilder(), unpaved: new MeshBuilder(), path: new MeshBuilder() };
  const nodes = new Map<string, NavNode>();
  const edges: NavEdge[] = [];
  const seamStubs: string[] = [];
  let roadCount = 0;
  for (const { f, pts, spec, sampled } of roadList) {
    const t = f.properties;
    ribbon(sampled, spec.width, yAt, mats[spec.material], ROAD_LIFT);
    roadCount++;
    // Vehicle roads and foot-class ways are walkable graph edges; foot ways carry lanes 0 so traffic skips them.
    const foot = !spec.vehicle && NAV_FOOT_CLASSES.has(String(t.highway));
    if (spec.vehicle || foot) {
      const ids: { nid: string; node: NavNode }[] = [];
      pts.forEach(([x, z], i) => {
        const nid = navNodeId(origin.x + x, origin.z + z);
        const border = (i === 0 && t.borderStart === true) || (i === pts.length - 1 && t.borderEnd === true);
        const node = { id: nid, x, y: yAt(x, z), z, border };
        const last = ids[ids.length - 1];
        // Vertices that quantise to the same id collapse into one. A seam crossing wins, so the
        // node keeps its exact edge position and border flag instead of being dropped together
        // with the zero-length edge.
        if (last && last.nid === nid) { if (border) last.node = node; }
        else ids.push({ nid, node });
      });
      // A road that collapses to a single node has no edge to register it with. If it carries a
      // seam crossing, hand the flag to the junction node that other roads created here.
      if (ids.length === 1 && ids[0]!.node.border) seamStubs.push(ids[0]!.nid);
      const oneway = t.oneway === 'yes' || t.junction === 'roundabout';
      for (let i = 0; i + 1 < ids.length; i++) {
        const a = ids[i]!, b = ids[i + 1]!;
        for (const n of [a, b]) {
          const prev = nodes.get(n.nid);
          if (!prev) nodes.set(n.nid, { ...n.node });
          else prev.border ||= n.node.border;
        }
        edges.push({ from: a.nid, to: b.nid, lanes: foot ? 0 : Math.max(1, spec.lanes), oneway, speed: foot ? 5 : spec.speed, cls: String(t.highway), width: spec.width });
      }
    }
    if (spec.lights) generated.push(...alongPolyline(pts, 30, -(spec.width / 2 + 0.8), yAt));
    const info: RoadInfo = {
      id: f.id, pts, width: spec.width, highway: String(t.highway), unpaved: spec.material === 'unpaved' || t.highway === 'track',
      vehicle: spec.vehicle, commercial: isShopRoad(String(t.highway), spec), core,
    };
    generated.push(...utilityProps(info, yAt, hash01, inBuilding), ...streetProps(info, yAt, hash01, inBuilding));
  }

  for (const nid of seamStubs) { const n = nodes.get(nid); if (n) n.border = true; }

  // 9. trees
  for (const g of greens) if (g.trees > 0) generated.push(...treesInRing(g.ring, yAt, hash01, g.id, g.trees));

  // 10. water
  const water = new MeshBuilder();
  for (const f of features) if (f.kind === 'water') waterMesh(polys(f.geometry), (x, z) => heightAt(hm, x, z), water);
  const waterData = water.finish();

  // 11. props and nav. Generated props are kept only inside the tile's half-open square so a
  // roadside light near a seam belongs to exactly one tile. Props inside a hero footprint are
  // dropped, like the buildings there; curated props.extra.json entries are kept as written.
  const inHero = (p: Prop): boolean => heroes.some((h) => pointInRing([p.x, p.z], h.ring));
  // Prop budget: the elastic types are thinned by a common fraction when a tile exceeds it.
  const kept = capProps(generated.filter((p) => inTile(p) && !inHero(p)), Math.max(0, MAX_PROPS_PER_TILE - 1 - propsExtra.props.length), hash01);
  const propsFile = PropsFile.parse({ props: [...kept.props, ...propsExtra.props] });
  const nav = Nav.parse({ nodes: [...nodes.values()], edges });
  writeFileSync(`${dir}/props.json`, JSON.stringify(propsFile));
  writeFileSync(`${dir}/nav.json`, JSON.stringify(nav));

  // 12. meshes, heightmap, meta
  const buildings = await writeGlb(`${dir}/buildings.glb`, [
    { name: 'walls', data: walls.finish(), baseColor: [0.8, 0.75, 0.7, 1], withStyle: true },
    { name: 'roofs', data: roofs.finish(), baseColor: [0.55, 0.5, 0.45, 1], withStyle: true },
  ]);
  const roadsGlb = await writeGlb(`${dir}/roads.glb`, [
    { name: 'asphalt', data: mats.asphalt.finish(), baseColor: [0.23, 0.23, 0.23, 1] },
    { name: 'unpaved', data: mats.unpaved.finish(), baseColor: [0.55, 0.47, 0.36, 1] },
    { name: 'path', data: mats.path.finish(), baseColor: [0.6, 0.56, 0.5, 1] },
  ]);
  const waterOut = waterData.indices.length
    ? await writeGlb(`${dir}/water.glb`, [{ name: 'water', data: waterData, baseColor: [0.25, 0.38, 0.42, 1], roughness: 0.2 }])
    : { bytes: 0, triangles: 0 };
  writeFileSync(`${dir}/height.f32`, new Uint8Array(flat.buffer, flat.byteOffset, flat.byteLength));

  const size = (f: string) => readFileSync(`${dir}/${f}`).byteLength;
  const bytes: Record<string, number> = {
    'terrain.glb': terrain.bytes, 'buildings.glb': buildings.bytes, 'roads.glb': roadsGlb.bytes,
    'props.json': size('props.json'), 'nav.json': size('nav.json'), 'height.f32': size('height.f32'),
  };
  if (waterOut.bytes) bytes['water.glb'] = waterOut.bytes;
  const meta = TileMeta.parse({
    id, version: 1,
    kind: buildingCount >= CONTENT_MIN_BUILDINGS || roadCount >= CONTENT_MIN_ROADS ? 'content' : 'terrain',
    origin, baseY, zone,
    counts: { buildings: buildingCount, roadSegments: roadCount, props: propsFile.props.length, navNodes: nav.nodes.length },
    triangles: { terrain: terrain.triangles, buildings: buildings.triangles, roads: roadsGlb.triangles, water: waterOut.triangles },
    bytes, inputsHash, builtAt: new Date().toISOString(),
  });
  writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 2));

  // 13. report
  const lines = [
    `terrain.glb ${fmt(terrain.bytes)} B ${fmt(terrain.triangles)} tris`,
    `buildings.glb ${fmt(buildings.bytes)} B ${fmt(buildings.triangles)} tris`,
    `roads.glb ${fmt(roadsGlb.bytes)} B ${fmt(roadsGlb.triangles)} tris`,
    waterOut.bytes ? `water.glb ${fmt(waterOut.bytes)} B ${fmt(waterOut.triangles)} tris` : 'water.glb 0 B 0 tris (not written)',
    `props.json ${fmt(bytes['props.json']!)} B ${fmt(propsFile.props.length)} props, nav.json ${fmt(bytes['nav.json']!)} B ${fmt(nav.nodes.length)} nodes ${fmt(nav.edges.length)} edges`,
  ];
  const byType: Record<string, number> = {};
  for (const p of propsFile.props) byType[p.type] = (byType[p.type] ?? 0) + 1;
  lines.push(`props by type: ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const droppedTotal = Object.values(kept.dropped).reduce((a, b) => a + b, 0);
  if (droppedTotal) lines.push(`props over budget: dropped ${fmt(droppedTotal)} (${Object.entries(kept.dropped).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  if (!opts.quiet) { for (const l of lines) console.log(l); console.log(`meta: ${dir}/meta.json`); }
  return { dir, meta, lines };
}
