import type { TileId } from '@ktm/geo';
import { VehicleType } from '@ktm/schema';
export type View = 'follow' | 'iso' | 'street';
export interface Config {
  worldBase: string; tile: TileId; spawn?: { x: number; z: number }; view: View; timeOfDay: number; freeze: boolean;
  /** Start already driving a vehicle of this type. */
  vehicle?: VehicleType;
  /** Hold the throttle for a few seconds from ready (scripted checks). */
  autodrive: boolean;
  /** Start facing this hero landmark (manifest slug). */
  hero?: string;
}

export function readConfig(search: string, worldBase: string): Config {
  const q = new URLSearchParams(search);
  const [hh = '16', mm = '30'] = (q.get('t') ?? '16:30').split(':');
  const view = q.get('view');
  const vehicle = VehicleType.safeParse(q.get('vehicle'));
  const hero = q.get('hero');
  return {
    worldBase,
    tile: (q.get('tile') as TileId | null) ?? 'x14_y17',
    spawn: q.has('x') && q.has('z') ? { x: Number(q.get('x')), z: Number(q.get('z')) } : undefined,
    view: view === 'iso' || view === 'street' ? view : 'follow',
    timeOfDay: Number(hh) + Number(mm) / 60,
    freeze: q.get('freeze') === '1',
    vehicle: vehicle.success ? vehicle.data : undefined,
    autodrive: q.get('autodrive') === '1',
    hero: hero && /^[a-z0-9-]+$/.test(hero) ? hero : undefined,
  };
}
