export interface EdgeStyle { kind: 'road' | 'path'; color: string; /** stroke width in minimap backing pixels */ width: number; dash: number[] }

const FOOT = new Set(['footway', 'path', 'pedestrian', 'track', 'steps']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link']);
const MID = new Set(['secondary', 'tertiary', 'secondary_link', 'tertiary_link']);

const PATH: EdgeStyle = { kind: 'path', color: '#b8a98f', width: 3, dash: [3, 6] };
const ROAD_MAJOR: EdgeStyle = { kind: 'road', color: '#d4d4d4', width: 9, dash: [] };
const ROAD_MID: EdgeStyle = { kind: 'road', color: '#d4d4d4', width: 7, dash: [] };
const ROAD: EdgeStyle = { kind: 'road', color: '#d4d4d4', width: 5, dash: [] };

/** Map stroke for a nav edge by its OSM highway class: foot classes dotted, roads solid light grey. Shared objects; do not mutate. */
export function edgeStyle(cls: string): EdgeStyle {
  if (FOOT.has(cls)) return PATH;
  if (MAJOR.has(cls)) return ROAD_MAJOR;
  if (MID.has(cls)) return ROAD_MID;
  return ROAD;
}
