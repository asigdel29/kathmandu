/** Real seconds per game hour: 1 game hour per 2 real minutes. */
export const REAL_SECONDS_PER_GAME_HOUR = 120;
/** Sun elevation (degrees) at or above which night = 0. */
export const DAY_ELEVATION_DEG = 10;
/** Sun elevation (degrees) at or below which night = 1. */
export const NIGHT_ELEVATION_DEG = -5;

const HOURS_PER_DAY = 24;

const wrapHours = (t: number): number => {
  const w = t % HOURS_PER_DAY;
  return w < 0 ? w + HOURS_PER_DAY : w;
};

/** Sun elevation in radians for time of day t (hours); same curve as Sky.ts. */
export function sunElevation(t: number): number {
  const h = ((t - 12) / 12) * Math.PI;
  return Math.max(-0.2, Math.cos(h) * 1.2 - 0.2);
}

/** 0 when elevation >= 10 deg, 1 when <= -5 deg, linear in degrees between. */
export function nightAmount(t: number): number {
  const elevDeg = (sunElevation(t) * 180) / Math.PI;
  if (elevDeg >= DAY_ELEVATION_DEG) return 0;
  if (elevDeg <= NIGHT_ELEVATION_DEG) return 1;
  return (DAY_ELEVATION_DEG - elevDeg) / (DAY_ELEVATION_DEG - NIGHT_ELEVATION_DEG);
}

/** Game time of day in hours, advanced from wall-clock seconds. */
export class Clock {
  readonly frozen: boolean;
  private t: number;
  private userPaused = false;

  /** start: hours (e.g. 16.5), wrapped into [0,24). frozen clocks never advance. */
  constructor(start: number, opts: { frozen?: boolean } = {}) {
    this.t = wrapHours(start);
    this.frozen = opts.frozen ?? false;
  }

  get time(): number {
    return this.t;
  }

  get paused(): boolean {
    return this.frozen || this.userPaused;
  }

  togglePause(): void {
    this.userPaused = !this.userPaused;
  }

  /** Advance by realSeconds of wall time (no-op when paused/frozen); returns the new time. */
  advance(realSeconds: number): number {
    if (this.paused) return this.t;
    this.t = wrapHours(this.t + realSeconds / REAL_SECONDS_PER_GAME_HOUR);
    return this.t;
  }
}
