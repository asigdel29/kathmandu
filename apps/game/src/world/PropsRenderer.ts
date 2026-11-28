import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { Prop } from '@ktm/schema';
import type { LoadedTile } from './TileLoader.ts';

type PropType = Prop['type'];
const CAPACITY = 20_000;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** Decals and hair-thin geometry cast no shadow. */
const FLAT_OR_THIN = new Set<PropType>(['wires', 'puddle']);

function std(color: number, extra: Partial<{ roughness: number; metalness: number }> = {}): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ color, roughness: extra.roughness ?? 0.8, metalness: extra.metalness ?? 0 });
}

/** Merge placeholder parts into one geometry; each part is positioned with its base on y = 0. Parts with a `color` give the merge a per-vertex colour (others white). */
function merged(parts: { geo: THREE.BufferGeometry; y?: number; x?: number; z?: number; color?: number }[]): THREE.BufferGeometry {
  const positions: number[] = []; const normals: number[] = []; const indices: number[] = []; const colors: number[] = [];
  const tint = new THREE.Color();
  for (const p of parts) {
    const g = p.geo;
    g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
    const base = positions.length / 3;
    const pos = g.getAttribute('position'); const nor = g.getAttribute('normal');
    tint.set(p.color ?? 0xffffff);
    for (let i = 0; i < pos.count; i++) { positions.push(pos.getX(i), pos.getY(i), pos.getZ(i)); normals.push(nor.getX(i), nor.getY(i), nor.getZ(i)); colors.push(tint.r, tint.g, tint.b); }
    if (g.index) for (let i = 0; i < g.index.count; i++) indices.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) indices.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (parts.some((p) => p.color !== undefined)) out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.setIndex(indices);
  return out;
}

/** A tinted copy of std() for geometries that carry per-vertex colours. */
function stdColored(extra: Partial<{ roughness: number; metalness: number }> = {}): THREE.MeshStandardNodeMaterial {
  const m = std(0xffffff, extra);
  m.vertexColors = true;
  return m;
}

const rotX = (g: THREE.BufferGeometry, a: number): THREE.BufferGeometry => g.rotateX(a);
const rotZ = (g: THREE.BufferGeometry, a: number): THREE.BufferGeometry => g.rotateZ(a);

export const WIRE_SPAN_M = 35;
const WIRE_SAG_M = 0.8;
const WIRE_STRANDS: [number, number][] = [[-0.6, 0], [-0.36, 0], [-0.12, 0], [0.12, -0.35], [0.36, -0.35], [0.6, -0.35]];

/**
 * Six strands hanging between two poles WIRE_SPAN_M apart, each a pair of crossed thin ribbons (one horizontal, one vertical).
 * The origin is the mid-span attach height; a parabola gives the sag. Instances are scaled to the real chord and pitched to the slope.
 */
