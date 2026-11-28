import * as THREE from 'three/webgpu';
import { abs, attribute, float, fract, mix, mx_noise_float, positionWorld, smoothstep, step, texture, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { BASE_ELEVATION_M, HEIGHTMAP_N, HEIGHT_STEP } from '@ktm/geo';
import type { Nav } from '@ktm/schema';
import { loadRepeatingTexture, luminance3, macroNoise, sampleUntiled } from './terrain.ts';

type N = Node<'float'>;
type N2 = Node<'vec2'>;
type N3 = Node<'vec3'>;

export type RoadLayer = 'asphalt' | 'dirt' | 'cobble';
export const ROAD_TEXTURE_FILES: Record<RoadLayer, string> = { asphalt: 'road-asphalt.jpg', dirt: 'road-dirt.jpg', cobble: 'road-cobble.jpg' };
export type RoadTextures = Record<RoadLayer, THREE.Texture>;

export function loadRoadTextures(base: string, loader?: THREE.TextureLoader): RoadTextures {
  const out = {} as RoadTextures;
  for (const k of Object.keys(ROAD_TEXTURE_FILES) as RoadLayer[]) out[k] = loadRepeatingTexture(`${base}${ROAD_TEXTURE_FILES[k]}`, loader);
  return out;
}

/** Asphalt is the photo darkened to a worn, sun-bleached grey. */
const ASPHALT_GAIN = 0.75;
const hex = (h: string): N3 => { const c = new THREE.Color(h); return vec3(c.r, c.g, c.b); };
const DUST = '#b89f7e';
const PAINT = '#e8e2d6';

/** Ribbon height above the flattened terrain (mirrors ROAD_LIFT in the pipeline), then the marking lift on top of it. */
const RIBBON_LIFT_M = 0.08;
const MARKING_LIFT_M = 0.035;

export interface RoadMaterials {
  asphalt: THREE.MeshStandardNodeMaterial;
  unpaved: THREE.MeshStandardNodeMaterial;
  pathDirt: THREE.MeshStandardNodeMaterial;
  pathCobble: THREE.MeshStandardNodeMaterial;
  dash: THREE.MeshStandardNodeMaterial;
  zebra: THREE.MeshStandardNodeMaterial;
}

function paved(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.metalnessNode = float(0);
  return m;
}

function decal(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  m.roughnessNode = float(0.85);
  m.metalnessNode = float(0);
  return m;
}

/**
 * Road surfaces. Every surface samples its texture in world space (the ribbon's v still runs 0..1 across, which
 * is all the dusty edge needs), so the pattern does not stretch on wide or curved roads.
 */
export function createRoadMaterials(tex: RoadTextures): RoadMaterials {
  const wp = positionWorld.xz as unknown as N2;
  const v = attribute('uv', 'vec2').y as unknown as N;
  const n40 = macroNoise(wp);
  const nWear = mx_noise_float(vec3(wp.x.div(2.6), wp.y.div(2.6), float(3.1))) as unknown as N;
  const nGrit = mx_noise_float(vec3(wp.x.mul(1.7), wp.y.mul(1.7), float(7.9))) as unknown as N;
  const across = abs(v.mul(2).sub(1));

  // Asphalt: worn grey, lightened where traffic has polished it, darker wheel tracks, dust drifting in from the edges.
  const asphalt = paved();
  {
    // Contrast eased towards the mean so the photographed cracks read as wear, not as lines repeating every few metres.
    const photo = sampleUntiled(tex.asphalt, wp, 4, n40) as N3;
    const detail = mix(vec3(0.1051, 0.1028, 0.0925), photo, 0.7).mul(ASPHALT_GAIN) as N3;
    const wheel = smoothstep(0.12, 0.0, abs(across.sub(0.45))).mul(0.14);
    const faded = smoothstep(0.15, 0.7, nWear).mul(0.22);
    let c = detail.mul(float(1).sub(wheel)).mul(float(1).add(faded)) as N3;
    const edge = smoothstep(0.72, 1.0, across.add(nGrit.mul(0.08)));
    const dustAmount = edge.mul(float(0.55).add(nWear.mul(0.25)));
    c = mix(c, hex(DUST).mul(0.55), dustAmount) as N3;
    asphalt.colorNode = c;
    asphalt.roughnessNode = mix(float(0.88), float(0.7), faded.mul(2)).add(edge.mul(0.1));
  }

  // Unpaved: the dirt texture pulled towards dust (the raw photo is far more orange than valley dirt), with ruts.
  const unpaved = paved();
  {
    const raw = sampleUntiled(tex.dirt, wp, 5, n40) as N3;
    const lum = luminance3(raw);
    const dusty = mix(raw, vec3(lum, lum, lum).mul(vec3(1.0, 0.86, 0.68)), 0.5) as N3;
    const rut = smoothstep(0.1, 0.0, abs(across.sub(0.4))).mul(0.18);
    unpaved.colorNode = dusty.mul(0.8).mul(float(1).sub(rut)).mul(float(1).add(nWear.mul(0.12))) as N3;
    unpaved.roughnessNode = float(0.97);
  }

  const pathDirt = paved();
  {
    const raw = sampleUntiled(tex.dirt, wp, 3.5, n40) as N3;
    const lum = luminance3(raw);
    const dusty = mix(raw, vec3(lum, lum, lum).mul(vec3(1.0, 0.88, 0.72)), 0.6) as N3;
    pathDirt.colorNode = dusty.mul(0.85).mul(float(1).add(nGrit.mul(0.08))) as N3;
    pathDirt.roughnessNode = float(0.98);
  }

  // Cobbles at their real size (1.5 m per photo), one sample so the joints stay crisp, varied per patch by the macro noise.
  const pathCobble = paved();
  {
    const uvC = wp.div(1.5).add(vec2(n40.mul(0.15), n40.mul(-0.15))) as unknown as N2;
    const raw = texture(tex.cobble, uvC).rgb as unknown as N3;
    pathCobble.colorNode = raw.mul(float(0.9).add(n40.mul(0.12))) as N3;
    pathCobble.roughnessNode = float(0.92);
  }

  // Lane dashes: u = metres along the centre line, v across. 3 m of paint every 9 m, faint and chipped.
  const dash = decal();
  {
    const u = attribute('uv', 'vec2').x as unknown as N;
    const dv = attribute('uv', 'vec2').y as unknown as N;
    const along = step(fract(u.div(9)), 1 / 3);
    const soft = smoothstep(0.0, 0.25, dv).mul(smoothstep(1.0, 0.75, dv));
    const chip = smoothstep(-0.3, 0.5, nGrit);
    dash.colorNode = hex(PAINT);
    dash.opacityNode = along.mul(soft).mul(chip).mul(0.55);
  }

  // Zebra crossing: stripes along the direction of travel, 0.5 m paint / 0.5 m gap across the road. u = metres across, v = metres along.
  const zebra = decal();
  {
    const zu = attribute('uv', 'vec2').x as unknown as N;
    const stripe = step(fract(zu), 0.5);
    const worn = smoothstep(-0.55, 0.35, nGrit).mul(0.3).add(0.6);
    zebra.colorNode = hex(PAINT);
    zebra.opacityNode = stripe.mul(worn);
  }

  return { asphalt, unpaved, pathDirt, pathCobble, dash, zebra };
}

/** Paths are cobbled in the walled cores of the old cities and plain dirt elsewhere. */
export function roadMaterialFor(layer: string, zone: string, mats: RoadMaterials): THREE.Material | undefined {
  if (layer === 'asphalt') return mats.asphalt;
  if (layer === 'unpaved') return mats.unpaved;
  if (layer === 'path') return zone.endsWith('-core') ? mats.pathCobble : mats.pathDirt;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Markings: geometry built from nav.json, so it needs no pipeline change and only exists where nav does (lod 0).

export interface MarkingGeometry { positions: number[]; uvs: number[]; indices: number[] }
export interface RoadMarkings { dash: MarkingGeometry; zebra: MarkingGeometry; crossings: number }

const MARKED = new Set(['primary', 'secondary']);
const DASH_WIDTH_M = 0.18;
const DASH_STEP_M = 5;
export const ZEBRA_DEPTH_M = 3;
const ZEBRA_EDGE_MARGIN_M = 0.4;
const ZEBRA_STEP_M = 4;

/** Height of the rendered terrain (world Y, m) at tile-local (x, z): piecewise planar on the mesh triangles, as the pipeline builds them. */
export function meshY(height: Float32Array, x: number, z: number): number {
  const M = HEIGHTMAP_N - 1;
  const fx = Math.min(Math.max(x / HEIGHT_STEP, 0), M), fz = Math.min(Math.max(z / HEIGHT_STEP, 0), M);
  const c = Math.min(Math.floor(fx), M - 1), r = Math.min(Math.floor(fz), M - 1), tx = fx - c, tz = fz - r;
  const a = r * HEIGHTMAP_N + c, A = height[a]!, B = height[a + 1]!, D = height[a + HEIGHTMAP_N]!, E = height[a + HEIGHTMAP_N + 1]!;
  const h = tx + tz <= 1 ? A + (B - A) * tx + (D - A) * tz : E + (D - E) * (1 - tx) + (B - E) * (1 - tz);
  return h - BASE_ELEVATION_M;
}

const empty = (): MarkingGeometry => ({ positions: [], uvs: [], indices: [] });

/** A strip along a->b of `width`, subdivided every `step` m, u in metres from u0, v in 0..1 across. Normals face up. */
function strip(g: MarkingGeometry, ax: number, az: number, bx: number, bz: number, width: number, step: number, u0: number, y: (x: number, z: number) => number): void {
  const len = Math.hypot(bx - ax, bz - az); if (len < 0.5) return;
  const dx = (bx - ax) / len, dz = (bz - az) / len, px = -dz * width / 2, pz = dx * width / 2;
  const n = Math.max(1, Math.ceil(len / step)), base = g.positions.length / 3;
  for (let i = 0; i <= n; i++) {
    const t = (len * i) / n, x = ax + dx * t, z = az + dz * t;
    g.positions.push(x - px, y(x - px, z - pz), z - pz, x + px, y(x + px, z + pz), z + pz);
    g.uvs.push(u0 + t, 0, u0 + t, 1);
  }
  for (let i = 0; i < n; i++) { const a = base + i * 2; g.indices.push(a, a + 1, a + 3, a, a + 3, a + 2); }
}

/**
 * Lane dashes along the centre line of every primary/secondary edge, and a zebra crossing on each arm of every
 * 3+-way node that touches one. Tile-local coordinates; Y follows the same terrain surface the road ribbons use.
 */
export function buildRoadMarkings(nav: Nav, height: Float32Array): RoadMarkings {
  const dash = empty(), zebra = empty();
  const node = new Map(nav.nodes.map((n) => [n.id, n]));
  const arms = new Map<string, { other: string; width: number; marked: boolean }[]>();
  const push = (id: string, a: { other: string; width: number; marked: boolean }) => { const l = arms.get(id); if (l) l.push(a); else arms.set(id, [a]); };
  for (const e of nav.edges) {
    const marked = MARKED.has(e.cls);
    push(e.from, { other: e.to, width: e.width, marked }); push(e.to, { other: e.from, width: e.width, marked });
  }
  const y = (x: number, z: number) => meshY(height, x, z) + RIBBON_LIFT_M + MARKING_LIFT_M;
  const junctionWidth = (id: string) => Math.max(...(arms.get(id) ?? []).map((a) => a.width), 0);
  const isJunction = (id: string) => (arms.get(id)?.length ?? 0) >= 3;

  for (const e of nav.edges) {
    if (!MARKED.has(e.cls)) continue;
    const a = node.get(e.from), b = node.get(e.to); if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 1) continue;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    // Paint stops short of a junction so it never runs through the crossing roads.
    const trimA = isJunction(e.from) ? junctionWidth(e.from) / 2 + 1 : 0, trimB = isJunction(e.to) ? junctionWidth(e.to) / 2 + 1 : 0;
    if (len <= trimA + trimB + 2) continue;
    strip(dash, a.x + dx * trimA, a.z + dz * trimA, b.x - dx * trimB, b.z - dz * trimB, DASH_WIDTH_M, DASH_STEP_M, 0, y);
  }

  let crossings = 0;
  for (const [id, list] of arms) {
    if (list.length < 3 || !list.some((a) => a.marked)) continue;
    const n = node.get(id); if (!n) continue;
    const reach = junctionWidth(id) / 2 + 2;
    for (const arm of list) {
      if (!arm.marked) continue;
      const o = node.get(arm.other); if (!o) continue;
      const len = Math.hypot(o.x - n.x, o.z - n.z);
      if (len < reach + ZEBRA_DEPTH_M + 1) continue;
      const dx = (o.x - n.x) / len, dz = (o.z - n.z) / len, px = -dz, pz = dx;
      const half = arm.width / 2 - ZEBRA_EDGE_MARGIN_M;
      const cols = Math.max(1, Math.ceil((half * 2) / ZEBRA_STEP_M)), base = zebra.positions.length / 3;
      for (let c = 0; c <= cols; c++) {
        const s = -half + (2 * half * c) / cols;
        for (const d of [reach, reach + ZEBRA_DEPTH_M]) {
          const x = n.x + dx * d + px * s, z = n.z + dz * d + pz * s;
          zebra.positions.push(x, y(x, z), z);
          zebra.uvs.push(s + half, d - reach);
        }
      }
      for (let c = 0; c < cols; c++) { const k = base + c * 2; zebra.indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      crossings++;
    }
  }
  return { dash, zebra, crossings };
}

function toGeometry(m: MarkingGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2));
  g.setIndex(m.indices);
  g.computeVertexNormals();
  return g;
}

/** Group of the dash and zebra meshes for one tile (empty meshes are left out). Placed in the tile group, so coordinates stay tile-local. */
export function createRoadMarkings(nav: Nav, height: Float32Array, mats: RoadMaterials): THREE.Group {
  const group = new THREE.Group(); group.name = 'markings';
  const m = buildRoadMarkings(nav, height);
  for (const [name, geo, mat] of [['dash', m.dash, mats.dash], ['zebra', m.zebra, mats.zebra]] as const) {
    if (geo.indices.length === 0) continue;
    const mesh = new THREE.Mesh(toGeometry(geo), mat);
    mesh.name = name; mesh.receiveShadow = true; mesh.renderOrder = 1;
    group.add(mesh);
  }
  return group;
}
