import { shOut } from '../sh.ts';
import { scopeViolations } from '../ci/scope.ts';

function arg(args: string[], name: string): string | undefined {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : undefined;
}

/** bun run pipeline scope-check --labels '["tile"]' --base <sha> */
export async function run(args: string[]): Promise<void> {
  const labelsJson = arg(args, '--labels');
  const base = arg(args, '--base');
  if (!labelsJson || !base) throw new Error(`usage: bun run pipeline scope-check --labels '<json array>' --base <sha>`);
  const labels: unknown = JSON.parse(labelsJson);
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === 'string')) throw new Error(`--labels must be a JSON array of strings: ${labelsJson}`);
  const files = shOut(['git', 'diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
  const bad = scopeViolations(files, labels);
  if (bad.length) {
    console.error(`scope-check: ${bad.length} path(s) outside the allowed scope for labels ${labels.join(', ')}:`);
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
  console.log(`scope-check: OK (${files.length} files, labels: ${labels.join(', ') || 'none'})`);
}
