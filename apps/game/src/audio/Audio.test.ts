import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { AMBIENCES, ambienceForZone, crossfadeWeights, engineRate, nearestSource, nextBellDelay, templeCentroids, TempleSources, type Ambience, type Weights } from './Audio.ts';

const sum = (w: Weights) => AMBIENCES.reduce((s, a) => s + w[a], 0);

describe('ambienceForZone', () => {
  it('maps every zone to a bed', () => {
    for (const z of ['old-core', 'patan-core', 'bhaktapur-core', 'kirtipur-core'] as const) expect(ambienceForZone(z)).toBe('market');
    for (const z of ['commercial', 'suburb', 'industrial', 'airport'] as const) expect(ambienceForZone(z)).toBe('traffic');
    expect(ambienceForZone('hills')).toBe('wind');
    expect(ambienceForZone(undefined)).toBe('traffic');
  });
});

describe('crossfadeWeights', () => {
  it('always sums to 1 and stays in [0, 1] across random steps and zone switches', () => {
    let w: Weights = { market: 1, traffic: 0, wind: 0 };
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 2000; i++) {
      const target: Ambience = AMBIENCES[Math.floor(rand() * 3)]!;
      w = crossfadeWeights(w, target, rand() * 0.3, 0.5 + rand() * 3);
      expect(Math.abs(sum(w) - 1)).toBeLessThan(1e-9);
      for (const a of AMBIENCES) { expect(w[a]).toBeGreaterThanOrEqual(0); expect(w[a]).toBeLessThanOrEqual(1); }
    }
  });
  it('reaches the target bed after fadeS seconds', () => {
    let w: Weights = { market: 0.2, traffic: 0.5, wind: 0.3 };
    for (let t = 0; t < 2.01; t += 0.1) w = crossfadeWeights(w, 'wind', 0.1, 2);
    expect(w).toEqual({ market: 0, traffic: 0, wind: 1 });
  });
  it('moves part way for a short step and recovers from all-zero input', () => {
    const w = crossfadeWeights({ market: 1, traffic: 0, wind: 0 }, 'traffic', 0.5, 2);
    expect(w.traffic).toBeCloseTo(0.25);
    expect(w.market).toBeCloseTo(0.75);
    expect(crossfadeWeights({ market: 0, traffic: 0, wind: 0 }, 'market', 0.1)).toEqual({ market: 1, traffic: 0, wind: 0 });
  });
});

describe('engineRate', () => {
  it('idles at 0.8, rises monotonically and caps at 2', () => {
    expect(engineRate(0)).toBeCloseTo(0.8);
    let prev = engineRate(0);
    for (let s = 0.5; s <= 60; s += 0.5) {
      const r = engineRate(s);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r).toBeLessThanOrEqual(2);
      prev = r;
    }
    expect(engineRate(30)).toBeGreaterThan(1.5);
    expect(engineRate(-10)).toBe(engineRate(10));
    expect(engineRate(Number.NaN)).toBeCloseTo(0.8);
  });
});

describe('nextBellDelay', () => {
  it('is between 20 and 40 s', () => {
    expect(nextBellDelay(() => 0)).toBe(20);
    expect(nextBellDelay(() => 0.5)).toBe(30);
    const d = nextBellDelay(() => 0.9999);
    expect(d).toBeGreaterThan(39.9); expect(d).toBeLessThan(40);
    for (let i = 0; i < 100; i++) { const r = nextBellDelay(); expect(r).toBeGreaterThanOrEqual(20); expect(r).toBeLessThan(40); }
  });
});

describe('templeCentroids', () => {
  it('returns one centroid per temple and ignores other styles', () => {
    const pos: number[] = []; const sty: number[] = [];
    const add = (x: number, y: number, z: number, s: number) => { pos.push(x, y, z); sty.push(s); };
    // temple A around (102, 5, 102), temple B around (305, 0, 405), plus a brick house (style 0)
    add(101, 0, 101, 6); add(103, 10, 103, 6); add(101, 0, 103, 6); add(103, 10, 101, 6);
    add(304, 0, 404, 6); add(306, 0, 406, 6);
    add(200, 0, 200, 0); add(210, 0, 210, 0);
    const c = templeCentroids(pos, sty, 6, 20).sort((a, b) => a.x - b.x);
    expect(c).toHaveLength(2);
    expect(c[0]).toEqual({ x: 102, y: 5, z: 102 });
    expect(c[1]).toEqual({ x: 305, y: 0, z: 405 });
    expect(templeCentroids([0, 0, 0], [0])).toEqual([]);
  });
});

describe('TempleSources', () => {
  const tile = (id: string, ox: number, style: number) => {
    const group = new THREE.Group(); group.position.set(ox, 0, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([1, 0, 1, 3, 10, 3], 3));
    g.setAttribute('_style', new THREE.Float32BufferAttribute([style, style], 1));
    const mesh = new THREE.Mesh(g); group.add(mesh);
    return { id, buildings: [mesh] };
  };
  it('collects world-space sources per tile and drops unloaded tiles', () => {
    const t = new TempleSources();
    t.sync([tile('a', 800, 6), tile('b', 0, 0)]);
    expect(t.all).toHaveLength(1);
    expect(t.all[0]!.toArray()).toEqual([802, 5, 2]);
    t.sync([tile('b', 0, 0)]);
    expect(t.all).toHaveLength(0);
    t.sync([{ id: 'c', buildings: undefined }]);
    expect(t.all).toHaveLength(0);
  });
  it('reads interleaved position attributes as loaded from glb', () => {
    const t = new TempleSources();
    const g = new THREE.BufferGeometry();
    // xyz + one padding float per vertex, as a strided glb buffer view
    const buf = new THREE.InterleavedBuffer(new Float32Array([1, 0, 1, 9, 3, 10, 3, 9]), 4);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    g.setAttribute('_style', new THREE.Float32BufferAttribute([6, 6], 1));
    t.sync([{ id: 'd', buildings: [new THREE.Mesh(g)] }]);
    expect(t.all.map((v) => v.toArray())).toEqual([[2, 5, 2]]);
  });
});

describe('nearestSource', () => {
  it('picks the nearest source within 80 m', () => {
    const s = [new THREE.Vector3(90, 0, 0), new THREE.Vector3(0, 0, 50), new THREE.Vector3(0, 0, -30)];
    expect(nearestSource({ x: 0, y: 0, z: 0 }, s)).toBe(s[2]);
    expect(nearestSource({ x: 0, y: 0, z: 0 }, [s[0]!])).toBeUndefined();
    expect(nearestSource({ x: 0, y: 0, z: 0 }, [])).toBeUndefined();
  });
});
