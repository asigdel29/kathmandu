import type { Mission, MissionStep } from '@ktm/schema';

export type MissionStatus = 'idle' | 'active' | 'done' | 'failed';
export type FailReason = 'timeout' | 'abandoned';

export interface MissionTick {
  /** Seconds since the previous tick. */
  dt: number;
  /** Player (or driven vehicle) world position. */
  x: number; z: number;
  /** Absolute speed, m/s. */
  speed: number;
  /** The photo key was pressed during this tick. */
  photo: boolean;
  /** Game clock, hours in [0, 24). */
  timeOfDay: number;
}

export type MissionEvent =
  | { kind: 'accepted' }
  | { kind: 'step'; index: number }
  | { kind: 'done'; elapsedS: number }
  | { kind: 'failed'; reason: FailReason; elapsedS: number };

/** Pickups and dropoffs need the player at or below this speed inside the radius. */
export const STOP_SPEED_MS = 2;

/** Inclusive start, exclusive end; a window with fromH > toH wraps past midnight. No window is always open. */
export function inWindow(timeOfDay: number, w: { fromH: number; toH: number } | undefined): boolean {
  if (!w) return true;
  const t = ((timeOfDay % 24) + 24) % 24;
  return w.fromH <= w.toH ? t >= w.fromH && t < w.toH : t >= w.fromH || t < w.toH;
}

export function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/** idle -> active(step i) -> done | failed. Pure: positions, speed, key presses and the clock come in through tick(). */
export class MissionFsm {
  private _status: MissionStatus = 'idle';
  private _step = -1;
  private _elapsed = 0;
  private _waited = 0;
  private _fail: FailReason | undefined;

  constructor(readonly mission: Mission) {}

  get status(): MissionStatus { return this._status; }
  /** -1 while idle, steps.length once done. */
  get stepIndex(): number { return this._step; }
  get step(): MissionStep | undefined { return this._status === 'active' ? this.mission.steps[this._step] : undefined; }
  get elapsedS(): number { return this._elapsed; }
  get remainingS(): number | undefined {
    const limit = this.mission.timeLimitS;
    return this._status === 'active' && limit !== undefined ? Math.max(0, limit - this._elapsed) : undefined;
  }
  get waitedS(): number { return this._waited; }
  get failReason(): FailReason | undefined { return this._fail; }

  distanceTo(x: number, z: number): number | undefined {
    const s = this.step;
    return s ? distanceXZ(x, z, s.x, s.z) : undefined;
  }

  accept(): MissionEvent[] {
    if (this._status === 'active') return [];
    this._status = 'active';
    this._step = 0;
    this._elapsed = 0;
    this._waited = 0;
    this._fail = undefined;
    return [{ kind: 'accepted' }, { kind: 'step', index: 0 }];
  }

  abandon(): MissionEvent[] {
    if (this._status !== 'active') return [];
    return [this.fail('abandoned')];
  }

  reset(): void {
    this._status = 'idle';
    this._step = -1;
    this._elapsed = 0;
    this._waited = 0;
    this._fail = undefined;
  }

  tick(t: MissionTick): MissionEvent[] {
    const s = this.step;
    if (!s) return [];
    this._elapsed += t.dt;
    const limit = this.mission.timeLimitS;
    if (limit !== undefined && this._elapsed > limit) return [this.fail('timeout')];

    const inside = distanceXZ(t.x, t.z, s.x, s.z) <= s.radius;
    let complete = false;
    switch (s.kind) {
      case 'goto': complete = inside; break;
      case 'pickup':
      case 'dropoff': complete = inside && t.speed <= STOP_SPEED_MS; break;
      case 'photo': complete = inside && t.photo; break;
      case 'wait':
        this._waited = inside ? this._waited + t.dt : 0;
        // The epsilon absorbs float drift from summing fixed steps (ten 0.1 s ticks sum to 0.9999...).
        complete = this._waited >= (s.waitS ?? 0) - 1e-9;
        break;
    }
    if (!complete || !inWindow(t.timeOfDay, s.window)) return [];

    this._waited = 0;
    this._step++;
    if (this._step >= this.mission.steps.length) {
      this._status = 'done';
      return [{ kind: 'done', elapsedS: this._elapsed }];
    }
    return [{ kind: 'step', index: this._step }];
  }

  private fail(reason: FailReason): MissionEvent {
    this._status = 'failed';
    this._fail = reason;
    return { kind: 'failed', reason, elapsedS: this._elapsed };
  }
}
