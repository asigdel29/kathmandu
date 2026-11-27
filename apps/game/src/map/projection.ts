/** A north-up view of the world: (cx, cz) is drawn at the canvas centre. World axes: x = east, z = -north. */
export interface MapView { cx: number; cz: number; /** canvas pixels per world metre */ pxPerM: number; width: number; height: number }
export interface Px { px: number; py: number }
export interface XZ { x: number; z: number }

/** Minimap CSS size; the backing store is MINIMAP_PX square so it stays crisp on high-density screens. */
export const MINIMAP_CSS_PX = 200;
export const MINIMAP_PX = 400;
/** World distance from the player to the minimap edge (half the backing width). */
export const MINIMAP_RADIUS_M = 300;

/** Minimap view centred on the player: MINIMAP_RADIUS_M spans half the backing store, so 150 m is 100 px. */
export function minimapView(cx: number, cz: number): MapView {
  return { cx, cz, pxPerM: MINIMAP_PX / 2 / MINIMAP_RADIUS_M, width: MINIMAP_PX, height: MINIMAP_PX };
}

export function worldToMap(v: MapView, x: number, z: number): Px {
  return { px: v.width / 2 + (x - v.cx) * v.pxPerM, py: v.height / 2 + (z - v.cz) * v.pxPerM };
}

export function mapToWorld(v: MapView, px: number, py: number): XZ {
  return { x: v.cx + (px - v.width / 2) / v.pxPerM, z: v.cz + (py - v.height / 2) / v.pxPerM };
}

/** The view after dragging the content by (dxPx, dyPx): the world point under the pointer moves with it. */
export function panView(v: MapView, dxPx: number, dyPx: number): MapView {
  return { ...v, cx: v.cx - dxPx / v.pxPerM, cz: v.cz - dyPx / v.pxPerM };
}

/** Scale by `factor` (clamped to [minPxPerM, maxPxPerM]) keeping the world point under (px, py) fixed. */
export function zoomViewAt(v: MapView, px: number, py: number, factor: number, minPxPerM: number, maxPxPerM: number): MapView {
  const at = mapToWorld(v, px, py);
  const pxPerM = Math.min(maxPxPerM, Math.max(minPxPerM, v.pxPerM * factor));
  return { ...v, pxPerM, cx: at.x - (px - v.width / 2) / pxPerM, cz: at.z - (py - v.height / 2) / pxPerM };
}

/** Compass heading of a direction on the XZ plane, degrees clockwise from north in [0, 360). */
export function headingFromDirection(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  const d = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return d < 0 ? d + 360 : d;
}

/** Compass bearing from one world point to another, degrees clockwise from north in [0, 360). */
export function bearingDeg(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return headingFromDirection(toX - fromX, toZ - fromZ);
}
