import { describe, expect, it } from 'vitest';
import { Hero, Nav, Overrides, PropsFile } from './world.ts';

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
  it('accepts shutter and wires, and an optional pitch only on request', () => {
    const p = PropsFile.parse({ props: [{ type: 'shutter', x: 0, y: 0, z: 0 }, { type: 'wires', x: 0, y: 8, z: 0, pitch: 0.1, scale: 1.02 }] });
    expect(p.props[0]).not.toHaveProperty('pitch');
    expect(p.props[1]!.pitch).toBe(0.1);
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
