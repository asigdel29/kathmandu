/**
 * Locomotion blending for the character models (public/models/characters/*.glb).
 *
 * The clips are authored in place, at fixed ground speeds: the planted foot slides back at `speed` m/s. To avoid foot
 * sliding the shared gait phase advances at `rate` cycles per second chosen so that the blended stride (metres per
 * cycle, weighted by the clip weights) times `rate` equals the actual ground speed.
 */

export interface GaitClip {
  /** Ground speed the clip is authored for, m/s (planted-foot slope measured by tools/characters/build.py). */
  speed: number;
  /** One loop, seconds. */
  duration: number;
}

/**
 * Measured on the exported rig (height scale 0.93), see public/models/characters/characters.json.
 * walk = Walk_Loop, run = Jog_Fwd_Loop (the pack has no clip between a stroll and a jog).
 */
export const WALK_CLIP: GaitClip = { speed: 0.908, duration: 1.3333 };
export const RUN_CLIP: GaitClip = { speed: 5.672, duration: 0.9333 };
/** The female bodies are 4 % shorter in the leg: their stride is shorter at the same cycle time. */
export const WALK_CLIP_FEMALE: GaitClip = { speed: 0.874, duration: 1.3333 };

export interface Blend {
  /** Clip weights, summing to 1. */
  idle: number; walk: number; run: number;
  /** Gait cycles per second to advance the shared phase (0 when idle). */
  rate: number;
  /** Playback scale of the walk clip at this speed (rate x its duration), for tuning and tests. */
  walkScale: number;
}

/** Below this speed (m/s) the character is standing. */
export const STAND_SPEED = 0.05;
/** Gait rate never drops below this multiple of the walk clip's own rate while moving, so slow steps do not freeze. */
const MIN_WALK_SCALE = 0.4;
/** ...nor rises above this multiple of the jog clip's own rate. */
const MAX_RUN_SCALE = 1.5;

export function locomotionBlend(speed: number, walk: GaitClip = WALK_CLIP, run: GaitClip = RUN_CLIP): Blend {
  const v = Math.max(0, speed);
  if (v < STAND_SPEED) return { idle: 1, walk: 0, run: 0, rate: 0, walkScale: 0 };
  const strideWalk = walk.speed * walk.duration;
  const strideRun = run.speed * run.duration;
  let idle = 0; let wWalk = 0; let wRun = 0; let rate: number;
  if (v < walk.speed) {
    // Idle fades into the walk; the walk clip plays slower than authored, down to MIN_WALK_SCALE.
    const t = v / walk.speed;
    wWalk = t; idle = 1 - t;
    rate = Math.max(MIN_WALK_SCALE, t) / walk.duration;
  } else if (v < run.speed) {
    // Walk fades into the jog; the cycle rate follows from the blended stride length.
    const t = (v - walk.speed) / (run.speed - walk.speed);
    wRun = t; wWalk = 1 - t;
    rate = v / (wWalk * strideWalk + wRun * strideRun);
  } else {
    wRun = 1;
    rate = Math.min(MAX_RUN_SCALE / run.duration, v / strideRun);
  }
  return { idle, walk: wWalk, run: wRun, rate, walkScale: rate * walk.duration };
}

/**
 * Playback scale for a walking pedestrian at `speed` m/s using the walk clip alone (no blending): the clip's authored
 * ground speed divided into the real one, so the feet stay planted.
 */
export function pedWalkScale(speed: number, walk: GaitClip = WALK_CLIP): number {
  return speed / walk.speed;
}
