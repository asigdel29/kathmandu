export interface XZ { x: number; z: number }

/** Unit right-hand perpendicular (-dz, dx) of a travel direction; for eastbound (1, 0) that is +z = south. Zero for a zero direction. */
export function rightPerp(dx: number, dz: number): XZ {
  const len = Math.hypot(dx, dz);
  if (len === 0) return { x: 0, z: 0 };
  return { x: -dz / len + 0, z: dx / len + 0 };
}

/**
 * Lane centre at fraction t along a -> b when travelling a -> b. Kathmandu drives on the left, so the lane sits a
 * quarter of the carriageway width to the left of the centreline: centre - (width / 4) * rightPerp.
 */
export function laneCentre(a: XZ, b: XZ, t: number, width: number): XZ {
  const r = rightPerp(b.x - a.x, b.z - a.z);
  const q = width / 4;
  return { x: a.x + (b.x - a.x) * t - q * r.x + 0, z: a.z + (b.z - a.z) * t - q * r.z + 0 };
}