function wiresGeometry(): THREE.BufferGeometry {
  const SEG = 12, W = 0.02, half = WIRE_SPAN_M / 2;
  const positions: number[] = []; const normals: number[] = []; const indices: number[] = [];
  for (const [sx, sy] of WIRE_STRANDS) {
    for (const vertical of [false, true]) {
      const base = positions.length / 3;
      for (let i = 0; i <= SEG; i++) {
        const z = -half + (WIRE_SPAN_M * i) / SEG;
        const y = sy - WIRE_SAG_M * (1 - (z / half) ** 2);
        if (vertical) { positions.push(sx, y + W, z, sx, y - W, z); normals.push(1, 0, 0, 1, 0, 0); }
        else { positions.push(sx - W, y, z, sx + W, y, z); normals.push(0, 1, 0, 0, 1, 0); }
      }
      for (let i = 0; i < SEG; i++) { const a = base + i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

function placeholder(type: PropType, night: UniformNode<'float'>): { geometry: THREE.BufferGeometry; material: THREE.Material } | undefined {
  switch (type) {
    case 'streetlight': {
      // Pole and head share one mesh; the head is lit through a vertex attribute mask.
      const pole = new THREE.CylinderGeometry(0.08, 0.08, 7, 6);
      const head = new THREE.BoxGeometry(0.6, 0.15, 0.25);
      const geometry = merged([{ geo: pole, y: 3.5 }, { geo: head, y: 7, x: 0.25 }]);
      const n = geometry.getAttribute('position').count; const headStart = pole.getAttribute('position').count;
      const mask = new Float32Array(n); mask.fill(1, headStart);
      geometry.setAttribute('_lamp', new THREE.BufferAttribute(mask, 1));
      const material = std(0x4a4a4a, { metalness: 0.4, roughness: 0.6 });
      material.emissiveNode = TSL.vec3(1.0, 0.85, 0.55).mul(TSL.attribute('_lamp', 'float')).mul(night).mul(4);
      return { geometry, material };
    }
    case 'water_tank': return { geometry: merged([{ geo: new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12), y: 0.6 }]), material: std(0x151515, { roughness: 0.5 }) };
    case 'rebar': return {
      geometry: merged([[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].map(([x, z]) => ({ geo: new THREE.CylinderGeometry(0.012, 0.012, 1.2, 4), y: 0.6, x, z }))),
      material: std(0x7a4a2a, { roughness: 0.9, metalness: 0.3 }),
    };
    case 'powerpole': return { geometry: merged([{ geo: new THREE.CylinderGeometry(0.12, 0.12, 8, 6), y: 4 }]), material: std(0x8a8a86) };
    case 'tree': return {
      geometry: merged([{ geo: new THREE.CylinderGeometry(0.15, 0.2, 2, 6), y: 1 }, { geo: new THREE.ConeGeometry(2.2, 5, 8), y: 4.5 }]),
      material: std(0x4f6b35, { roughness: 0.95 }),
    };
    case 'shrine': return { geometry: merged([{ geo: new THREE.BoxGeometry(1.2, 1.6, 1.2), y: 0.8 }]), material: std(0x8b3a2a, { roughness: 0.9 }) };
    // Facade props: local +Z is the outward wall normal, the origin sits on the wall at ground level, width runs along X.
    case 'sign': return { geometry: merged([{ geo: new THREE.BoxGeometry(2, 0.6, 0.1), y: 3.2, z: 0.05 }]), material: std(0xffffff) };
    case 'awning': return {
      geometry: merged([{ geo: rotX(new THREE.BoxGeometry(2.5, 0.08, 1.25), 0.2), y: 2.55, z: 0.6 }]),
      material: std(0xffffff, { metalness: 0.3, roughness: 0.6 }),
    };
    case 'shutter': return { geometry: merged([{ geo: new THREE.BoxGeometry(2, 2.2, 0.08), y: 1.1, z: 0.04 }]), material: std(0xffffff, { metalness: 0.5, roughness: 0.55 }) };
    case 'banner': { const m = std(0xffffff, { roughness: 0.9 }); m.side = THREE.DoubleSide; return { geometry: merged([{ geo: new THREE.BoxGeometry(6, 0.8, 0.02), y: 6 }]), material: m }; }
    case 'wires': { const m = std(0x1a1a1a, { roughness: 0.7 }); m.side = THREE.DoubleSide; return { geometry: wiresGeometry(), material: m }; }
    case 'transformer': return {
      geometry: merged([{ geo: new THREE.CylinderGeometry(0.28, 0.28, 0.8, 10), y: 6.4, z: 0.4 }, { geo: new THREE.BoxGeometry(0.5, 0.3, 0.35), y: 6.4, z: 0.1 }]),
      material: std(0x77797a, { metalness: 0.4, roughness: 0.6 }),
    };
    case 'rooftop_clutter': return {
      geometry: merged([
        { geo: new THREE.BoxGeometry(0.8, 0.5, 0.6), y: 0.25, x: -0.9, z: -0.6, color: 0x8a8884 },
        { geo: new THREE.BoxGeometry(0.5, 0.35, 0.5), y: 0.175, x: -0.2, z: -0.9, color: 0xb0aea8 },
        { geo: new THREE.BoxGeometry(0.7, 0.6, 0.4), y: 0.3, x: -1.2, z: 0.1, color: 0x6c6a66 },
        // satellite dish on a post
        { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), y: 0.4, x: 0.7, z: -0.4, color: 0x555555 },
        { geo: rotX(new THREE.ConeGeometry(0.45, 0.18, 12, 1, true), 2.2), y: 0.85, x: 0.7, z: -0.3, color: 0xd8d8d4 },
        // clothes line: two posts, the line and three cloths
        { geo: new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), y: 0.75, x: -0.6, z: 0.9, color: 0x4a4a4a },
        { geo: new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), y: 0.75, x: 1.0, z: 0.9, color: 0x4a4a4a },
        { geo: rotZ(new THREE.CylinderGeometry(0.008, 0.008, 1.6, 4), Math.PI / 2), y: 1.45, x: 0.2, z: 0.9, color: 0x303030 },
        { geo: new THREE.BoxGeometry(0.3, 0.5, 0.02), y: 1.17, x: -0.25, z: 0.9, color: 0xe3cfc0 },
        { geo: new THREE.BoxGeometry(0.3, 0.45, 0.02), y: 1.2, x: 0.2, z: 0.9, color: 0x3b6ea5 },
        { geo: new THREE.BoxGeometry(0.3, 0.5, 0.02), y: 1.17, x: 0.65, z: 0.9, color: 0xe07a1f },
      ]),
      material: stdColored({ roughness: 0.85 }),
    };
    case 'parapet_pots': {
      const parts: { geo: THREE.BufferGeometry; y?: number; x?: number; color?: number }[] = [];
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.5;
        parts.push({ geo: new THREE.CylinderGeometry(0.18, 0.13, 0.35, 8), y: 0.175, x, color: 0xb5562f });
        parts.push({ geo: new THREE.SphereGeometry(0.2, 8, 6), y: 0.5, x, color: 0x4f6b35 });
      }
      return { geometry: merged(parts), material: stdColored({ roughness: 0.9 }) };
    }
    case 'parked_bike': return {
      geometry: merged([
        { geo: new THREE.BoxGeometry(0.28, 0.35, 1.0), y: 0.5, z: 0.0, color: 0x242424 },
        { geo: new THREE.BoxGeometry(0.3, 0.12, 0.6), y: 0.76, z: -0.25, color: 0x1a1a1a },
        { geo: rotZ(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12), Math.PI / 2), y: 0.3, z: 0.72, color: 0x111111 },
        { geo: rotZ(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12), Math.PI / 2), y: 0.3, z: -0.72, color: 0x111111 },
        { geo: new THREE.BoxGeometry(0.62, 0.06, 0.06), y: 0.95, z: 0.55, color: 0x333333 },
        { geo: new THREE.BoxGeometry(0.1, 0.55, 0.08), y: 0.6, z: 0.62, color: 0x8a1f1f },
      ]),
      material: stdColored({ roughness: 0.55, metalness: 0.3 }),
    };
    case 'vendor_cart': return {
      geometry: merged([
        { geo: new THREE.BoxGeometry(1.2, 0.12, 2.0), y: 0.85, color: 0x4a2e1c },
        { geo: new THREE.BoxGeometry(1.1, 0.35, 1.1), y: 1.1, z: -0.3, color: 0xb86a2a },
        { geo: rotZ(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 12), Math.PI / 2), y: 0.4, x: 0.65, z: 0.2, color: 0x222222 },
        { geo: rotZ(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 12), Math.PI / 2), y: 0.4, x: -0.65, z: 0.2, color: 0x222222 },
        { geo: new THREE.BoxGeometry(0.1, 0.1, 0.5), y: 0.8, z: 1.2, color: 0x4a2e1c },
        { geo: new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), y: 1.5, z: 0.5, color: 0x4a4a4a },
        { geo: new THREE.ConeGeometry(1.1, 0.35, 12, 1, true), y: 2.1, z: 0.5, color: 0xf2a81d },
      ]),
      material: stdColored({ roughness: 0.8 }),
    };
    case 'rubbish_pile': {
      const mound = new THREE.SphereGeometry(0.7, 10, 6); mound.scale(1, 0.64, 1);
      const lumpA = new THREE.SphereGeometry(0.3, 6, 5); lumpA.scale(1, 0.7, 1);
      const lumpB = new THREE.SphereGeometry(0.25, 6, 5); lumpB.scale(1, 0.7, 1);
      return { geometry: merged([{ geo: mound, y: 0 }, { geo: lumpA, x: 0.75, z: 0.2, y: 0 }, { geo: lumpB, x: -0.55, z: -0.6, y: 0 }]), material: std(0x2a2824, { roughness: 1 }) };
    }
    case 'puddle': {
      const disc = new THREE.CircleGeometry(0.5, 16); disc.rotateX(-Math.PI / 2);
      const m = std(0x16181b, { roughness: 0.05 });
      m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
      return { geometry: merged([{ geo: disc, y: 0.12 }]), material: m };
    }
    case 'billboard': return { geometry: merged([{ geo: new THREE.BoxGeometry(6, 3, 0.2), y: 1.5 }]), material: std(0xe8e2d6) };
    case 'prayer_flags': return { geometry: merged([{ geo: new THREE.BoxGeometry(8, 0.3, 0.02), y: 0.15 }]), material: std(0xe07a1f, { roughness: 0.9 }) };
    default: return undefined; // taxi_spawn, ped_spawn: not rendered
  }
}

