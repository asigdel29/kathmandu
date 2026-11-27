import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { Prop } from '@ktm/schema';
import type { LoadedTile } from './TileLoader.ts';
import { LAMP_HEAD_HEIGHT_M, LAMP_HEAD_REACH_M } from './lighting.ts';
import type { Lamp } from './StreetLights.ts';

type PropType = Prop['type'];
const CAPACITY = 20_000;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function std(color: number, extra: Partial<{ roughness: number; metalness: number }> = {}): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ color, roughness: extra.roughness ?? 0.8, metalness: extra.metalness ?? 0 });
}

/** Merge placeholder parts into one geometry; each part is positioned with its base on y = 0. */
function merged(parts: { geo: THREE.BufferGeometry; y?: number; x?: number; z?: number }[]): THREE.BufferGeometry {
  const positions: number[] = []; const normals: number[] = []; const indices: number[] = [];
  for (const p of parts) {
    const g = p.geo;
    g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
    const base = positions.length / 3;
    const pos = g.getAttribute('position'); const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) { positions.push(pos.getX(i), pos.getY(i), pos.getZ(i)); normals.push(nor.getX(i), nor.getY(i), nor.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) indices.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) indices.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  return out;
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
    case 'sign': return { geometry: merged([{ geo: new THREE.BoxGeometry(2, 0.6, 0.1), y: 3 }]), material: std(0xd9c8b4) };
    case 'awning': return { geometry: merged([{ geo: new THREE.BoxGeometry(2.5, 0.1, 1.2), y: 2.6 }]), material: std(0x3b6ea5, { metalness: 0.3, roughness: 0.6 }) };
    case 'billboard': return { geometry: merged([{ geo: new THREE.BoxGeometry(6, 3, 0.2), y: 1.5 }]), material: std(0xe8e2d6) };
    case 'prayer_flags': return { geometry: merged([{ geo: new THREE.BoxGeometry(8, 0.3, 0.02), y: 0.15 }]), material: std(0xe07a1f, { roughness: 0.9 }) };
    default: return undefined; // taxi_spawn, ped_spawn: not rendered
  }
}

// The dev server answers unknown paths with index.html, so tryModel also checks the content type.

interface Pool { mesh: THREE.InstancedMesh; free: number[]; next: number }

export class PropsRenderer {
  private pools = new Map<PropType, Pool>();
  private slots = new Map<TileId, { type: PropType; index: number }[]>();
  private lampsByTile = new Map<TileId, Lamp[]>();
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
    } catch { /* keep the placeholder */ }
  }

  private pool(type: PropType): Pool | undefined {
    let p = this.pools.get(type);
    if (p) return p;
    const ph = placeholder(type, this.night);
    if (!ph) return undefined;
    const mesh = new THREE.InstancedMesh(ph.geometry, ph.material, CAPACITY);
    mesh.name = `props:${type}`;
    mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p = { mesh, free: [], next: 0 };
    this.pools.set(type, p);
    this.scene.add(mesh);
    void this.tryModel(type, p);
    return p;
  }

  addTile(tile: LoadedTile): void {
    if (!tile.props || this.slots.has(tile.id)) return;
    const o = tileOrigin(tile.id);
    const used: { type: PropType; index: number }[] = [];
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const t = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const touched = new Set<Pool>();
    const lamps: Lamp[] = [];
    for (const prop of tile.props.props) {
      const p = this.pool(prop.type);
      if (!p) continue;
      const index = p.free.pop() ?? (p.next < CAPACITY ? p.next++ : -1);
      if (index < 0) continue;
      t.set(o.x + prop.x, prop.y, o.z + prop.z); q.setFromAxisAngle(up, prop.rotY); s.setScalar(prop.scale);
      p.mesh.setMatrixAt(index, m.compose(t, q, s));
      p.mesh.count = Math.max(p.mesh.count, index + 1);
      used.push({ type: prop.type, index });
      touched.add(p);
      if (prop.type === 'streetlight') {
        // The lamp head: up the pole and out to the side of the arm, rotated with the instance.
        const reach = LAMP_HEAD_REACH_M * prop.scale;
        lamps.push({ key: `${tile.id}:${index}`, x: t.x + Math.cos(prop.rotY) * reach, y: t.y + LAMP_HEAD_HEIGHT_M * prop.scale, z: t.z - Math.sin(prop.rotY) * reach });
      }
    }
    for (const p of touched) p.mesh.instanceMatrix.needsUpdate = true;
    this.slots.set(tile.id, used);
    this.lampsByTile.set(tile.id, lamps);
  }

  /** World positions of the streetlight heads of every loaded tile. */
  *lamps(): Iterable<Lamp> {
    for (const list of this.lampsByTile.values()) yield* list;
  }

  removeTile(id: TileId): void {
    this.lampsByTile.delete(id);
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
