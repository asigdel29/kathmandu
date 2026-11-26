import { ORIGIN } from './constants.ts';

const DEG = Math.PI / 180;

/** Meters per degree of latitude/longitude at a latitude (series expansion of the WGS84 ellipsoid). */
export function metersPerDegree(latDeg: number): { lat: number; lon: number } {
  const p = latDeg * DEG;
  const lat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  const lon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  return { lat, lon };
}

/** Evaluated once at ORIGIN. Every package uses these constants; nobody recomputes per point. */
export const M_PER_DEG = metersPerDegree(ORIGIN.lat);

/** World XZ in meters. x = east, z = -north (three.js, Y up). */
export interface LocalXZ { x: number; z: number }

export function lonLatToLocal(lon: number, lat: number): LocalXZ {
  return { x: (lon - ORIGIN.lon) * M_PER_DEG.lon, z: -((lat - ORIGIN.lat) * M_PER_DEG.lat) };
}

export function localToLonLat(x: number, z: number): { lon: number; lat: number } {
  return { lon: ORIGIN.lon + x / M_PER_DEG.lon, lat: ORIGIN.lat - z / M_PER_DEG.lat };
}
