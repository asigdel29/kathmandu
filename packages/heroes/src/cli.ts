import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blenderCommand, budgetViolations, formatSummary, parseBuildArgs, parseBuildResult, parseTier } from './build.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

let slug = '';
try { ({ slug } = parseBuildArgs(process.argv.slice(2))); } catch (e) { console.error((e as Error).message); process.exit(2); }

const heroDir = `${ROOT}/world/heroes/${slug}`;
if (!existsSync(`${heroDir}/build.py`)) fail(`no world/heroes/${slug}/build.py`);
if (!existsSync(`${heroDir}/hero.json`)) fail(`no world/heroes/${slug}/hero.json`);
let tier;
try { tier = parseTier(JSON.parse(readFileSync(`${heroDir}/hero.json`, 'utf8'))); } catch (e) { fail(`world/heroes/${slug}/hero.json: ${(e as Error).message}`); }

const out = `${ROOT}/dist/heroes/${slug}`;
rmSync(`${out}/build.json`, { force: true });
const p = Bun.spawnSync(blenderCommand(slug, ROOT, process.env), { cwd: ROOT, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, KTM_ROOT: ROOT } });
if (p.exitCode !== 0) fail(`Blender exited ${p.exitCode}`);
if (!existsSync(`${out}/build.json`)) fail(`Blender finished without writing dist/heroes/${slug}/build.json`);

const result = parseBuildResult(readFileSync(`${out}/build.json`, 'utf8'));
console.log(formatSummary(slug, result));
const bad = budgetViolations(tier, result);
if (bad.length) fail(bad.map((b) => `${slug}: ${b}`).join('\n'));
