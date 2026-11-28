import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { BASE_ELEVATION_M, HEIGHTMAP_N, TILE_SIZE_M, inGrid, parseTileId, tileBounds, tileId, tileOrigin } from '@ktm/geo';
import { Nav, PropsFile, TileMeta } from '@ktm/schema';
import { MAX_PROPS_PER_TILE } from '../build/props.ts';

export interface ValidateResult { ok: boolean; errors: string[]; warnings: string[] }
export interface ValidateOptions { neighborNav?: (id: string) => Nav | undefined }

const REQUIRED = ['meta.json', 'terrain.glb', 'buildings.glb', 'roads.glb', 'props.json', 'nav.json', 'height.f32'] as const;
const TRI_BUDGET = { terrain: 8_192, buildings: 600_000, roads: 120_000 } as const;
const BYTE_BUDGET: Record<string, number> = { 'buildings.glb': 8 * 1024 * 1024, 'roads.glb': 2 * 1024 * 1024 };
/** Sanity range for heightmap values (m above sea level); the eastern and southern outskirts dip to about 830 m. */
const HEIGHT_MIN = 500, HEIGHT_MAX = 3000;
/** Prop Y may sit this far below the lowest and above the highest ground sample (roof props, tall buildings). */
const PROP_BELOW_M = 5, PROP_ABOVE_M = 60;
const MAX_LISTED = 5;
/** Distance (m) within which a node counts as lying on a tile edge; corners are excluded from seam checks. */
const EDGE_EPS = 0.01;

const json = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const issues = (zodErr: { issues: { path: PropertyKey[]; message: string }[] }): string =>
  zodErr.issues.slice(0, 3).map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');

/**
 * Seam check against the four edge neighbours: the border node ids lying on a shared edge must be
 * identical on both sides. Works in world coordinates so it does not depend on which side is which.
 */
export function seamErrors(id: string, nav: Nav, neighborNav: (id: string) => Nav | undefined): string[] {
  const errors: string[] = [];
  const { i, j } = parseTileId(id);
  const b = tileBounds(id);
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (!inGrid(i + di, j + dj)) continue;
    const nid = tileId(i + di, j + dj);
    const other = neighborNav(nid);
    if (!other) continue;
    // Shared edge: vertical line x = const for east/west, horizontal z = const for north/south.
    const vertical = di !== 0;
    const line = vertical ? (di > 0 ? b.maxX : b.minX) : (dj > 0 ? b.minZ : b.maxZ); // row j+1 lies north (smaller z)
    const [lo, hi] = vertical ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
    const onEdge = (tile: string, n: Nav['nodes'][number]): boolean => {
      const o = tileOrigin(tile);
      const wx = o.x + n.x, wz = o.z + n.z;
      const across = vertical ? wx : wz, along = vertical ? wz : wx;
      return Math.abs(across - line) <= EDGE_EPS && along > lo + EDGE_EPS && along < hi - EDGE_EPS;
    };
    const mine = new Set(nav.nodes.filter((n) => n.border && onEdge(id, n)).map((n) => n.id));
    const theirs = new Set(other.nodes.filter((n) => n.border && onEdge(nid, n)).map((n) => n.id));
    const diff = [...[...mine].filter((x) => !theirs.has(x)), ...[...theirs].filter((x) => !mine.has(x))].sort();
    if (diff.length) errors.push(`seam ${id}|${nid}: ${diff.length} border node(s) not on both sides: ${diff.slice(0, MAX_LISTED).join(', ')}`);
  }
  return errors;
}

async function primitiveCount(path: string): Promise<number> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  return doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);
}

