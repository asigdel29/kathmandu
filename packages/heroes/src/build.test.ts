import { expect, it } from 'vitest';
import { BLENDER_DEFAULT, MAX_GLB_BYTES, TRIANGLE_BUDGET, blenderCommand, budgetViolations, formatSummary, parseBuildArgs, parseBuildResult, parseTier } from './build.ts';

it('knows the triangle budget of each tier', () => {
  expect(TRIANGLE_BUDGET).toEqual({ A: 150_000, B: 60_000, C: 25_000 });
  expect(MAX_GLB_BYTES).toBe(8 * 1024 * 1024);
});

it('parses the build arguments', () => {
  expect(parseBuildArgs(['build', 'swayambhunath'])).toEqual({ slug: 'swayambhunath' });
  expect(() => parseBuildArgs([])).toThrow(/usage/);
  expect(() => parseBuildArgs(['upload', 'x'])).toThrow(/usage/);
  expect(() => parseBuildArgs(['build'])).toThrow(/usage/);
  expect(() => parseBuildArgs(['build', 'a', 'b'])).toThrow(/usage/);
  expect(() => parseBuildArgs(['build', '../etc'])).toThrow(/slug/);
  expect(() => parseBuildArgs(['build', 'Bad_Slug'])).toThrow(/slug/);
});

it('reads the tier from hero.json', () => {
  expect(parseTier({ tier: 'B' })).toBe('B');
  expect(() => parseTier({ tier: 'D' })).toThrow(/tier/);
  expect(() => parseTier({})).toThrow(/tier/);
  expect(() => parseTier(null)).toThrow(/tier/);
});

it('flags triangle and size overruns', () => {
  expect(budgetViolations('A', { triangles: 150_000, bytes: MAX_GLB_BYTES, sha256: 'a' })).toEqual([]);
  expect(budgetViolations('C', { triangles: 25_001, bytes: 10, sha256: 'a' })).toEqual(['25,001 triangles exceed the tier C budget of 25,000']);
  expect(budgetViolations('B', { triangles: 1, bytes: MAX_GLB_BYTES + 1, sha256: 'a' })).toEqual([`${(MAX_GLB_BYTES + 1).toLocaleString('en-US')} bytes exceed the 8 MB limit`]);
  expect(budgetViolations('C', { triangles: 30_000, bytes: 9 * 1024 * 1024, sha256: 'a' })).toHaveLength(2);
});

it('validates build.json', () => {
  expect(parseBuildResult('{"triangles":39986,"bytes":100,"sha256":"' + 'a'.repeat(64) + '"}')).toEqual({ triangles: 39986, bytes: 100, sha256: 'a'.repeat(64) });
  expect(() => parseBuildResult('{"triangles":"x","bytes":1,"sha256":"a"}')).toThrow(/build\.json/);
  expect(() => parseBuildResult('{"triangles":1,"bytes":1,"sha256":"nothex"}')).toThrow(/build\.json/);
  expect(() => parseBuildResult('not json')).toThrow(/build\.json/);
});

it('prints the summary line', () => {
  expect(formatSummary('swayambhunath', { triangles: 39986, bytes: 1234567, sha256: 'b2ef' })).toBe('swayambhunath: 39986 triangles, 1234567 bytes, sha256 b2ef');
});

it('builds the Blender command line', () => {
  expect(BLENDER_DEFAULT).toBe('/Applications/Blender.app/Contents/MacOS/Blender');
  expect(blenderCommand('stupa', '/repo', {})).toEqual([BLENDER_DEFAULT, '-b', '--factory-startup', '-P', '/repo/packages/heroes/src/run.py', '--', 'stupa']);
  expect(blenderCommand('stupa', '/repo', { BLENDER: '/opt/blender' })[0]).toBe('/opt/blender');
});
