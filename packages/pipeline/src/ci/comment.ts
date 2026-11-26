/** First line of the CI shots comment; used to find and update the same comment on every run. */
export const COMMENT_MARKER = '<!-- ktm-ci-shots -->';

export function shotKey(pr: number, file: string): string {
  return `shots/pr-${pr}/${file.slice(file.lastIndexOf('/') + 1)}`;
}

export function commentBody(pr: number, baseUrl: string, shots: string[], validateLog: string): string {
  const images = shots.map((f) => `![${f}](${baseUrl}${shotKey(pr, f)})`);
  const log = validateLog.trim();
  return [
    COMMENT_MARKER,
    '### Tile shots',
    '',
    ...(images.length ? images : ['_no shots_']),
    '',
    '### Validate',
    '',
    log ? '```\n' + log + '\n```' : '_no validate output_',
    '',
  ].join('\n');
}
