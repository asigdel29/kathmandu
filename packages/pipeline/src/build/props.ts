import type { Prop } from '@ktm/schema';
export type XZ = [number, number];

/** Points every `every` meters along a polyline, offset perpendicular (positive = right of travel when seen from +Y, i.e. +z for eastbound). */
export function alongPolyline(pts: XZ[], every: number, offset: number, yAt: (x: number, z: number) => number, type: Prop['type'] = 'streetlight'): Prop[] {
  const out: Prop[] = [];
  let carry = every / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az); if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = -dz, nz = dx; // right-hand perpendicular in XZ: for dx=1,dz=0 -> (0, 1) = +z
    for (let d = carry; d <= len; d += every) {
      const x = ax + dx * d + nx * offset, z = az + dz * d + nz * offset;
      out.push({ type, x, y: yAt(x, z), z, rotY: Math.atan2(dx, dz), scale: 1 });
    }
    carry = ((carry - len) % every + every) % every;
  }
  return out;
}

export function pointInRing([px, pz]: XZ, ring: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Roof clutter: water tank on 60 % of RCC roofs (h >= 0.4), rebar stubs on unfinished roofs (up to 4 corners). */
export function roofProps(ring: XZ[], roofY: number, style: string, h: number): Prop[] {
  const out: Prop[] = [];
  const n = ring.length; let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x / n; cz += z / n; }
  if (style.startsWith('rcc') && h >= 0.4) {
    const v = ring[Math.floor(h * n) % n]!;
    const x = cx + (v[0] - cx) * 0.4, z = cz + (v[1] - cz) * 0.4;
    if (pointInRing([x, z], ring)) out.push({ type: 'water_tank', x, y: roofY, z, rotY: h * 6.283, scale: 1 });
  }
  if (style === 'rcc_unfinished') {
    for (let k = 0; k < Math.min(4, n); k++) { const v = ring[Math.floor((k / 4) * n)]!; out.push({ type: 'rebar', x: cx + (v[0] - cx) * 0.85, y: roofY, z: cz + (v[1] - cz) * 0.85, rotY: 0, scale: 1 }); }
  }
  return out;
}

/** Trees in a green ring on a 12 m jittered grid, thinned by hash. */
export function treesInRing(ring: XZ[], yAt: (x: number, z: number) => number, hash: (s: string) => number, seed: string, density = 0.5): Prop[] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const out: Prop[] = [];
  for (let x = minX; x < maxX; x += 12) for (let z = minZ; z < maxZ; z += 12) {
    const h = hash(`${seed}:${x.toFixed(0)}:${z.toFixed(0)}`);
    if (h > density) continue;
    const px = x + (h * 97 % 1) * 8, pz = z + (h * 31 % 1) * 8;
    if (pointInRing([px, pz], ring)) out.push({ type: 'tree', x: px, y: yAt(px, pz), z: pz, rotY: h * 6.283, scale: 0.8 + h * 0.6 });
  }
  return out;
}
