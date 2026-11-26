import { existsSync, mkdirSync } from 'node:fs';
import { BBOX } from '@ktm/geo';
import { PATHS } from '../paths.ts';
import { sh, shOut } from '../sh.ts';

const PBF_URL = 'https://download.geofabrik.de/asia/nepal-latest.osm.pbf';

export async function run(_args: string[]): Promise<void> {
  const raw = `${PATHS.data}/raw`;
  mkdirSync(raw, { recursive: true });
  const pbf = `${raw}/nepal-latest.osm.pbf`;
  const valley = `${raw}/valley.osm.pbf`;
  const out = `${raw}/valley.geojsonl`;
  if (!existsSync(pbf)) sh(['curl', '-L', '--fail', '--retry', '3', '-o', pbf, PBF_URL]);
  sh(['osmium', 'extract', '--overwrite', '--strategy', 'complete_ways',
      '--bbox', `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, '-o', valley, pbf]);
  sh(['osmium', 'export', '--overwrite', '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id', '-o', out, valley]);
  const lines = shOut(['wc', '-l', out]).trim().split(/\s+/)[0];
  console.log(`features: ${lines}`);
  console.log(`output: ${out}`);
}
