/**
 * Pure logic behind the post stack: quality tiers, the 2-second frame-time probe, idle tracking for the
 * depth-of-field and the amounts of the driving-speed blur. No three.js here, so it is unit-tested directly.
 */

export type Quality = 'low' | 'med' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'med', 'high'];

/** Seconds of frame times the automatic quality choice looks at. */
export const PROBE_SECONDS = 2;
/** Median frame time (ms) above which the next tier down is chosen. */
export const MED_ABOVE_MS = 20;
export const LOW_ABOVE_MS = 30;

/** Seconds standing still before the depth of field starts to fade in, and how long that fade takes. */
export const DOF_IDLE_S = 3;
export const DOF_FADE_S = 1;
/** Driving speed (km/h) above which the camera-rotation blur starts, and the speed at which it is full. */
export const MOTION_BLUR_FROM_KMH = 40;
export const MOTION_BLUR_FULL_KMH = 90;

export function parseQuality(v: string | null | undefined): Quality | undefined {
  return v === 'low' || v === 'med' || v === 'high' ? v : undefined;
}

/** Tier for a measured median frame time. The probe runs at `high`, so a slow average steps down. */
export function pickQuality(frameMs: number): Quality {
  if (frameMs > LOW_ABOVE_MS) return 'low';
  if (frameMs > MED_ABOVE_MS) return 'med';
  return 'high';
}

/**
 * Collects frame times until PROBE_SECONDS of wall time have passed, then reports their median once. The median
 * ignores the stalls of tile streaming and shader compiles that dominate the first frames.
 */
export class FrameProbe {
  private elapsed = 0;
  private times: number[] = [];
  private done = false;

  /** Returns the median frame time (ms) on the frame the probe completes, otherwise undefined. */
  add(frameMs: number): number | undefined {
    if (this.done) return undefined;
    this.times.push(frameMs);
    this.elapsed += frameMs / 1000;
    if (this.elapsed < PROBE_SECONDS) return undefined;
    this.done = true;
    const sorted = [...this.times].sort((x, y) => x - y);
    return sorted[sorted.length >> 1]!;
  }
}

/** Counts seconds without player or camera movement. */
export class IdleTracker {
  private idle = 0;
  get seconds(): number { return this.idle; }
  update(dt: number, moving: boolean): void { this.idle = moving ? 0 : this.idle + dt; }
}

const smooth = (t: number): number => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** Depth-of-field strength 0..1: zero while moving or driving, fades in once idle for DOF_IDLE_S. */
export function dofAmount(idleSeconds: number, driving: boolean, enabled = true): number {
  if (!enabled || driving) return 0;
  return smooth((idleSeconds - DOF_IDLE_S) / DOF_FADE_S);
}

/** Radial blur amount 0..1 from the driving speed; zero at or below MOTION_BLUR_FROM_KMH and when on foot. */
export function motionBlurAmount(speedKmh: number, driving: boolean): number {
  if (!driving) return 0;
  return smooth((speedKmh - MOTION_BLUR_FROM_KMH) / (MOTION_BLUR_FULL_KMH - MOTION_BLUR_FROM_KMH));
}

/** Wetness of the road surface: the ?wet=1 switch, or the night amount. */
export function wetness(forced: boolean, night: number): number {
  return Math.min(1, Math.max(forced ? 1 : 0, night));
}

/**
 * Thin-lens depth of field for a 50 mm lens at f/2.8: circle-of-confusion diameter (mm on the sensor) of a point
 * at `distanceM` when focused on `focusM`.
 */
export function circleOfConfusionMm(focusM: number, distanceM: number, focalMm = 50, fNumber = 2.8): number {
  const f = focalMm / 1000;
  const s = focusM; const d = distanceM;
  if (s <= f || d <= f) return 0;
  return (Math.abs(d - s) / d) * (f * f) / (fNumber * (s - f)) * 1000;
}
