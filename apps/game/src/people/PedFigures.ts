import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { pedWalkScale, WALK_CLIP, WALK_CLIP_FEMALE, type GaitClip } from '../player/locomotion.ts';

/** Character models in public/models/characters: ped_0 man, ped_1 woman, ped_2 man, ped_3 schoolgirl. */
export const FIGURE_VARIANTS = 4;
/** Figures in the pool when the caller does not say otherwise. */
export const FIGURE_POOL_DEFAULT = 40;
/** A person keeps their figure until they are this much farther than the boundary distance, m. */
export const FIGURE_HYSTERESIS_M = 5;
/** Below this speed (m/s) a walking person is shown standing. */
export const WALK_THRESHOLD_MPS = 0.15;
/** Seconds to cross-fade between the walk and idle clips. */
export const FADE_S = 0.2;

export interface XZ { x: number; z: number }

/** Clip set of a loaded model, the shape of a GLTF result. */
export interface GltfLike { scene: THREE.Object3D; animations: THREE.AnimationClip[] }

/** Where a person is and how they move; y is the ground height under their feet. */
export interface FigurePose {
  x: number; y: number; z: number;
  /** Heading, rotation about +Y (forward = (sin yaw, cos yaw)). */
  yaw: number;
  vx: number; vz: number;
  /** Walking speed the person is planned for, m/s. */
  speed: number;
  stopped: boolean;
}

export interface FigurePerson extends FigurePose { id: number }

/** Model variant of a person: id % 4, so the same person always has the same look. */
export function variantOf(id: number): number {
  return ((id % FIGURE_VARIANTS) + FIGURE_VARIANTS) % FIGURE_VARIANTS;
}

/** The odd variants (ped_1, ped_3) are women and use the shorter female stride. */
export function walkClipOf(variant: number): GaitClip {
  return variant % 2 === 1 ? WALK_CLIP_FEMALE : WALK_CLIP;
}

/** Playback scale of the walk clip for a person walking at `speed` m/s, so their feet stay planted. */
export function walkScale(speed: number, variant: number): number {
  return pedWalkScale(speed, walkClipOf(variant));
}

/**
 * Deterministic offset in [0, 1) for an id, from an integer hash. `channel` separates independent offsets for the same
 * person (channel 0 for the walk cycle, 1 for the idle cycle).
 */
export function phaseOf(id: number, channel = 0): number {
  let h = (Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  h = ((h ^ (h >>> 16)) >>> 0);
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = ((h ^ (h >>> 15)) >>> 0);
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = ((h ^ (h >>> 16)) >>> 0);
  return h / 2 ** 32;
}

/**
 * The ids that get a figure: the n nearest to the player, where someone who already has one ranks as if they were
 * FIGURE_HYSTERESIS_M closer. Ties are broken by id so the result is stable.
 */
export function pickFigures(people: readonly { id: number; x: number; z: number }[], player: XZ, n: number, current: ReadonlySet<number>): Set<number> {
  const picked = new Set<number>();
  if (n <= 0) return picked;
  const ranked = people.map((p) => ({
    id: p.id,
    key: Math.hypot(p.x - player.x, p.z - player.z) - (current.has(p.id) ? FIGURE_HYSTERESIS_M : 0),
  }));
  ranked.sort((a, b) => a.key - b.key || a.id - b.id);
  for (const r of ranked.slice(0, n)) picked.add(r.id);
  return picked;
}

function isMoving(pose: FigurePose): boolean {
  return !pose.stopped && Math.hypot(pose.vx, pose.vz) >= WALK_THRESHOLD_MPS;
}

function findClip(model: GltfLike, name: string): THREE.AnimationClip {
  const clip = model.animations.find((c) => c.name === name);
  if (!clip) throw new Error(`character model has no '${name}' clip`);
  return clip;
}

/**
 * One animated person: a skinned clone of a character model with its own mixer, an idle and a walk action. The walk
 * action plays at the person's speed and cross-fades with idle when the person stops.
 */
export class PedFigure {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private walk: THREE.AnimationAction;
  private idle: THREE.AnimationAction;
  private weight = 0;

  constructor(model: GltfLike, readonly variant: number) {
    this.root = cloneSkinned(model.scene);
    this.root.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.SkinnedMesh) { o.frustumCulled = false; o.castShadow = true; }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.walk = this.mixer.clipAction(findClip(model, 'walk'), this.root);
    this.idle = this.mixer.clipAction(findClip(model, 'idle'), this.root);
    this.walk.play();
    this.idle.play();
  }

  /** 0 standing, 1 walking; moves towards the target over FADE_S. */
  get walkWeight(): number { return this.weight; }

  /** Give the figure to a person: their gait and idle cycles start at offsets derived from the id. */
  assign(id: number, pose: FigurePose): void {
    this.walk.time = phaseOf(id, 0) * this.walk.getClip().duration;
    this.idle.time = phaseOf(id, 1) * this.idle.getClip().duration;
    this.weight = isMoving(pose) ? 1 : 0;
    this.applyWeights();
    this.root.visible = true;
  }

  /** Advance the animation by dt seconds and place the figure at the pose. */
  update(dt: number, pose: FigurePose): void {
    const step = Math.max(0, dt) / FADE_S;
    const target = isMoving(pose) ? 1 : 0;
    this.weight = target > this.weight ? Math.min(target, this.weight + step) : Math.max(target, this.weight - step);
    this.applyWeights();
    const scale = Number.isFinite(pose.speed) && pose.speed > 0 ? walkScale(pose.speed, this.variant) : 0;
    this.walk.timeScale = scale;
    this.idle.timeScale = 1;
    this.mixer.update(Math.max(0, dt));
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
  }

  hide(): void { this.root.visible = false; }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
  }

  private applyWeights(): void {
    this.walk.setEffectiveWeight(this.weight);
    this.idle.setEffectiveWeight(1 - this.weight);
  }
}

