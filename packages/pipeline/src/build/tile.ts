import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import Flatbush from 'flatbush';
import { BASE_ELEVATION_M, HEIGHTMAP_N, PIPELINE_VERSION, TILE_SIZE_M, hash01, heightAt, localToLonLat, lonLatToLocal, tileOrigin } from '@ktm/geo';
import { Hero, Nav, Overrides, PropsFile, TileMeta, type Prop } from '@ktm/schema';
import { MeshBuilder } from '../gltf/mesh.ts';
import { writeGlb } from '../gltf/write.ts';
import { PATHS } from '../paths.ts';
import { defaultLevels, pickStyle, styleIndex, zoneAt, type Zone } from '../style/style.ts';
import { buildingHeight, extrudeBuilding } from './buildings.ts';
import { alongPolyline, pointInRing, roofProps, treesInRing, type XZ } from './props.ts';
import { navNodeId, ribbon, roadSpec } from './roads.ts';
import { LANDCOVER, terrainMesh, type GreenArea } from './terrain.ts';
import { waterMesh } from './water.ts';

/** Same thresholds as osm/partition.ts. */
const CONTENT_MIN_BUILDINGS = 5;
const CONTENT_MIN_ROADS = 3;
const COMMERCIAL_ROADS = new Set(['trunk', 'primary', 'secondary']);
const COMMERCIAL_ROAD_DIST_M = 40;

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
  const yAt = (x: number, z: number): number => heightAt(hm, x, z) - BASE_ELEVATION_M;

  // 4-5. greens and terrain
  const greens: (GreenArea & { id: string; trees: number })[] = [];
  for (const f of features) {
    if (f.kind !== 'green') continue;
    const g = greenColor(f.properties); if (!g) continue;
    for (const rings of polys(f.geometry)) if (rings[0] && rings[0].length >= 3) greens.push({ ring: rings[0], color: LANDCOVER[g.key]!, id: f.id, trees: g.trees });
  }
  mkdirSync(dir, { recursive: true });
  const terrain = await writeGlb(`${dir}/terrain.glb`, [{ name: 'terrain', data: terrainMesh(hm, greens), baseColor: [1, 1, 1, 1], withColor: true }]);

  // 6. commercial-road index
  const roads = features.filter((f) => f.kind === 'road' && f.geometry.type === 'LineString');
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
    extrudeBuilding({ rings, baseY: by, height, style: styleIndex(style) }, walls, roofs);
    generated.push(...roofProps(openRing(outer), by + height, style, hash01(f.id + 'roof')));
    buildingCount++;
  }

  // 8. roads, nav, roadside props
  const mats = { asphalt: new MeshBuilder(), unpaved: new MeshBuilder(), path: new MeshBuilder() };
  const nodes = new Map<string, NavNode>();
  const edges: NavEdge[] = [];
  let roadCount = 0;
  for (const f of roads) {
    const ov = overrides.roads[f.id];
    if (ov?.remove) continue;
    const pts = f.geometry.coordinates as XZ[];
    if (pts.length < 2) continue;
    const t = f.properties;
    const base = roadSpec(String(t.highway), ov?.surface ?? (typeof t.surface === 'string' ? t.surface : undefined));
    const spec = { ...base, width: ov?.width ?? base.width, lanes: ov?.lanes ?? base.lanes };
    ribbon(pts, spec.width, yAt, mats[spec.material], 0.08);
    roadCount++;
    if (spec.vehicle) {
      const ids = pts.map(([x, z], i) => {
        const nid = navNodeId(origin.x + x, origin.z + z);
        const border = (i === 0 && t.borderStart === true) || (i === pts.length - 1 && t.borderEnd === true);
        return { nid, node: { id: nid, x, y: yAt(x, z), z, border } };
      });
      const oneway = t.oneway === 'yes' || t.junction === 'roundabout';
      for (let i = 0; i + 1 < ids.length; i++) {
        const a = ids[i]!, b = ids[i + 1]!;
        if (a.nid === b.nid) continue;
        for (const n of [a, b]) {
          const prev = nodes.get(n.nid);
          if (!prev) nodes.set(n.nid, { ...n.node });
          else prev.border ||= n.node.border;
        }
        edges.push({ from: a.nid, to: b.nid, lanes: Math.max(1, spec.lanes), oneway, speed: spec.speed, cls: String(t.highway), width: spec.width });
      }
    }
    if (spec.lights) generated.push(...alongPolyline(pts, 30, -(spec.width / 2 + 0.8), yAt));
    if (t.highway === 'residential' || t.highway === 'unclassified') generated.push(...alongPolyline(pts, 40, spec.width / 2 + 0.6, yAt, 'powerpole'));
  }

  // 9. trees
  for (const g of greens) if (g.trees > 0) generated.push(...treesInRing(g.ring, yAt, hash01, g.id, g.trees));

  // 10. water
  const water = new MeshBuilder();
  for (const f of features) if (f.kind === 'water') waterMesh(polys(f.geometry), (x, z) => heightAt(hm, x, z), water);
  const waterData = water.finish();

  // 11. props and nav. Generated props are kept only inside the tile's half-open square so a
  // roadside light near a seam belongs to exactly one tile.
  const propsFile = PropsFile.parse({ props: [...generated.filter(inTile), ...propsExtra.props] });
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
  copyFileSync(terrainPath, `${dir}/height.f32`);

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
  if (!opts.quiet) { for (const l of lines) console.log(l); console.log(`meta: ${dir}/meta.json`); }
  return { dir, meta, lines };
}
