import type { VehicleType } from '@ktm/schema';

/** Share of each vehicle type in ambient traffic. */
export const SPAWN_MIX: readonly (readonly [VehicleType, number])[] = [
  ['motorbike', 0.3], ['taxi', 0.25], ['micro', 0.15], ['tempo', 0.1], ['truck', 0.1], ['bus', 0.1],
];

/** Narrowest carriageway (m) a type is spawned on or routed onto; nav widths are 4 (living street) to 10 (secondary). */
export const MIN_ROAD_WIDTH_M: Record<VehicleType, number> = { motorbike: 0, taxi: 0, tempo: 4.5, micro: 6, truck: 8, bus: 8 };

/** Type for a uniform draw r in [0, 1) on a road `width` metres wide: the mix restricted to types that fit, renormalised. */
export function pickVehicleType(r: number, width: number): VehicleType {
  let total = 0;
  for (const [t, w] of SPAWN_MIX) if (MIN_ROAD_WIDTH_M[t] <= width) total += w;
  let x = r * total;
  let last: VehicleType = 'motorbike';
  for (const [t, w] of SPAWN_MIX) {
    if (MIN_ROAD_WIDTH_M[t] > width) continue;
    last = t;
    if (x < w) return t;
    x -= w;
  }
  return last;
}

/** Wheel spin angle after rolling at `speed` m/s for `dt` s: the previous angle plus distance / radius, kept within [-PI, PI]. */
export function spinStep(angle: number, speed: number, dt: number, radius: number): number {
  const a = angle + (speed * dt) / radius;
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

export const MAX_STEER_RAD = 0.55;

/** Front wheel angle (left positive) that follows a path turning at `yawRate` rad/s at `speed` m/s (bicycle model), clamped. */
export function steerAngle(wheelbase: number, yawRate: number, speed: number): number {
  const a = Math.atan((wheelbase * yawRate) / Math.max(Math.abs(speed), 1));
  return Math.max(-MAX_STEER_RAD, Math.min(MAX_STEER_RAD, a));
}
