import { tileId, tileIndexAt } from '@ktm/geo';
import type { Mission, VehicleType } from '@ktm/schema';
import type { Config } from '../config.ts';

/** The vehicle a debug `?mission=` run starts in, by mission type; on foot when absent. */
const VEHICLE_FOR: Partial<Record<Mission['type'], VehicleType>> = { taxi: 'taxi', delivery: 'motorbike', race: 'motorbike' };
/** Steps closer than this to the start are not worth facing (a pickup at the spawn point). */
const FACE_MIN_M = 20;

export interface DebugMission {
  config: Config;
  mission: Mission | undefined;
  /** Where the camera should face at spawn: the first step away from the start. */
  lookAt?: { x: number; z: number };
  warning?: string;
}

/**
 * `?mission=<id>`: spawn at the mission start (unless x/z are given), stream the tile under the spawn
 * (unless tile is given), start in a vehicle that suits the mission (unless vehicle is given). main.ts
 * accepts the mission once the world is ready.
 */
export function resolveDebugMission(config: Config, missions: readonly Mission[]): DebugMission {
  if (!config.mission) return { config, mission: undefined };
  const mission = missions.find((m) => m.id === config.mission);
  if (!mission) return { config, mission: undefined, warning: `unknown mission "${config.mission}"` };
  const spawn = config.spawn ?? { ...mission.start };
  const { i, j } = tileIndexAt(spawn.x, spawn.z);
  const face = mission.steps.find((s) => Math.hypot(s.x - spawn.x, s.z - spawn.z) > FACE_MIN_M);
  return {
    config: {
      ...config,
      spawn,
      tile: config.tileGiven ? config.tile : tileId(i, j),
      vehicle: config.vehicle ?? VEHICLE_FOR[mission.type],
    },
    mission,
    lookAt: face ? { x: face.x, z: face.z } : undefined,
  };
}
