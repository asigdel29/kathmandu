import { GRID } from '@ktm/geo';
import { PATHS } from '../paths.ts';
import { partition } from '../osm/partition.ts';

export async function run(args: string[]): Promise<void> {
  const input = args[0] ?? `${PATHS.data}/raw/valley.geojsonl`;
  const summary = await partition({ input, outDir: PATHS.features });
  const content = Object.values(summary.tiles).filter((t) => t.kind === 'content').length;
  console.log(`tiles with features: ${Object.keys(summary.tiles).length} / ${GRID.cols * GRID.rows}`);
  console.log(`content tiles: ${content}`);
  console.log(`summary: ${PATHS.data}/partition-summary.json`);
}
