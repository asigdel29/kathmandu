import type { OsmFeature } from './read.ts';

export type Kind = 'building' | 'road' | 'water' | 'green' | 'landuse' | 'poi' | 'place' | 'skip';

export const VEHICLE_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
export const FOOT_ROADS = new Set(['footway', 'path', 'pedestrian', 'track', 'steps']);
const PLACES = new Set(['city', 'town', 'suburb', 'neighbourhood', 'quarter', 'village', 'hamlet']);
const KEEP = ['building', 'building:levels', 'height', 'roof:shape', 'roof:colour', 'building:colour', 'name', 'name:ne', 'amenity', 'historic', 'tourism', 'shop', 'religion', 'addr:street', 'landuse', 'natural', 'leisure', 'highway', 'lanes', 'oneway', 'surface', 'maxspeed', 'width', 'place', 'man_made', 'aeroway', 'water', 'waterway', 'junction'];

const isArea = (g: string) => g === 'Polygon' || g === 'MultiPolygon';

export function isPoi(p: Record<string, string>): boolean {
  return Boolean(p.amenity === 'place_of_worship' || p.historic || p.tourism === 'attraction' || p.tourism === 'museum' || p.tourism === 'viewpoint'
    || p.man_made === 'tower' || p.aeroway === 'aerodrome' || p.amenity === 'bus_station' || p.amenity === 'hospital' || p.amenity === 'university'
    || p.amenity === 'marketplace' || p.amenity === 'cinema' || p.amenity === 'theatre' || p.leisure === 'stadium');
}

export function classify(f: OsmFeature): Kind {
  const p = f.properties; const g = f.geometry.type;
  if (p.building && p.building !== 'no' && isArea(g)) return 'building';
  if (p.highway && (VEHICLE_ROADS.has(p.highway) || FOOT_ROADS.has(p.highway)) && g === 'LineString') return 'road';
  if ((p.natural === 'water' || p.water || p.landuse === 'reservoir' || p.landuse === 'basin' || p.waterway === 'riverbank') && isArea(g)) return 'water';
  if ((p.leisure === 'park' || p.leisure === 'garden' || p.leisure === 'pitch' || p.landuse === 'grass' || p.landuse === 'forest' || p.landuse === 'farmland'
    || p.landuse === 'orchard' || p.landuse === 'meadow' || p.landuse === 'cemetery' || p.natural === 'wood' || p.natural === 'scrub' || p.natural === 'grassland') && isArea(g)) return 'green';
  if ((p.landuse === 'industrial' || p.landuse === 'commercial' || p.landuse === 'retail' || p.aeroway === 'aerodrome' || p.amenity === 'university' || p.amenity === 'hospital') && isArea(g)) return 'landuse';
  if (p.place && p.name && g === 'Point' && PLACES.has(p.place)) return 'place';
  if (g === 'Point' && p.name && isPoi(p)) return 'poi';
  return 'skip';
}

export function keepTags(p: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP) if (p[k] !== undefined) out[k] = p[k]!;
  return out;
}
