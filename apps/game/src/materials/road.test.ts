import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { HEIGHTMAP_N } from '@ktm/geo';
import type { Nav } from '@ktm/schema';
import { meshHeightAt } from '../../../../packages/pipeline/src/build/flatten.ts';
import { ZEBRA_DEPTH_M, buildRoadMarkings, createRoadMaterials, meshY, roadMaterialFor, type MarkingGeometry, type RoadTextures } from './road.ts';

const tex = (): RoadTextures => ({ asphalt: new THREE.Texture(), dirt: new THREE.Texture(), cobble: new THREE.Texture() });
const flat = (h: number) => new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N).fill(h);

const node = (id: string, x: number, z: number) => ({ id, x, y: 0, z, border: false });
const edge = (from: string, to: string, cls: string, width = 10) => ({ from, to, lanes: 2, oneway: false, speed: 40, cls, width });
/** A 4-way junction at (400, 400) with 100 m arms; the east-west arms carry `ew`, the north-south ones `ns`. */
const cross = (ew: string, ns: string): Nav => ({
  nodes: [node('c', 400, 400), node('w', 300, 400), node('e', 500, 400), node('n', 400, 300), node('s', 400, 500)],
  edges: [edge('w', 'c', ew), edge('c', 'e', ew), edge('n', 'c', ns, 6), edge('c', 's', ns, 6)],
});

const facing = (g: MarkingGeometry): { up: number; down: number } => {
  let up = 0, down = 0;
  for (let i = 0; i < g.indices.length; i += 3) {
    const P = (k: number) => g.positions.slice(g.indices[i + k]! * 3, g.indices[i + k]! * 3 + 3);
    const a = P(0), b = P(1), c = P(2);
    // y component of (b - a) x (c - a)
    const ny = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!);
    if (ny > 0) up++; else down++;
  }
  return { up, down };
};

describe('road markings', () => {
  it('puts a zebra crossing on each primary/secondary arm of a 3+-way node', () => {
    expect(buildRoadMarkings(cross('primary', 'residential'), flat(1300)).crossings).toBe(2);
    expect(buildRoadMarkings(cross('secondary', 'secondary'), flat(1300)).crossings).toBe(4);
  });

  it('marks nothing on tertiary and smaller roads', () => {
    const m = buildRoadMarkings(cross('tertiary', 'residential'), flat(1300));
    expect(m.crossings).toBe(0);
    expect(m.zebra.indices).toHaveLength(0);
    expect(m.dash.indices).toHaveLength(0);
  });

  it('skips plain bends and dead ends (fewer than 3 edges)', () => {
    const nav: Nav = { nodes: [node('a', 100, 100), node('b', 200, 100), node('c', 300, 100)], edges: [edge('a', 'b', 'primary'), edge('b', 'c', 'primary')] };
    const m = buildRoadMarkings(nav, flat(1300));
    expect(m.crossings).toBe(0);
    expect(m.dash.indices.length).toBeGreaterThan(0);
  });

  it('lays each crossing 3 m deep along the road and across its full width, inside the carriageway', () => {
    const m = buildRoadMarkings(cross('primary', 'residential'), flat(1300));
    // East arm of the junction: x from the junction outwards, z across the 10 m road.
    const xs: number[] = [], zs: number[] = [];
    for (let i = 0; i < m.zebra.positions.length; i += 3) {
      const x = m.zebra.positions[i]!, z = m.zebra.positions[i + 2]!;
      if (x > 400) { xs.push(x); zs.push(z); }
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(ZEBRA_DEPTH_M, 6);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(400 - 5);
    expect(Math.max(...zs)).toBeLessThanOrEqual(400 + 5);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(8);
  });

  it('stops the dashes short of the junction', () => {
    const m = buildRoadMarkings(cross('primary', 'residential'), flat(1300));
    for (let i = 0; i < m.dash.positions.length; i += 3) {
      const x = m.dash.positions[i]!, z = m.dash.positions[i + 2]!;
      expect(Math.hypot(x - 400, z - 400)).toBeGreaterThan(5.5);
    }
  });

  it('faces every triangle up, sits on the road ribbon, and gives uv in metres', () => {
    const m = buildRoadMarkings(cross('primary', 'primary'), flat(1310));
    for (const g of [m.dash, m.zebra]) {
      expect(facing(g).down).toBe(0);
      expect(facing(g).up).toBeGreaterThan(0);
      for (let i = 1; i < g.positions.length; i += 3) expect(g.positions[i]).toBeGreaterThan(10.08);
    }
    const along = m.dash.uvs.filter((_, i) => i % 2 === 0);
    expect(Math.max(...along)).toBeGreaterThan(50);
  });

  it('samples terrain like the pipeline mesh does', () => {
    const hm = new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N).map((_, i) => 1300 + ((i * 7919) % 100) / 10);
    for (const [x, z] of [[0, 0], [13.2, 40.9], [399.9, 400.1], [799, 12.4], [250.5, 777.7]] as const) expect(meshY(hm, x, z) + 1300).toBeCloseTo(meshHeightAt(hm, x, z), 4);
  });
});

describe('road materials', () => {
  const mats = createRoadMaterials(tex());
  it('uses cobbles for paths in the *-core zones and dirt elsewhere', () => {
    for (const z of ['old-core', 'patan-core', 'bhaktapur-core', 'kirtipur-core']) expect(roadMaterialFor('path', z, mats)).toBe(mats.pathCobble);
    for (const z of ['commercial', 'suburb', 'hills', 'industrial', 'airport']) expect(roadMaterialFor('path', z, mats)).toBe(mats.pathDirt);
  });
  it('maps asphalt and unpaved by name and leaves unknown layers alone', () => {
    expect(roadMaterialFor('asphalt', 'suburb', mats)).toBe(mats.asphalt);
    expect(roadMaterialFor('unpaved', 'old-core', mats)).toBe(mats.unpaved);
    expect(roadMaterialFor('terrain', 'old-core', mats)).toBeUndefined();
  });
  it('draws the paint as depth-offset, non-depth-writing decals', () => {
    for (const m of [mats.dash, mats.zebra]) { expect(m.transparent).toBe(true); expect(m.depthWrite).toBe(false); expect(m.polygonOffset).toBe(true); }
  });
});
