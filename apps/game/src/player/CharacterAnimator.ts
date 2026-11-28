import * as THREE from 'three/webgpu';
import { locomotionBlend, WALK_CLIP, type Blend } from './locomotion.ts';

export type AnimState = 'ground' | 'takeoff' | 'air' | 'landing' | 'driving';

export interface AnimInput {
  /** Ground speed, m/s. */
  speed: number;
  /** Standing on the ground at the end of the step. */
  grounded: boolean;
  /** True on the step the jump impulse was applied. */
  jumpPressed: boolean;
  /** Seated in a vehicle. */
  driving: boolean;
}

export const CLIP_NAMES = ['idle', 'walk', 'run', 'jump_start', 'jump_loop', 'jump_land', 'drive'] as const;
export type ClipName = (typeof CLIP_NAMES)[number];
export type Weights = Record<ClipName, number>;

/** Clips that repeat; the others play once and hold their last pose. */
const LOOPING: ReadonlySet<ClipName> = new Set<ClipName>(['idle', 'walk', 'run', 'jump_loop', 'drive']);

/** Crossfade lengths, seconds. */
const TAKEOFF_FADE_S = 0.1;
const AIR_FADE_S = 0.1;
const LANDING_FADE_S = 0.1;
const GROUND_FADE_S = 0.15;
const DRIVE_FADE_S = 0.2;

function zeroWeights(): Weights {
  return { idle: 0, walk: 0, run: 0, jump_start: 0, jump_loop: 0, jump_land: 0, drive: 0 };
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

function wrap01(x: number): number {
  return x - Math.floor(x);
}

/**
 * Drives the character's clips from its movement state. Locomotion, jumps and the driving pose are separate
 * clip sets; every change is a crossfade between two weight vectors that each sum to 1, so the blend always sums to 1.
 * Actions run with timeScale 0 and their time is set here, which keeps walk and run phase-aligned.
 */
export class CharacterAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private readonly durations = zeroWeights();
  /** Playback time per clip, wrapped for loops and clamped for one-shot clips. */
  private readonly clipTime = zeroWeights();
  private readonly _weights = zeroWeights();
  private from = zeroWeights();
  private fadeDur = 0;
  private fadeT = 0;
  private _state: AnimState = 'ground';
  private _phase = 0;

  constructor(root: THREE.Object3D, clips: Readonly<Record<string, THREE.AnimationClip>>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const name of CLIP_NAMES) {
      const clip = clips[name];
      if (!clip) throw new Error(`CharacterAnimator: missing clip "${name}"`);
      const action = this.mixer.clipAction(clip, root);
      action.loop = LOOPING.has(name) ? THREE.LoopRepeat : THREE.LoopOnce;
      action.clampWhenFinished = true;
      action.timeScale = 0;
      action.play();
      this.actions.set(name, action);
      this.durations[name] = clip.duration;
    }
    this.from = zeroWeights();
    this._weights.idle = 1;
    this.writeWeights();
    this.writeTimes();
    this.mixer.update(0);
  }

  get state(): AnimState { return this._state; }
  /** Current effective weight of each clip; sums to 1 after a crossfade completes. */
  get weights(): Readonly<Weights> { return this._weights; }
  /** Shared gait phase in [0, 1). */
  get phase(): number { return this._phase; }

  update(dt: number, input: AnimInput): void {
    const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const speed = Number.isFinite(input.speed) ? Math.max(0, input.speed) : 0;
    const blend = locomotionBlend(speed);
    this._phase = wrap01(this._phase + blend.rate * h);
    this.advanceClips(h);

    if (input.driving) {
      if (this._state !== 'driving') this.enter('driving', DRIVE_FADE_S);
    } else {
      if (this._state === 'driving') this.enter(input.grounded ? 'ground' : 'air', DRIVE_FADE_S);
      this.advanceOnFoot(input, speed);
    }

    this.fadeT += h;
    const a = this.fadeDur > 0 ? clamp01(this.fadeT / this.fadeDur) : 1;
    const target = this.targetWeights(blend);
    for (const name of CLIP_NAMES) this._weights[name] = clamp01((1 - a) * this.from[name] + a * target[name]);
    this.writeWeights();
    this.writeTimes();
    this.mixer.update(0);
  }

  private advanceClips(h: number): void {
    for (const name of CLIP_NAMES) {
      const dur = this.durations[name];
      const t = this.clipTime[name] + h;
      this.clipTime[name] = LOOPING.has(name) ? t % dur : Math.min(t, dur);
    }
  }

  private advanceOnFoot(input: AnimInput, speed: number): void {
    const s = this._state;
    if (input.jumpPressed && (s === 'ground' || s === 'landing')) {
      this.enter('takeoff', TAKEOFF_FADE_S);
      return;
    }
    switch (s) {
      case 'ground':
        if (!input.grounded) this.enter('air', AIR_FADE_S);
        break;
      case 'takeoff':
        if (this.clipTime.jump_start >= this.durations.jump_start) this.enter('air', AIR_FADE_S);
        break;
      case 'air':
        if (input.grounded) this.enter('landing', LANDING_FADE_S);
        break;
      case 'landing':
        if (!input.grounded) this.enter('air', AIR_FADE_S);
        else if (this.clipTime.jump_land >= this.durations.jump_land || speed >= WALK_CLIP.speed) this.enter('ground', GROUND_FADE_S);
        break;
      case 'driving':
        break;
    }
  }

  /** Starts a crossfade from the weights currently rendered; one-shot clips restart from their first frame. */
  private enter(next: AnimState, fadeSeconds: number): void {
    this.from = { ...this._weights };
    this._state = next;
    this.fadeDur = fadeSeconds;
    this.fadeT = 0;
    if (next === 'takeoff') this.clipTime.jump_start = 0;
    if (next === 'landing') this.clipTime.jump_land = 0;
  }

  private targetWeights(blend: Blend): Weights {
    const w = zeroWeights();
    switch (this._state) {
      case 'ground': w.idle = blend.idle; w.walk = blend.walk; w.run = blend.run; break;
      case 'takeoff': w.jump_start = 1; break;
      case 'air': w.jump_loop = 1; break;
      case 'landing': w.jump_land = 1; break;
      case 'driving': w.drive = 1; break;
    }
    return w;
  }

  private writeWeights(): void {
    for (const name of CLIP_NAMES) this.actions.get(name)!.setEffectiveWeight(this._weights[name]);
  }

  private writeTimes(): void {
    for (const name of CLIP_NAMES) this.actions.get(name)!.time = this.clipTime[name];
    // The gait clips are positioned by the shared phase so that their feet stay in step with the blend.
    this.actions.get('walk')!.time = this._phase * this.durations.walk;
    this.actions.get('run')!.time = this._phase * this.durations.run;
  }
}
