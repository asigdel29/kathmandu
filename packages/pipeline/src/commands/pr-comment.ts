import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { PATHS } from '../paths.ts';
import { shOut } from '../sh.ts';
import { COMMENT_MARKER, commentBody, shotKey } from '../ci/comment.ts';
import { requireBaseUrl } from './manifest.ts';
import { BUCKET } from './upload.ts';

function wranglerCmd(): string[] { return (process.env.WRANGLER ?? 'wrangler').split(' ').filter(Boolean); }

/** Uploads dist/shots/*.png to shots/pr-<n>/ and creates or updates one PR comment with the images and the validate log. */
export async function run(args: string[]): Promise<void> {
  const pr = Number(args[0]);
  if (!Number.isInteger(pr) || pr <= 0) throw new Error('usage: bun run pipeline pr-comment <pr-number>');
  const baseUrl = requireBaseUrl(process.env.WORLD_BASE_URL);
  const dir = PATHS.shots;
  const shots = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
  for (const f of shots) {
    const p = Bun.spawnSync([...wranglerCmd(), 'r2', 'object', 'put', `${BUCKET}/${shotKey(pr, f)}`, '--remote', '--file', `${dir}/${f}`, '--content-type', 'image/png', '--cache-control', 'no-cache'], { stdout: 'ignore', stderr: 'inherit' });
    if (p.exitCode !== 0) throw new Error(`upload failed: ${f}`);
    console.log(`put ${shotKey(pr, f)}`);
  }
  const logPath = `${PATHS.dist}/validate.log`;
  const body = commentBody(pr, baseUrl, shots, existsSync(logPath) ? readFileSync(logPath, 'utf8') : '');
  const ids = shOut(['gh', 'api', `repos/{owner}/{repo}/issues/${pr}/comments`, '--paginate', '--jq', `.[] | select(.body | startswith("${COMMENT_MARKER}")) | .id`]).split('\n').filter(Boolean);
  if (ids.length) shOut(['gh', 'api', '-X', 'PATCH', `repos/{owner}/{repo}/issues/comments/${ids[0]}`, '-f', `body=${body}`]);
  else shOut(['gh', 'api', '-X', 'POST', `repos/{owner}/{repo}/issues/${pr}/comments`, '-f', `body=${body}`]);
  console.log(`pr-comment: ${ids.length ? 'updated' : 'created'} comment on #${pr} with ${shots.length} shots`);
}
