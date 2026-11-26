import { createReadStream } from 'node:fs';

export type Position = [number, number];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };
export interface OsmFeature { type: 'Feature'; id?: string; geometry: Geometry; properties: Record<string, string> }

/** osmium puts the unique id at the top level with --add-unique-id; older configs put it in properties["@id"]. */
export function featureId(f: OsmFeature): string {
  const id = f.id ?? f.properties['@id'] ?? f.properties['id'];
  if (!id) throw new Error('feature without id; run ingest with --add-unique-id=type_id');
  return String(id);
}

/** Memory-safe line reader for multi-GB geojsonseq/geojsonl files (RS 0x1e prefix tolerated). Runs under Bun and Node. */
export async function* readFeatures(path: string): AsyncGenerator<OsmFeature> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of createReadStream(path) as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/^\x1e/, '').trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as OsmFeature;
    }
  }
  const last = buf.replace(/^\x1e/, '').trim();
  if (last) yield JSON.parse(last) as OsmFeature;
}
