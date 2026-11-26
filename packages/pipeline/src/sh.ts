export function sh(cmd: string[], opts: { cwd?: string } = {}): void {
  const p = Bun.spawnSync(cmd, { cwd: opts.cwd, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(' ')} exited ${p.exitCode}`);
}
export function shOut(cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'inherit' });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(' ')} exited ${p.exitCode}`);
  return p.stdout.toString();
}
