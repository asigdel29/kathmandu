import { describe, expect, it } from 'vitest';
import { Mission } from '@ktm/schema';
import { readConfig } from '../config.ts';
import { resolveDebugMission } from './debug.ts';

const mk = (id: string, type: string, steps: Array<[number, number]>) => Mission.parse({
  id, title: id, type, start: { x: -5786.4, z: -1589.4 }, rewardText: 'r',
  steps: steps.map(([x, z]) => ({ kind: 'goto', x, z, text: 'go' })),
});
const missions = [
  mk('fare', 'taxi', [[-5786.4, -1589.4], [-4462.9, 3009.5]]),
  mk('walk', 'photo', [[-5700, -1589.4]]),
  mk('lap', 'race', [[-5786.4, -1500]]),
];

describe('resolveDebugMission', () => {
  it('leaves the config alone without ?mission=', () => {
    const c = readConfig('?tile=x14_y17', '/world/');
    expect(resolveDebugMission(c, missions)).toEqual({ config: c, mission: undefined });
  });

  it('warns about an unknown id and carries on', () => {
    const c = readConfig('?mission=nope', '/world/');
    const r = resolveDebugMission(c, missions);
    expect(r.mission).toBeUndefined();
    expect(r.warning).toMatch(/nope/);
    expect(r.config).toEqual(c);
  });

  it('spawns at the mission start, on its tile, in a vehicle that suits the mission type', () => {
    const r = resolveDebugMission(readConfig('?mission=fare&autodrive=1', '/world/'), missions);
    expect(r.mission?.id).toBe('fare');
    expect(r.config).toMatchObject({ tile: 'x14_y18', spawn: { x: -5786.4, z: -1589.4 }, vehicle: 'taxi', autodrive: true });
    expect(resolveDebugMission(readConfig('?mission=lap', '/world/'), missions).config.vehicle).toBe('motorbike');
    expect(resolveDebugMission(readConfig('?mission=walk', '/world/'), missions).config.vehicle).toBeUndefined();
  });

  it('looks toward the first step that is away from the start', () => {
    expect(resolveDebugMission(readConfig('?mission=fare', '/world/'), missions).lookAt).toEqual({ x: -4462.9, z: 3009.5 });
    expect(resolveDebugMission(readConfig('?mission=walk', '/world/'), missions).lookAt).toEqual({ x: -5700, z: -1589.4 });
  });

  it('keeps explicit tile, spawn and vehicle params', () => {
    const r = resolveDebugMission(readConfig('?mission=fare&tile=x14_y17&x=1&z=2&vehicle=tempo', '/world/'), missions);
    expect(r.config).toMatchObject({ tile: 'x14_y17', spawn: { x: 1, z: 2 }, vehicle: 'tempo' });
  });
});
