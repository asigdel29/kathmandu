export type Tier = 'A' | 'B' | 'C';
export interface BuildResult { triangles: number; bytes: number; sha256: string }

export const TRIANGLE_BUDGET: Record<Tier, number> = { A: 150_000, B: 60_000, C: 25_000 };
export const MAX_GLB_BYTES = 8 * 1024 * 1024;
export const BLENDER_DEFAULT = '/Applications/Blender.app/Contents/MacOS/Blender';

const n = (v: number): string => v.toLocaleString('en-US');

/** `build <slug>` -> the slug. */
export function parseBuildArgs(args: string[]): { slug: string } {
  const usage = 'usage: bun run heroes build <slug>';
  if (args[0] !== 'build' || args.length !== 2) throw new Error(usage);
  const slug = args[1]!;
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`invalid hero slug "${slug}" (lowercase letters, digits and dashes)`);
  return { slug };
}

export function parseTier(heroJson: unknown): Tier {
  const tier = typeof heroJson === 'object' && heroJson !== null ? (heroJson as { tier?: unknown }).tier : undefined;
  if (tier === 'A' || tier === 'B' || tier === 'C') return tier;
  throw new Error(`hero.json needs a tier of A, B or C (got ${JSON.stringify(tier)})`);
}

export function parseBuildResult(text: string): BuildResult {
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new Error('build.json is not valid JSON'); }
  const r = v as Partial<BuildResult> | null;
  if (!r || !Number.isInteger(r.triangles) || !Number.isInteger(r.bytes) || typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) {
    throw new Error(`build.json is malformed: ${text.slice(0, 200)}`);
  }
  return { triangles: r.triangles!, bytes: r.bytes!, sha256: r.sha256 };
}

export function budgetViolations(tier: Tier, r: BuildResult): string[] {
  const out: string[] = [];
  if (r.triangles > TRIANGLE_BUDGET[tier]) out.push(`${n(r.triangles)} triangles exceed the tier ${tier} budget of ${n(TRIANGLE_BUDGET[tier])}`);
  if (r.bytes > MAX_GLB_BYTES) out.push(`${n(r.bytes)} bytes exceed the 8 MB limit`);
  return out;
}

export function formatSummary(slug: string, r: BuildResult): string {
  return `${slug}: ${r.triangles} triangles, ${r.bytes} bytes, sha256 ${r.sha256}`;
}

export function blenderCommand(slug: string, root: string, env: Record<string, string | undefined>): string[] {
  return [env.BLENDER || BLENDER_DEFAULT, '-b', '--factory-startup', '-P', `${root}/packages/heroes/src/run.py`, '--', slug];
}