export async function validateTile(dir: string, opts: ValidateOptions = {}): Promise<ValidateResult> {
  const errors: string[] = [], warnings: string[] = [];
  const done = (): ValidateResult => ({ ok: errors.length === 0, errors, warnings });

  for (const f of REQUIRED) if (!existsSync(`${dir}/${f}`)) errors.push(`missing ${f}`);
  if (errors.length) return done();

  const metaR = TileMeta.safeParse(json(`${dir}/meta.json`));
  const propsR = PropsFile.safeParse(json(`${dir}/props.json`));
  const navR = Nav.safeParse(json(`${dir}/nav.json`));
  if (!metaR.success) errors.push(`meta.json: ${issues(metaR.error)}`);
  if (!propsR.success) errors.push(`props.json: ${issues(propsR.error)}`);
  if (!navR.success) errors.push(`nav.json: ${issues(navR.error)}`);
  if (!metaR.success || !propsR.success || !navR.success) return done();
  const meta = metaR.data, props = propsR.data.props, nav = navR.data;

  // heightmap
  const hb = readFileSync(`${dir}/height.f32`);
  let propMinY = meta.baseY - PROP_BELOW_M, propMaxY = meta.baseY + 300; // fallback when the heightmap is unusable
  if (hb.byteLength !== HEIGHTMAP_N * HEIGHTMAP_N * 4) errors.push(`height.f32: ${hb.byteLength} bytes, expected ${HEIGHTMAP_N * HEIGHTMAP_N * 4}`);
  else {
    const hm = new Float32Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength));
    let bad = 0, first = -1, lo = Infinity, hi = -Infinity;
    hm.forEach((h, k) => {
      if (!(h >= HEIGHT_MIN && h <= HEIGHT_MAX)) { bad++; if (first < 0) first = k; return; }
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    });
    if (hi >= lo) { propMinY = lo - BASE_ELEVATION_M - PROP_BELOW_M; propMaxY = hi - BASE_ELEVATION_M + PROP_ABOVE_M; }
    if (bad) errors.push(`height.f32: ${bad} value(s) NaN or outside [${HEIGHT_MIN}, ${HEIGHT_MAX}], first at ${first} = ${hm[first]}`);
  }

  // budgets
  for (const [k, max] of Object.entries(TRI_BUDGET)) {
    const n = meta.triangles[k as keyof typeof TRI_BUDGET];
    if (n > max) errors.push(`triangles.${k} ${n} > ${max}`);
  }
  for (const [f, max] of Object.entries(BYTE_BUDGET)) {
    const n = statSync(`${dir}/${f}`).size;
    if (n > max) errors.push(`${f} ${n} B > ${max} B`);
  }

  // props
  if (props.length >= MAX_PROPS_PER_TILE) errors.push(`props: ${props.length} props, the budget is under ${MAX_PROPS_PER_TILE}`);
  const badProps: string[] = [];
  props.forEach((p, k) => {
    const inXZ = p.x >= -5 && p.x <= TILE_SIZE_M + 5 && p.z >= -5 && p.z <= TILE_SIZE_M + 5;
    const inY = p.y >= propMinY && p.y <= propMaxY;
    if (!inXZ || !inY) badProps.push(`props[${k}] ${p.type} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) outside tile bounds`);
  });
  errors.push(...badProps.slice(0, MAX_LISTED));
  if (badProps.length > MAX_LISTED) errors.push(`props: ${badProps.length - MAX_LISTED} more out-of-bounds prop(s)`);

  // nav
  const ids = new Set(nav.nodes.map((n) => n.id));
  const used = new Set<string>();
  const badEdges = nav.edges.filter((e) => { used.add(e.from); used.add(e.to); return !ids.has(e.from) || !ids.has(e.to); });
  if (badEdges.length) errors.push(`nav: ${badEdges.length} edge(s) reference missing nodes: ${badEdges.slice(0, MAX_LISTED).map((e) => `${e.from}->${e.to}`).join(', ')}`);
  const lonely = nav.nodes.filter((n) => !used.has(n.id));
  if (lonely.length) errors.push(`nav: ${lonely.length} node(s) without edges: ${lonely.slice(0, MAX_LISTED).map((n) => n.id).join(', ')}`);
  const outside = nav.nodes.filter((n) => n.x < -1 || n.x > TILE_SIZE_M + 1 || n.z < -1 || n.z > TILE_SIZE_M + 1);
  if (outside.length) errors.push(`nav: ${outside.length} node(s) outside tile: ${outside.slice(0, MAX_LISTED).map((n) => n.id).join(', ')}`);
  if (ids.size !== nav.nodes.length) errors.push(`nav: ${nav.nodes.length - ids.size} duplicate node id(s)`);

  // seams
  if (opts.neighborNav) errors.push(...seamErrors(meta.id, nav, opts.neighborNav));

  // kind
  if (meta.kind === 'content' && meta.counts.buildings === 0 && meta.counts.roadSegments === 0) errors.push('meta: kind content but no buildings and no road segments');

  // glb sanity
  const layers: [string, number][] = [['terrain.glb', meta.triangles.terrain], ['buildings.glb', meta.triangles.buildings], ['roads.glb', meta.triangles.roads]];
  if (existsSync(`${dir}/water.glb`) || meta.triangles.water > 0) layers.push(['water.glb', meta.triangles.water]);
  for (const [f, tris] of layers) {
    if (!existsSync(`${dir}/${f}`)) { errors.push(`missing ${f} (meta.triangles reports ${tris})`); continue; }
    try {
      const prims = await primitiveCount(`${dir}/${f}`);
      if (f === 'terrain.glb' && prims < 1) errors.push(`${f}: no primitives`);
      else if (tris > 0 && prims < 1) errors.push(`${f}: no primitives but meta reports ${tris} triangles`);
      else if (tris === 0 && f !== 'terrain.glb') warnings.push(`${f}: empty layer`);
    } catch (e) {
      errors.push(`${f}: unreadable (${(e as Error).message})`);
    }
  }
  return done();
}
