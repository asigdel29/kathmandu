import { describe, expect, it } from 'vitest';
import { Hero, Mission, Nav, Overrides, PropsFile } from './world.ts';

describe('Overrides', () => {
  it('fills defaults and is strict', () => {
    const o = Overrides.parse({ zone: 'old-core', buildings: { a246912: { levels: 4, style: 'newari_brick' } } });
    expect(o.roads).toEqual({});
    expect(() => Overrides.parse({ buildings: { a1: { floors: 3 } } })).toThrow();
  });
});
describe('PropsFile', () => {
  it('defaults rotY and scale', () => {
    const p = PropsFile.parse({ props: [{ type: 'streetlight', x: 1, y: 2, z: 3 }] });
    expect(p.props[0]).toMatchObject({ rotY: 0, scale: 1 });
  });
});
describe('Nav', () => {
  it('requires quantised world ids', () => {
    expect(() => Nav.parse({ nodes: [{ id: 'bad', x: 0, y: 0, z: 0, border: false }], edges: [] })).toThrow();
    expect(Nav.parse({ nodes: [{ id: 'n_-621385_-47650', x: 0, y: 0, z: 0, border: true }], edges: [] }).nodes).toHaveLength(1);
  });
});
describe('Hero', () => {
  it('accepts a hero without a model yet', () => {
    const h = Hero.parse({ slug: 'swayambhunath', name: 'Swayambhunath Stupa', tier: 'A', lat: 27.7149, lon: 85.2904, footprint: [[85.29, 27.714], [85.291, 27.714], [85.291, 27.715]] });
    expect(h.rotationDeg).toBe(0);
  });
});
describe('Mission', () => {
  const base = { id: 'a-b', title: 'T', type: 'photo', start: { x: 0, z: 0 }, rewardText: 'r' };
  it('accepts wait seconds and a clock window on steps', () => {
    const m = Mission.parse({ ...base, steps: [
      { kind: 'wait', x: 1, z: 2, waitS: 10, text: 'Wait' },
      { kind: 'photo', x: 1, z: 2, radius: 30, window: { fromH: 17, toH: 19 }, text: 'Photo' },
    ] });
    expect(m.steps[0]).toMatchObject({ radius: 8, waitS: 10 });
    expect(m.steps[1]!.window).toEqual({ fromH: 17, toH: 19 });
  });
  it('requires waitS on wait steps and rejects unknown keys', () => {
    expect(() => Mission.parse({ ...base, steps: [{ kind: 'wait', x: 1, z: 2, text: 'Wait' }] })).toThrow();
    expect(() => Mission.parse({ ...base, steps: [{ kind: 'goto', x: 1, z: 2, text: 'Go', wait: 3 }] })).toThrow();
    expect(() => Mission.parse({ ...base, steps: [{ kind: 'goto', x: 1, z: 2, text: 'Go', window: { fromH: 25, toH: 1 } }] })).toThrow();
  });
});