// The dev server answers unknown paths with index.html, so tryModel also checks the content type.

interface Pool { mesh: THREE.InstancedMesh; free: number[]; next: number; tint?: THREE.Color[] }

/** Shop-front props vary in colour per instance (the base material is white and the instance colour multiplies it). */
const palette = (hex: number[]): THREE.Color[] => hex.map((h) => new THREE.Color(h));
const TINTS: Partial<Record<PropType, THREE.Color[]>> = {
  sign: palette([0xd9c8b4, 0xe8e2d6, 0x3b6ea5, 0xf2a81d, 0xc6d3dc, 0xb33a3a]),
  awning: palette([0x3b6ea5, 0xf2a81d, 0xe07a1f, 0x8b3a2a, 0x4f7a4a, 0xc9c2b4]),
  shutter: palette([0x6f7a73, 0x8a8f94, 0x4f6b8a, 0x7a5a3a]),
  banner: palette([0xe07a1f, 0xf2a81d, 0xb33a3a, 0xd9c8b4]),
};

export class PropsRenderer {
  private pools = new Map<PropType, Pool>();
  private slots = new Map<TileId, { type: PropType; index: number }[]>();
  private gltf?: Promise<typeof import('three/addons/loaders/GLTFLoader.js')>;

  constructor(private scene: THREE.Scene, private night: UniformNode<'float'>, private modelsBase = '/models/props/') {}

