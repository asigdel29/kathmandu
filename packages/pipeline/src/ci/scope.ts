/** Files a PR with the given labels is not allowed to touch. Unlabelled / code PRs are unrestricted. */
export function scopeViolations(files: string[], labels: string[]): string[] {
  const kind = labels.includes('tile') ? 'tiles' : labels.includes('hero') ? 'heroes' : undefined;
  if (!kind) return [];
  const re = new RegExp(`^world/${kind}/([^/]+)/[^/]+$`);
  const owners = new Set(files.map((f) => re.exec(f)?.[1]).filter(Boolean));
  if (owners.size > 1) return [`multiple ${kind}: ${[...owners].join(', ')}`];
  return files.filter((f) => !re.test(f));
}
