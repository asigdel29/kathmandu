// Builds a one-tile world (x14_y17 from the pipeline fixture) into dist/e2e-world so the browser
// tests run without the world bucket. Usage: bun apps/game/e2e/fixture-world.ts [outDir]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixtureInputs } from '../../../packages/pipeline/test/fixture-tile.ts';
import { buildTile } from '../../../packages/pipeline/src/build/tile.ts';
import { buildManifest } from '../../../packages/pipeline/src/commands/manifest.ts';

const TILE = 'x14_y17';
const out = process.argv[2] ?? new URL('../../../dist/e2e-world', import.meta.url).pathname;

const inputs = fixtureInputs();
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/tiles`, { recursive: true });
await buildTile(TILE, { featuresDir: inputs.featuresDir, terrainDir: inputs.terrainDir, worldDir: inputs.worldDir, outDir: `${out}/tiles/${TILE}`, quiet: true });
// The fixture world dir has no heroes, so the manifest lists none and the page fetches no hero models.
// The schema wants an absolute baseUrl; the page itself loads from VITE_WORLD_BASE_URL ?? '/world/'.
const manifest = buildManifest({ tilesDir: `${out}/tiles`, worldDir: inputs.worldDir, baseUrl: 'http://localhost:5175/world/' });
writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(dirname(inputs.featuresDir), { recursive: true, force: true });
console.log(`e2e world: ${out} (${Object.keys(manifest.tiles).join(', ')})`);