/** Base URL of the public folder: Vite's BASE_URL when running in the app, '/' otherwise (tests). */
export function figureBaseUrl(): string {
  return import.meta.env?.BASE_URL ?? '/';
}

export function figureUrl(base: string, variant: number): string {
  return `${base}models/characters/ped_${variant}.glb`;
}

/**
 * Pool of animated figures for the people nearest the player. The four character models are loaded on first use,
 * asynchronously; people whose model is not loaded yet are drawn as capsules. A figure is held by its person while
 * they stay near (see pickFigures) and returns to the pool when they leave.
 */
export class FigurePool {
  private models: (GltfLike | undefined)[] = [];
  private free: PedFigure[][] = Array.from({ length: FIGURE_VARIANTS }, () => []);
  private assigned = new Map<number, PedFigure>();
  private gltf = new GLTFLoader();
  private started = false;
  private warned = false;
  private disposed = false;

  constructor(private scene: THREE.Object3D, readonly size: number, private base: string = figureBaseUrl()) {}

  /** Whether a person currently has a figure (and so must not be drawn as a capsule). */
  has(id: number): boolean { return this.assigned.has(id); }

  get count(): number { return this.assigned.size; }

  /** Start loading the four models. Each failed load logs one warning for the pool; the others still load. */
  startLoading(): void {
    if (this.started || this.size <= 0) return;
    this.started = true;
    for (let v = 0; v < FIGURE_VARIANTS; v++) {
      const url = figureUrl(this.base, v);
      this.gltf.loadAsync(url).then((g) => {
        if (this.disposed) return;
        this.models[v] = { scene: g.scene, animations: g.animations };
      }, (e: unknown) => {
        if (this.warned) return;
        this.warned = true;
        console.warn(`pedestrian figures unavailable (${url}): ${e instanceof Error ? e.message : String(e)}; using capsules`);
      });
    }
  }

  /** Assign and release figures for the current people, then pose every figure. */
  update(dt: number, people: readonly FigurePerson[], player: XZ): void {
    this.startLoading();
    const ready = people.filter((a) => this.models[variantOf(a.id)] !== undefined);
    const want = pickFigures(ready, player, this.size, new Set(this.assigned.keys()));
    for (const id of [...this.assigned.keys()]) if (!want.has(id)) this.release(id);
    for (const a of ready) if (want.has(a.id) && !this.assigned.has(a.id)) this.acquire(a);
    for (const a of people) this.assigned.get(a.id)?.update(dt, a);
  }

  dispose(): void {
    this.disposed = true;
    for (const fig of [...this.assigned.values(), ...this.free.flat()]) fig.dispose();
    this.assigned.clear();
    for (const list of this.free) list.length = 0;
    for (const m of this.models) {
      m?.scene.traverse((o: THREE.Object3D) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.models = [];
  }

  private acquire(a: FigurePerson): void {
    const v = variantOf(a.id);
    const model = this.models[v];
    if (!model) return;
    const fig = this.free[v]!.pop() ?? new PedFigure(model, v);
    if (!fig.root.parent) this.scene.add(fig.root);
    fig.assign(a.id, a);
    this.assigned.set(a.id, fig);
  }

  private release(id: number): void {
    const fig = this.assigned.get(id);
    if (!fig) return;
    this.assigned.delete(id);
    fig.hide();
    this.free[fig.variant]!.push(fig);
  }
}
