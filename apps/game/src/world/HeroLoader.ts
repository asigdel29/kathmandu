import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BASE_ELEVATION_M, lonLatToLocal } from '@ktm/geo';
import type { Manifest, ManifestHero } from '@ktm/schema';

export interface HeroTransform { position: { x: number; y: number; z: number }; rotationY: number; scale: number }
export type HeightFn = (worldX: number, worldZ: number) => number | undefined;

/** Pure placement: x,z = lonLatToLocal(lon, lat); y = (heightAt(x,z) ?? BASE_ELEVATION_M) - BASE_ELEVATION_M; rotationY = -rotationDeg*PI/180; scale. */
export function heroTransform(hero: Pick<ManifestHero, 'lat' | 'lon' | 'rotationDeg' | 'scale'>, heightAt: HeightFn): HeroTransform {
  const { x, z } = lonLatToLocal(hero.lon, hero.lat);
  const y = (heightAt(x, z) ?? BASE_ELEVATION_M) - BASE_ELEVATION_M;
  return { position: { x, y, z }, rotationY: -hero.rotationDeg * Math.PI / 180, scale: hero.scale };
}

/** Spawn point 60 m south of the anchor: { x, z: z + 60 }. */
export const HERO_SPAWN_OFFSET_M = 60;
export function heroSpawn(hero: Pick<ManifestHero, 'lat' | 'lon'>): { x: number; z: number } {
  const { x, z } = lonLatToLocal(hero.lon, hero.lat);
  return { x, z: z + HERO_SPAWN_OFFSET_M };
}

export function heroModelUrl(worldBase: string, slug: string, sha256: string): string { return `${worldBase}heroes/${slug}/${sha256}/model.glb`; }

export function applyHeroTransform(obj: { position: { set(x: number, y: number, z: number): unknown }; rotation: { y: number }; scale: { setScalar(s: number): unknown } }, t: HeroTransform): void {
  obj.position.set(t.position.x, t.position.y, t.position.z);
  obj.rotation.y = t.rotationY;
  obj.scale.setScalar(t.scale);
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  group.removeFromParent();
}

export class HeroLoader {
  private gltf = new GLTFLoader();
  private placed = new Map<string, THREE.Group>();
  private inFlight = new Set<string>();
  private failed = new Set<string>();
  private loaded: ReadonlyMap<string, unknown> = new Map();
  constructor(private scene: THREE.Scene, private worldBase: string, private manifest: Manifest, private heightAt: HeightFn) {}

  /** Starts loading every hero whose manifest `tile` is in `loaded` and whose anchor height is available (heightAt not undefined); removes+disposes heroes whose tile is no longer loaded (they may load again later). Returns a promise that settles when the loads started by this call have finished (never rejects). */
  update(loaded: ReadonlyMap<string, unknown>): Promise<void> {
    this.loaded = loaded;
    for (const [slug, g] of this.placed) if (!loaded.has(this.manifest.heroes[slug]!.tile)) { disposeGroup(g); this.placed.delete(slug); }
    const started: Promise<void>[] = [];
    for (const [slug, hero] of Object.entries(this.manifest.heroes)) {
      if (!loaded.has(hero.tile) || this.placed.has(slug) || this.inFlight.has(slug) || this.failed.has(slug)) continue;
      const a = lonLatToLocal(hero.lon, hero.lat);
      if (this.heightAt(a.x, a.z) === undefined) continue;
      started.push(this.load(slug, hero));
    }
    return Promise.all(started).then(() => undefined);
  }

  /** The placed group for a slug, if loaded. */
  get(slug: string): THREE.Group | undefined { return this.placed.get(slug); }

  private async load(slug: string, hero: ManifestHero): Promise<void> {
    const url = heroModelUrl(this.worldBase, slug, hero.sha256);
    this.inFlight.add(slug);
    try {
      const r = await fetch(url);
      if (!r.ok) { this.failed.add(slug); console.warn(`hero ${slug}: HTTP ${r.status} ${url}`); return; }
      const model = (await this.gltf.parseAsync(await r.arrayBuffer(), '')).scene;
      const group = new THREE.Group(); group.name = `hero:${slug}`; group.add(model);
      if (!this.loaded.has(hero.tile)) { disposeGroup(group); return; }
      applyHeroTransform(group, heroTransform(hero, this.heightAt));
      group.traverse((m) => { if (m instanceof THREE.Mesh) { m.castShadow = true; m.receiveShadow = true; } });
      this.scene.add(group);
      this.placed.set(slug, group);
    } catch (e) {
      this.failed.add(slug); console.warn(`hero ${slug}: ${e instanceof Error ? e.message : String(e)} ${url}`);
    } finally {
      this.inFlight.delete(slug);
    }
  }
}