  /** Swap a placeholder for public/models/props/<type>.glb when that file exists. */
  private async tryModel(type: PropType, pool: Pool): Promise<void> {
    const url = `${this.modelsBase}${type}.glb`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok || !(head.headers.get('content-type') ?? '').includes('gltf')) return;
      this.gltf ??= import('three/addons/loaders/GLTFLoader.js');
      const { GLTFLoader } = await this.gltf;
      const gltf = await new GLTFLoader().loadAsync(url);
      let found: THREE.Mesh | undefined;
      gltf.scene.traverse((o) => { if (!found && o instanceof THREE.Mesh) found = o; });
      if (!found) return;
      pool.mesh.geometry = found.geometry;
      pool.mesh.material = found.material;
      pool.tint = undefined; // a model carries its own colours
      if (pool.mesh.instanceColor) { pool.mesh.instanceColor = null; }
    } catch { /* keep the placeholder */ }
  }

  private pool(type: PropType): Pool | undefined {
    let p = this.pools.get(type);
    if (p) return p;
    const ph = placeholder(type, this.night);
    if (!ph) return undefined;
    const mesh = new THREE.InstancedMesh(ph.geometry, ph.material, CAPACITY);
    mesh.name = `props:${type}`;
    mesh.count = 0; mesh.castShadow = !FLAT_OR_THIN.has(type); mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p = { mesh, free: [], next: 0, tint: TINTS[type] };
    if (p.tint) mesh.setColorAt(0, p.tint[0]!); // allocates the per-instance colour buffer up front
    this.pools.set(type, p);
    this.scene.add(mesh);
    void this.tryModel(type, p);
    return p;
  }

  addTile(tile: LoadedTile): void {
    if (!tile.props || this.slots.has(tile.id)) return;
    const o = tileOrigin(tile.id);
    const used: { type: PropType; index: number }[] = [];
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const t = new THREE.Vector3(); const e = new THREE.Euler();
    const touched = new Set<Pool>();
    for (const prop of tile.props.props) {
      const p = this.pool(prop.type);
      if (!p) continue;
      const index = p.free.pop() ?? (p.next < CAPACITY ? p.next++ : -1);
      if (index < 0) continue;
      t.set(o.x + prop.x, prop.y, o.z + prop.z); e.set(-(prop.pitch ?? 0), prop.rotY, 0, 'YXZ'); q.setFromEuler(e); s.setScalar(prop.scale);
      p.mesh.setMatrixAt(index, m.compose(t, q, s));
      if (p.tint) p.mesh.setColorAt(index, p.tint[Math.abs(Math.floor(prop.x * 37.1 + prop.z * 91.7)) % p.tint.length]!);
      p.mesh.count = Math.max(p.mesh.count, index + 1);
      used.push({ type: prop.type, index });
      touched.add(p);
    }
    for (const p of touched) { p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true; }
    this.slots.set(tile.id, used);
  }

  removeTile(id: TileId): void {
    const used = this.slots.get(id);
    if (!used) return;
    const touched = new Set<Pool>();
    for (const { type, index } of used) {
      const p = this.pools.get(type)!;
      p.mesh.setMatrixAt(index, HIDDEN);
      p.free.push(index);
      touched.add(p);
    }
    for (const p of touched) p.mesh.instanceMatrix.needsUpdate = true;
    this.slots.delete(id);
  }
}
