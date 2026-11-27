import type { TileId } from '@ktm/geo';
import { VehicleType } from '@ktm/schema';
export type View = 'follow' | 'iso' | 'street';
export interface Config {
  worldBase: string; tile: TileId; spawn?: { x: number; z: number }; view: View; timeOfDay: number; freeze: boolean;
  /** Start already driving a vehicle of this type. */
  vehicle?: VehicleType;
  /** Hold the throttle for a few seconds from ready (scripted checks). */
  autodrive: boolean;
  /** Ambient traffic; off with `traffic=0`. */
  traffic: boolean;
  /** `tile=` was in the URL (otherwise `tile` is the default). */
  tileGiven: boolean;
  /** Debug: accept this mission id at ready and spawn at its start (missions/debug.ts). */
  mission?: string;
}

export function readConfig(search: string, worldBase: string): Config {
  const q = new URLSearchParams(search);
  const [hh = '16', mm = '30'] = (q.get('t') ?? '16:30').split(':');
  const view = q.get('view');
  const vehicle = VehicleType.safeParse(q.get('vehicle'));
  return {
    worldBase,
    tile: (q.get('tile') as TileId | null) ?? 'x14_y17',
    spawn: q.has('x') && q.has('z') ? { x: Number(q.get('x')), z: Number(q.get('z')) } : undefined,
    view: view === 'iso' || view === 'street' ? view : 'follow',
    timeOfDay: Number(hh) + Number(mm) / 60,
    freeze: q.get('freeze') === '1',
    vehicle: vehicle.success ? vehicle.data : undefined,
    autodrive: q.get('autodrive') === '1',
    traffic: q.get('traffic') !== '0',
    tileGiven: q.has('tile'),
    mission: q.get('mission') || undefined,
  };
}
