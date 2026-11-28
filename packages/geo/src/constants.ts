/** Kathmandu Valley bounding box, WGS84 degrees. */
export const BBOX = { west: 85.19, south: 27.58, east: 85.55, north: 27.82 } as const;
/** Projection origin: center of BBOX. World (0, y, 0) is here. */
export const ORIGIN = { lon: 85.37, lat: 27.7 } as const;
/** World Y = elevation (m above sea level) - BASE_ELEVATION_M. */
export const BASE_ELEVATION_M = 1300;
export const TILE_SIZE_M = 800;
/** Heightmap vertices per tile side (65 -> 12.5 m spacing). */
export const HEIGHTMAP_N = 65;
/** Bump when any artifact format or generator changes; part of inputsHash. */
export const PIPELINE_VERSION = 3;
