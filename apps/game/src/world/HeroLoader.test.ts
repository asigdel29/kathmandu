import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BASE_ELEVATION_M, lonLatToLocal } from '@ktm/geo';
import { Manifest } from '@ktm/schema';
import { HERO_SPAWN_OFFSET_M, HeroLoader, applyHeroTransform, heroModelUrl, heroSpawn, heroTransform } from './HeroLoader.ts';

const SHA = 'a'.repeat(64);
const BASE = 'https://example.com/world/';
const manifest = Manifest.parse({
  version: 1, generatedAt: '2026-11-26T12:00:00Z', tileSize: 800, baseUrl: BASE,
  grid: { cols: 45, rows: 34, xMin: -17753.85, zMax: 13297.75 }, tiles: {},
  heroes: { swayambhu: { tile: 'x12_y18', url: `${BASE}heroes/swayambhu/${SHA}/model.glb`, sha256: SHA, lat: 27.7149, lon: 85.2904, rotationDeg: 30, scale: 2 } },
});
const hero = manifest.heroes.swayambhu!;
const anchor = lonLatToLocal(hero.lon, hero.lat);

describe('heroTransform', () => {
  it('places the model at the anchor on the terrain', () => {
    const t = heroTransform(hero, () => 1420.5);
    expect(t.position.x).toBeCloseTo(anchor.x, 3);
    expect(t.position.z).toBeCloseTo(anchor.z, 3);
    expect(t.position.y).toBeCloseTo(1420.5 - BASE_ELEVATION_M, 6);
    expect(t.rotationY).toBe(-30 * Math.PI / 180);
    expect(t.scale).toBe(2);
  });
  it('falls back to base elevation when height is unknown', () => {
    expect(heroTransform(hero, () => undefined).position.y).toBe(0);
  });
  it('passes the anchor to heightAt', () => {
    const h = vi.fn((_x: number, _z: number) => 1300);
    heroTransform(hero, h);
    expect(h.mock.calls[0]![0]).toBeCloseTo(anchor.x, 3);
    expect(h.mock.calls[0]![1]).toBeCloseTo(anchor.z, 3);
  });
});

describe('applyHeroTransform', () => {
  it('sets position, rotation and scale on a group', () => {
    const g = new THREE.Group();
    applyHeroTransform(g, heroTransform(hero, () => 1420.5));
    expect(g.position.x).toBeCloseTo(anchor.x, 3);
    expect(g.position.y).toBeCloseTo(120.5, 3);
    expect(g.position.z).toBeCloseTo(anchor.z, 3);
    expect(g.rotation.y).toBeCloseTo(-30 * Math.PI / 180, 12);
    expect(g.scale.x).toBe(2); expect(g.scale.y).toBe(2); expect(g.scale.z).toBe(2);
  });
});

describe('heroSpawn / heroModelUrl', () => {
  it('spawns south of the anchor', () => {
    const s = heroSpawn(hero);
    expect(s.x).toBeCloseTo(anchor.x, 6);
    expect(s.z).toBeCloseTo(anchor.z + HERO_SPAWN_OFFSET_M, 6);
    expect(HERO_SPAWN_OFFSET_M).toBe(60);
  });
  it('builds the published model url', () => {
    expect(heroModelUrl(BASE, 'swayambhu', SHA)).toBe(`${BASE}heroes/swayambhu/${SHA}/model.glb`);
  });
});

describe('HeroLoader', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('warns once and adds nothing when the model is missing', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new THREE.Scene();
    const loader = new HeroLoader(scene, BASE, manifest, () => 1400);
    const loaded = new Map([['x12_y18', {}]]);
    await expect(loader.update(loaded)).resolves.toBeUndefined();
    await expect(loader.update(loaded)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(heroModelUrl(BASE, 'swayambhu', SHA));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('swayambhu');
    expect(scene.children).toHaveLength(0);
    expect(loader.get('swayambhu')).toBeUndefined();
  });

  it('skips heroes whose tile is not loaded or whose height is unknown', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const scene = new THREE.Scene();
    await new HeroLoader(scene, BASE, manifest, () => 1400).update(new Map([['x01_y01', {}]]));
    await new HeroLoader(scene, BASE, manifest, () => undefined).update(new Map([['x12_y18', {}]]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns once on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new HeroLoader(new THREE.Scene(), BASE, manifest, () => 1400);
    const loaded = new Map([['x12_y18', {}]]);
    await loader.update(loaded); await loader.update(loaded);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('places a loaded model, drops it when its tile unloads, and ignores results for unloaded tiles', async () => {
    const gltf = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'body' }] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(gltf, { status: 200 })));
    const scene = new THREE.Scene();
    const loader = new HeroLoader(scene, BASE, manifest, () => 1420.5);
    await loader.update(new Map([['x12_y18', {}]]));
    const g = loader.get('swayambhu')!;
    expect(g.name).toBe('hero:swayambhu');
    expect(g.parent).toBe(scene);
    expect(g.position.x).toBeCloseTo(anchor.x, 3);
    expect(g.position.y).toBeCloseTo(120.5, 3);
    expect(g.rotation.y).toBeCloseTo(-30 * Math.PI / 180, 12);
    await loader.update(new Map());
    expect(loader.get('swayambhu')).toBeUndefined();
    expect(scene.children).toHaveLength(0);
    const p = loader.update(new Map([['x12_y18', {}]]));
    void loader.update(new Map());
    await p;
    expect(loader.get('swayambhu')).toBeUndefined();
    expect(scene.children).toHaveLength(0);
    await loader.update(new Map([['x12_y18', {}]]));
    expect(loader.get('swayambhu')?.parent).toBe(scene);
  });
});
