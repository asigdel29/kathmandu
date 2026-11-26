import { expect, it } from 'vitest';
import { scopeViolations } from './scope.ts';
it('tile PRs may touch only their own tile directory', () => {
  expect(scopeViolations(['world/tiles/x14_y17/overrides.json', 'world/tiles/x14_y17/tile.md'], ['tile'])).toEqual([]);
  expect(scopeViolations(['world/tiles/x14_y17/overrides.json', 'world/tiles/x15_y17/overrides.json'], ['tile'])).toHaveLength(1);
  expect(scopeViolations(['world/tiles/x14_y17/overrides.json', 'packages/pipeline/src/cli.ts'], ['tile'])).toEqual(['packages/pipeline/src/cli.ts']);
  expect(scopeViolations(['world/heroes/swayambhunath/build.py', 'world/heroes/swayambhunath/hero.json'], ['hero'])).toEqual([]);
  expect(scopeViolations(['apps/game/src/main.ts'], ['gamedev'])).toEqual([]);
});
