import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { Prop } from '@ktm/schema';
import type { LoadedTile } from './TileLoader.ts';
import { modelFile, placeMatrix, RENDERED, tintHex, variantOf, type PropType } from './propPlacement.ts';

const CAPACITY = 20_000;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Night glow of the `_lamp` vertex attribute: streetlight lens and shrine candle flame. */
const GLOW: Partial<Record<PropType, { color: [number, number, number]; gain: number }>> = {
  streetlight: { color: [1.0, 0.85, 0.55], gain: 4 },
  shrine: { color: [1.0, 0.72, 0.38], gain: 2.5 },
};
/** Thin geometry that costs more in the shadow pass than it shows there. */
const NO_SHADOW = new Set<PropType>(['wires', 'prayer_flags']);

/** Visible stand-in while a model loads or when its file is missing: a 0.5 m grey post. */
function fallbackGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.5, 1.5, 0.5); g.translate(0, 0.75, 0); return g;
}

/**
 * Build the instanced material for a loaded model: vertex colours (COLOR_0) and PBR scalars from the file,
 * plus an emissive channel driven by the night uniform where the model has a `_lamp` mask.
 */
function modelMaterial(type: PropType, source: THREE.Material, geometry: THREE.BufferGeometry, night: UniformNode<'float'>): THREE.MeshStandardNodeMaterial {
  const s = source as THREE.MeshStandardMaterial;
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: geometry.hasAttribute('color'), roughness: s.roughness ?? 0.8, metalness: s.metalness ?? 0, side: THREE.FrontSide });
  const glow = GLOW[type];
  if (glow && geometry.hasAttribute('_lamp')) {
    material.emissiveNode = TSL.vec3(...glow.color).mul(TSL.attribute('_lamp', 'float')).mul(night).mul(glow.gain);
  }
  return material;
}

interface Pool { key: string; type: PropType; mesh: THREE.InstancedMesh; free: number[]; next: number }

export class PropsRenderer {
  private pools = new Map<string, Pool>();
  private slots = new Map<TileId, { pool: Pool; index: number }[]>();
  private gltf?: Promise<typeof import('three/addons/loaders/GLTFLoader.js')>;
  private models = new Map<string, Promise<THREE.Mesh | undefined>>();
  private color = new THREE.Color();

  constructor(private scene: THREE.Scene, private night: UniformNode<'float'>, private modelsBase = '/models/props/') {}

  /** Load public/models/props/<file>.glb once; the first mesh of the file is the prop. */
  private loadModel(file: string): Promise<THREE.Mesh | undefined> {
    let p = this.models.get(file);
    if (p) return p;
    p = (async () => {
      const url = `${this.modelsBase}${file}.glb`;
      try {
        // The dev server may answer unknown paths with index.html, so check the content type.
        const head = await fetch(url, { method: 'HEAD' });
        if (!head.ok || !(head.headers.get('content-type') ?? '').includes('gltf')) return undefined;
        this.gltf ??= import('three/addons/loaders/GLTFLoader.js');
        const { GLTFLoader } = await this.gltf;
        const gltf = await new GLTFLoader().loadAsync(url);
        let found: THREE.Mesh | undefined;
        gltf.scene.traverse((o) => { if (!found && o instanceof THREE.Mesh) found = o; });
        return found;
      } catch { return undefined; }
    })();
    this.models.set(file, p);
    return p;
  }

  /** Swap the stand-in for the model once it has loaded; the pool stays hidden until then. */
  private async attachModel(pool: Pool, file: string): Promise<void> {
    const mesh = await this.loadModel(file);
    if (mesh) {
      pool.mesh.geometry.dispose();
      pool.mesh.geometry = mesh.geometry;
      (pool.mesh.material as THREE.Material).dispose();
      pool.mesh.material = modelMaterial(pool.type, mesh.material as THREE.Material, mesh.geometry, this.night);
    }
    pool.mesh.visible = true;
  }

  private pool(type: PropType, variant: number): Pool | undefined {
    if (!RENDERED.has(type)) return undefined; // taxi_spawn, ped_spawn: not rendered
    const key = `${type}:${variant}`;
    let p = this.pools.get(key);
    if (p) return p;
    const material = new THREE.MeshStandardNodeMaterial({ color: 0x777777, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(fallbackGeometry(), material, CAPACITY);
    mesh.name = `props:${key}`;
    mesh.count = 0; mesh.castShadow = !NO_SHADOW.has(type); mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p = { key, type, mesh, free: [], next: 0 };
    this.pools.set(key, p);
    this.scene.add(mesh);
    void this.attachModel(p, modelFile(type, variant));
    return p;
  }

  addTile(tile: LoadedTile): void {
    if (!tile.props || this.slots.has(tile.id)) return;
    const o = tileOrigin(tile.id);
    const used: { pool: Pool; index: number }[] = [];
    const m = new THREE.Matrix4();
    const touched = new Set<Pool>();
    for (const prop of tile.props.props as Prop[]) {
      const p = this.pool(prop.type, variantOf(prop.type, prop.x, prop.z));
      if (!p) continue;
      const index = p.free.pop() ?? (p.next < CAPACITY ? p.next++ : -1);
      if (index < 0) continue;
      p.mesh.setMatrixAt(index, placeMatrix(prop, o, m));
      const tint = tintHex(prop.type, prop.x, prop.z);
      if (tint !== undefined || p.mesh.instanceColor) p.mesh.setColorAt(index, this.color.setHex(tint ?? 0xffffff));
      p.mesh.count = Math.max(p.mesh.count, index + 1);
      used.push({ pool: p, index });
      touched.add(p);
    }
    for (const p of touched) { p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true; }
    this.slots.set(tile.id, used);
  }

  removeTile(id: TileId): void {
    const used = this.slots.get(id);
    if (!used) return;
    const touched = new Set<Pool>();
    for (const { pool, index } of used) {
      pool.mesh.setMatrixAt(index, HIDDEN);
      pool.free.push(index);
      touched.add(pool);
    }
    for (const p of touched) p.mesh.instanceMatrix.needsUpdate = true;
    this.slots.delete(id);
  }
}
