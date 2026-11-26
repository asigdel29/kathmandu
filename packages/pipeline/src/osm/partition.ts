import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';
import { lonLatToLocal, localToLonLat, tileBounds, tileId, tileIndexAt, tileOrigin, inGrid, type TileId } from '@ktm/geo';
import { classify, isPoi, keepTags, type Kind } from './classify.ts';
import { featureId, readFeatures, type OsmFeature, type Position } from './read.ts';
import { splitPolylineByGrid, type XZ } from '../geom/split.ts';

export interface TileCounts { buildings: number; roads: number; pois: number; water: number; green: number; landuse: number }
export interface TileSummary extends TileCounts { kind: 'content' | 'terrain'; neighborhood: string; priority: number; center: { lon: number; lat: number } }
export interface PartitionSummary { generatedAt: string; input: string; tiles: Record<string, TileSummary> }
export interface TileFeature { id: string; kind: Kind; geometry: { type: string; coordinates: unknown }; properties: Record<string, string | boolean> }

const CONTENT_MIN_BUILDINGS = 5;
const CONTENT_MIN_ROADS = 3;

class TileWriter {
  private bufs = new Map<string, string[]>();
  private bytes = new Map<string, number>();
  constructor(private dir: string) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  write(tile: string, f: TileFeature): void {
    const line = JSON.stringify(f) + '\n';
    const arr = this.bufs.get(tile) ?? []; arr.push(line); this.bufs.set(tile, arr);
    const n = (this.bytes.get(tile) ?? 0) + line.length; this.bytes.set(tile, n);
    if (n > 1 << 20) this.flush(tile);
  }
  private flush(tile: string): void {
    const arr = this.bufs.get(tile); if (!arr?.length) return;
    appendFileSync(`${this.dir}/${tile}.geojsonl`, arr.join('')); this.bufs.set(tile, []); this.bytes.set(tile, 0);
  }
  close(): void { for (const t of this.bufs.keys()) this.flush(t); }
}

const toWorld = (c: Position): XZ => { const p = lonLatToLocal(c[0], c[1]); return [p.x, p.z]; };
const toLocal = (o: { x: number; z: number }) => (c: XZ): XZ => [c[0] - o.x, c[1] - o.z];
const centroid = (ring: XZ[]): XZ => { let x = 0, z = 0; const n = ring.length - 1 || 1; for (let k = 0; k < n; k++) { x += ring[k]![0]; z += ring[k]![1]; } return [x / n, z / n]; };

function* polygons(f: OsmFeature): Generator<Position[][]> {
  if (f.geometry.type === 'Polygon') yield f.geometry.coordinates;
  else if (f.geometry.type === 'MultiPolygon') yield* f.geometry.coordinates;
}

function tilesCovering(rings: XZ[][]): TileId[] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rings) for (const [x, z] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const a = tileIndexAt(minX, maxZ), b = tileIndexAt(maxX, minZ);
  const out: TileId[] = [];
  for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) if (inGrid(i, j)) out.push(tileId(i, j));
  return out;
}

export async function partition(opts: { input: string; outDir: string }): Promise<PartitionSummary> {
  const writer = new TileWriter(opts.outDir);
  const counts = new Map<string, TileCounts>();
  const places: { name: string; rank: number; x: number; z: number }[] = [];
  const bump = (tile: string, k: keyof TileCounts) => { const c = counts.get(tile) ?? { buildings: 0, roads: 0, pois: 0, water: 0, green: 0, landuse: 0 }; c[k]++; counts.set(tile, c); };

  for await (const f of readFeatures(opts.input)) {
    const kind = classify(f);
    if (kind === 'skip') continue;
    const id = featureId(f);
    const props: Record<string, string | boolean> = keepTags(f.properties);
    if (kind === 'place' && f.geometry.type === 'Point') {
      const [x, z] = toWorld(f.geometry.coordinates);
      const rank = ['neighbourhood', 'quarter', 'suburb', 'village', 'hamlet', 'town', 'city'].indexOf(f.properties.place!);
      places.push({ name: f.properties.name!, rank, x, z });
      continue;
    }
    if (kind === 'building' || kind === 'poi') {
      if (kind === 'building') props.poi = isPoi(f.properties);
      const parts = kind === 'poi' && f.geometry.type === 'Point' ? [[[toWorld(f.geometry.coordinates)]]] : [...polygons(f)].map((poly) => poly.map((ring) => ring.map(toWorld)));
      parts.forEach((rings, n) => {
        const c = kind === 'poi' ? rings[0]![0]! : centroid(rings[0]!);
        const { i, j } = tileIndexAt(c[0], c[1]);
        if (!inGrid(i, j)) return;
        const tile = tileId(i, j); const L = toLocal(tileOrigin(tile));
        const geometry = kind === 'poi' ? { type: 'Point', coordinates: L(c) } : { type: 'Polygon', coordinates: rings.map((r) => r.map(L)) };
        writer.write(tile, { id: parts.length > 1 ? `${id}#${n}` : id, kind, geometry, properties: props });
        bump(tile, kind === 'poi' ? 'pois' : 'buildings');
        if (kind === 'building' && props.poi) bump(tile, 'pois');
      });
      continue;
    }
    if (kind === 'road' && f.geometry.type === 'LineString') {
      for (const piece of splitPolylineByGrid(f.geometry.coordinates.map(toWorld))) {
        const L = toLocal(tileOrigin(piece.tile));
        writer.write(piece.tile, { id, kind, geometry: { type: 'LineString', coordinates: piece.pts.map(L) }, properties: { ...props, borderStart: piece.borderStart, borderEnd: piece.borderEnd } });
        bump(piece.tile, 'roads');
      }
      continue;
    }
    // water / green / landuse: clip polygons to each covered tile
    for (const poly of polygons(f)) {
      const rings = poly.map((r) => r.map(toWorld));
      for (const tile of tilesCovering(rings)) {
        const b = tileBounds(tile);
        const rect: XZ[][] = [[[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.minX, b.minZ]]];
        const clipped = polygonClipping.intersection([rings as [number, number][][]], [rect as [number, number][][]]);
        if (!clipped.length) continue;
        const L = toLocal(tileOrigin(tile));
        writer.write(tile, { id, kind, geometry: { type: 'MultiPolygon', coordinates: clipped.map((p) => p.map((r) => r.map((c) => L(c as XZ)))) }, properties: props });
        bump(tile, kind as 'water' | 'green' | 'landuse');
      }
    }
  }
  writer.close();

  const tiles: Record<string, TileSummary> = {};
  for (const [tile, c] of counts) {
    const b = tileBounds(tile); const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    let best = ''; let bestScore = Infinity;
    for (const p of places) { const d = Math.hypot(p.x - cx, p.z - cz); const limit = p.rank <= 2 ? 1500 : p.rank <= 4 ? 2000 : 3000; if (d < limit && d + p.rank * 200 < bestScore) { bestScore = d + p.rank * 200; best = p.name; } }
    const kind = c.buildings >= CONTENT_MIN_BUILDINGS || c.roads >= CONTENT_MIN_ROADS ? 'content' : 'terrain';
    const center = localToLonLat(cx, cz);
    tiles[tile] = { ...c, kind, neighborhood: best, priority: c.buildings + 3 * c.pois + (best ? 50 : 0), center };
  }
  const summary: PartitionSummary = { generatedAt: new Date().toISOString(), input: opts.input, tiles };
  writeFileSync(`${opts.outDir}/../partition-summary.json`, JSON.stringify(summary));
  return summary;
}
