import { z } from 'zod';

export const VehicleType = z.enum(['tempo', 'taxi', 'motorbike']);
export type VehicleType = z.infer<typeof VehicleType>;

/** Per-type driving and suspension tuning. Units: metres, kg, N, km/h, degrees. */
export const VehicleTuning = z.object({
  /** Visual wheel count. */
  wheels: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  maxSpeedKmh: z.number().positive(),
  /** Chassis box, metres. */
  width: z.number().positive(),
  length: z.number().positive(),
  height: z.number().positive(),
  massKg: z.number().positive(),
  /** Total engine force (N), split over the driven rear wheels. */
  engineForce: z.number().positive(),
  /** Per wheel. */
  brakeForce: z.number().positive(),
  /** Rear wheels only. */
  handbrakeForce: z.number().positive(),
  maxSteerDeg: z.number().positive().max(45),
  /** Steering limit starts easing toward 0 above this speed. */
  steerFadeStartKmh: z.number().nonnegative(),
  /** Steering limit reaches 0 at this speed; must exceed steerFadeStartKmh. */
  steerFadeEndKmh: z.number().positive(),
  wheelRadius: z.number().positive(),
  suspensionRestLength: z.number().positive(),
  suspensionStiffness: z.number().positive(),
  suspensionCompression: z.number().positive(),
  suspensionRelaxation: z.number().positive(),
  frictionSlip: z.number().positive(),
  /** Visual lean into turns; 0 for tempo and taxi. */
  leanMaxDeg: z.number().nonnegative().max(45),
}).strict().refine((t) => t.steerFadeEndKmh > t.steerFadeStartKmh, {
  message: 'steerFadeEndKmh must be greater than steerFadeStartKmh',
  path: ['steerFadeEndKmh'],
});
export type VehicleTuning = z.infer<typeof VehicleTuning>;

/** world/vehicles.json */
export const VehicleTunings = z.object({
  version: z.literal(1),
  vehicles: z.object({ tempo: VehicleTuning, taxi: VehicleTuning, motorbike: VehicleTuning }).strict(),
}).strict();
export type VehicleTunings = z.infer<typeof VehicleTunings>;
