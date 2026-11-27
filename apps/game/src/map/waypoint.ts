import { bearingDeg, type XZ } from './projection.ts';

/** The waypoint is cleared once the player is this close, m. */
export const WAYPOINT_REACHED_M = 15;

export interface WaypointInfo { distance: number; /** compass degrees from the player to the target */ bearing: number }

export class Waypoint {
  target?: XZ;

  set(x: number, z: number): void { this.target = { x, z }; }
  clear(): void { this.target = undefined; }

  /** Distance and bearing from (px, pz); undefined without a target or once it is reached (which clears it). */
  update(px: number, pz: number): WaypointInfo | undefined {
    const t = this.target;
    if (!t) return undefined;
    const distance = Math.hypot(t.x - px, t.z - pz);
    if (distance < WAYPOINT_REACHED_M) { this.target = undefined; return undefined; }
    return { distance, bearing: bearingDeg(px, pz, t.x, t.z) };
  }
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
