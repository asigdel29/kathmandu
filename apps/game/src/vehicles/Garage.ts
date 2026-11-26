import type { Prop, VehicleType } from '@ktm/schema';

/** Pure placement helpers for parked vehicles; no three.js or Rapier here. */

interface XZ { x: number; z: number }
export interface Spawn { type: VehicleType; x: number; z: number; yaw: number }

export const SPAWN_CYCLE: readonly VehicleType[] = ['tempo', 'taxi', 'motorbike'];
export const FALLBACK_DISTANCE_M = 15;
const FALLBACK_SPREAD_M = 4;

/** Heading from one point toward another, with forward = (sin yaw, 0, cos yaw); 0 when they coincide. */
export function yawTowards(from: XZ, to: XZ): number {
  const dx = to.x - from.x; const dz = to.z - from.z;
  return dx * dx + dz * dz < 1e-8 ? 0 : Math.atan2(dx, dz);
}

/**
 * One vehicle of each type when a tile has no taxi_spawn props: on a 15 m arc behind the spawn
 * (away from the look-at, so a vehicle started at the spawn drives clear of them), a few metres apart, facing the look-at.
 */
export function fallbackSpawns(start: XZ, lookAt: XZ, distance = FALLBACK_DISTANCE_M): Spawn[] {
  const yaw = yawTowards(start, lookAt);
  const back = yaw + Math.PI;
  const da = FALLBACK_SPREAD_M / distance;
  return SPAWN_CYCLE.map((type, i) => {
    const a = back + (i - 1) * da;
    return { type, x: start.x + Math.sin(a) * distance, z: start.z + Math.cos(a) * distance, yaw };
  });
}

/** taxi_spawn props of the given tiles in world space, nearest first (at most `max`), types cycling tempo, taxi, motorbike. */
export function propSpawns(tiles: readonly { origin: XZ; props: readonly Prop[] }[], near: XZ, max = 24): Spawn[] {
  const pts: { x: number; z: number; yaw: number; d: number }[] = [];
  for (const t of tiles) for (const p of t.props) {
    if (p.type !== 'taxi_spawn') continue;
    const x = t.origin.x + p.x; const z = t.origin.z + p.z;
    pts.push({ x, z, yaw: p.rotY, d: (x - near.x) ** 2 + (z - near.z) ** 2 });
  }
  pts.sort((a, b) => a.d - b.d);
  return pts.slice(0, max).map((p, i) => ({ type: SPAWN_CYCLE[i % SPAWN_CYCLE.length]!, x: p.x, z: p.z, yaw: p.yaw }));
}

/** The item whose position is closest to pos on the ground plane, if within radius metres. */
export function nearestWithin<T extends { position: XZ }>(pos: XZ, items: Iterable<T>, radius: number): T | undefined {
  let best: T | undefined; let bestD = radius * radius;
  for (const it of items) {
    const d = (it.position.x - pos.x) ** 2 + (it.position.z - pos.z) ** 2;
    if (d <= bestD) { bestD = d; best = it; }
  }
  return best;
}

export const MAX_FRAME_S = 0.25;

/**
 * Fixed-step accumulator: how many `step`-sized substeps to run this frame and the carried remainder.
 * The frame time is clamped to `maxFrame` (0.25 s by default); past `maxSteps` the backlog is dropped so a slow frame cannot spiral.
 */
export function fixedSteps(acc: number, frameDt: number, step: number, maxSteps: number, maxFrame = MAX_FRAME_S): { steps: number; acc: number } {
  let a = acc + Math.min(Math.max(frameDt, 0), maxFrame);
  let steps = Math.floor(a / step + 1e-9);
  a -= steps * step;
  if (steps > maxSteps) { steps = maxSteps; a = a % step; }
  return { steps, acc: Math.max(0, a) };
}
