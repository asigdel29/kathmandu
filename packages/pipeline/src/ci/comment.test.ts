import { expect, it } from 'vitest';
import { COMMENT_MARKER, commentBody, shotKey } from './comment.ts';

it('keys shots under shots/pr-<n>/ in the bucket', () => {
  expect(shotKey(12, 'dist/shots/x14_y17-iso.png')).toBe('shots/pr-12/x14_y17-iso.png');
});

it('renders one image per shot and the validate summary under a stable marker', () => {
  const body = commentBody(12, 'https://world.example/', ['x14_y17-iso.png', 'x14_y17-street.png'], 'OK x14_y17\n');
  expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  expect(body).toContain('![x14_y17-iso.png](https://world.example/shots/pr-12/x14_y17-iso.png)');
  expect(body).toContain('![x14_y17-street.png](https://world.example/shots/pr-12/x14_y17-street.png)');
  expect(body).toContain('```\nOK x14_y17\n```');
});

it('says so when there is no validate output', () => {
  expect(commentBody(3, 'https://w/', [], '')).toContain('no validate output');
});
