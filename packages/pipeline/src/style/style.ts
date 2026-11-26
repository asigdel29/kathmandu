import zones from '../../../../world/style/zones.json';
import styles from '../../../../world/style/building-styles.json';
import { lonLatToLocal } from '@ktm/geo';

export type Zone = keyof typeof styles.mix;
export type Style = (typeof styles.styles)[number];

export function zoneAt(lon: number, lat: number, elevationM: number): Zone {
  const p = lonLatToLocal(lon, lat);
  for (const c of zones.circles) {
    const q = lonLatToLocal(c.lon, c.lat);
    if (Math.hypot(p.x - q.x, p.z - q.z) <= c.radiusM) return c.id as Zone;
  }
  return elevationM > zones.hillsAboveM ? 'hills' : 'suburb';
}

export function defaultLevels(zone: Zone): number { return styles.defaultLevels[zone]; }
export function styleIndex(s: Style): number { return styles.styles.indexOf(s); }

const INSTITUTIONAL = new Set(['school', 'college', 'university', 'hospital', 'clinic', 'townhall', 'courthouse', 'police', 'government']);

/** h in [0,1) from hash01(feature id). nearCommercialRoad: within 40 m of trunk/primary/secondary. */
export function pickStyle(tags: Record<string, string | boolean>, zone: Zone, nearCommercialRoad: boolean, h: number): Style {
  const b = String(tags.building ?? '');
  if (b === 'temple' || b === 'shrine' || b === 'monastery' || b === 'stupa' || tags.amenity === 'place_of_worship' || tags.historic) return 'temple_brick';
  if (INSTITUTIONAL.has(String(tags.amenity)) || b === 'school' || b === 'hospital' || b === 'government' || b === 'public') return 'institutional';
  if (b === 'industrial' || b === 'warehouse' || b === 'shed' || b === 'hut' || b === 'roof') return 'tin_shed';
  if (b === 'commercial' || b === 'retail' || b === 'office' || b === 'hotel') return h < 0.6 ? 'commercial_glass' : 'rcc_plaster_white';
  const mixZone: Zone = nearCommercialRoad && !zone.endsWith('-core') ? 'commercial' : zone;
  let acc = 0;
  for (const [style, w] of Object.entries(styles.mix[mixZone])) { acc += w; if (h < acc) return style as Style; }
  return 'rcc_plaster_white';
}
