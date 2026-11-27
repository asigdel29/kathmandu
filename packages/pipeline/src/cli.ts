import * as ingest from './commands/ingest.ts';
import * as partition from './commands/partition.ts';
import * as terrain from './commands/terrain.ts';
import * as build from './commands/build.ts';
import * as validate from './commands/validate.ts';
import * as shot from './commands/shot.ts';
import * as manifest from './commands/manifest.ts';
import * as upload from './commands/upload.ts';
import * as fetchInputs from './commands/fetch-inputs.ts';
import * as scopeCheck from './commands/scope-check.ts';
import * as prComment from './commands/pr-comment.ts';
import * as heroTile from './commands/hero-tile.ts';
import * as latlon from './commands/latlon.ts';

const commands: Record<string, { run(args: string[]): Promise<void> }> = {
  ingest, partition, terrain, build, validate, shot, manifest, upload, 'fetch-inputs': fetchInputs,
  'scope-check': scopeCheck, 'pr-comment': prComment, 'hero-tile': heroTile, latlon,
};

const [cmd = '', ...rest] = process.argv.slice(2);
const impl = commands[cmd];
if (!impl) {
  console.error(`usage: bun run pipeline <${Object.keys(commands).join('|')}> [args]`);
  process.exit(2);
}
await impl.run(rest);
