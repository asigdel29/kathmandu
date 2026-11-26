/** Intelligent Driver Model parameters: minimum gap s0 (m), time headway T (s), max accel a and comfortable decel b (m/s^2). */
export interface IdmParams { s0: number; T: number; a: number; b: number; delta: number }
export const IDM: IdmParams = { s0: 2, T: 1.5, a: 1.5, b: 2.5, delta: 4 };

/** Hardest deceleration the model may ask for, m/s^2. */
export const EMERGENCY_DECEL = 9;
/** Distance always kept to the leader's bumper by idmStep, m. */
const MIN_CLEARANCE = 0.1;

/**
 * IDM acceleration. v: own speed, v0: desired speed (the edge limit), gap: bumper-to-bumper distance to the leader in m
 * (Infinity when the road ahead is free), dv: approach rate v - vLeader. Clamped to >= -EMERGENCY_DECEL.
 */
export function idmAccel(v: number, v0: number, gap: number, dv: number, p: IdmParams = IDM): number {
  if (gap <= 0) return -EMERGENCY_DECEL;
  if (v0 <= 0) return v > 0 ? -p.b : 0;
  const free = 1 - (Math.max(0, v) / v0) ** p.delta;
  if (gap === Infinity) return Math.max(-EMERGENCY_DECEL, p.a * free);
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  return Math.max(-EMERGENCY_DECEL, p.a * (free - (sStar / gap) ** 2));
}

/**
 * Advance one vehicle by dt (ballistic update). Speed stays in [0, vMax]; the distance travelled is never negative,
 * never more than vMax * dt and, when a gap is given, never more than gap - 0.1 m.
 */
export function idmStep(v: number, accel: number, dt: number, vMax: number, gap = Infinity): { v: number; ds: number } {
  let nv = v + accel * dt;
  let ds: number;
  if (nv < 0) {
    // Comes to rest inside the step.
    ds = accel < 0 ? (v * v) / (2 * -accel) : 0;
    nv = 0;
  } else {
    ds = v * dt + 0.5 * accel * dt * dt;
  }
  const cap = Math.max(0, vMax);
  if (nv > cap) nv = cap;
  ds = Math.min(Math.max(0, ds), cap * dt, Math.max(0, gap - MIN_CLEARANCE));
  return { v: nv, ds: Number.isFinite(ds) ? ds : 0 };
}
