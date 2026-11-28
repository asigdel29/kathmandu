import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { VehicleType } from '@ktm/schema';

/**
 * Wheel nodes of a vehicle GLB, in the order of the physics wheels (see `wheelLayout`; the motorbike lists one node per
 * axle). The origin of a wheel node is the hub centre and its axle is the x axis. +Z is forward, +X the vehicle's left.
 */
export const WHEEL_NODES: Record<VehicleType, readonly string[]> = {
  taxi: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
  micro: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
  bus: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
  truck: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
  tempo: ['wheel_f', 'wheel_rl', 'wheel_rr'],
  motorbike: ['wheel_f', 'wheel_r'],
};

/** Which of a type's wheels steer, in WHEEL_NODES order. */
export function steerableWheels(type: VehicleType): boolean[] {
  return WHEEL_NODES[type].map((n) => n.startsWith('wheel_f'));
}

/** Night glow multiplier of lamp vertices (colour x night x this). */
const LAMP_GLOW = 3.5;

export interface VehicleWheel { name: string; position: THREE.Vector3; geometry: THREE.BufferGeometry }

/** A vehicle GLB reduced to what the renderers need: one merged body geometry and hub-centred wheel geometries. */
export interface VehicleModel {
  /** Every non-wheel mesh in model space (origin on the ground at the footprint centre); attributes position, normal, color, surf. */
  body: THREE.BufferGeometry;
  wheels: VehicleWheel[];
  wheelRadius: number;
  /** Where the rider sits (motorbike), model space. */
  rider?: THREE.Vector3;
}

/**
 * Per-vertex surface data replaces materials so a whole vehicle is one draw call and one instanced mesh:
 * `color` is the linear base colour, `surf` is (roughness, metalness, lamp). Materials whose name starts with `light_` are lamps.
 */
function bake(mesh: THREE.Mesh, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  g.setAttribute('position', pos.clone());
  if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone());
  if (src.index) g.setIndex(src.index.clone());
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.applyMatrix4(matrix);
  const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
  const c = mat?.color ?? new THREE.Color(0.5, 0.5, 0.5);
  const rough = mat?.roughness ?? 0.7; const metal = mat?.metalness ?? 0;
  const lamp = mat?.name.startsWith('light_') ? 1 : 0;
  const color = new Float32Array(pos.count * 3); const surf = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;
    surf[i * 3] = rough; surf[i * 3 + 1] = metal; surf[i * 3 + 2] = lamp;
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'color', 'surf'] as const;
  let total = 0; let indices = 0;
  for (const p of parts) { total += p.getAttribute('position').count; indices += p.index ? p.index.count : p.getAttribute('position').count; }
  const arrays = names.map(() => new Float32Array(total * 3));
  const index = new Uint32Array(indices);
  let v = 0; let k = 0;
  for (const p of parts) {
    const n = p.getAttribute('position').count;
    names.forEach((name, a) => arrays[a]!.set(p.getAttribute(name).array as Float32Array, v * 3));
    if (p.index) for (let i = 0; i < p.index.count; i++) index[k++] = v + p.index.getX(i);
    else for (let i = 0; i < n; i++) index[k++] = v + i;
    v += n;
    p.dispose();
  }
  names.forEach((name, a) => out.setAttribute(name, new THREE.BufferAttribute(arrays[a]!, 3)));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Split a loaded GLB scene into the body geometry, the wheels and the rider anchor; throws naming every missing node. */
export function parseVehicleModel(type: VehicleType, scene: THREE.Object3D): VehicleModel {
  scene.updateMatrixWorld(true);
  const wheelNodes = WHEEL_NODES[type].map((name) => ({ name, node: scene.getObjectByName(name) }));
  const missing = wheelNodes.filter((w) => !w.node).map((w) => w.name);
  const bodyNode = scene.getObjectByName('body');
  if (!bodyNode) missing.unshift('body');
  if (missing.length > 0) throw new Error(`${type}.glb: missing node${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);

  const wheelSet = new Set(wheelNodes.map((w) => w.node!));
  const inWheel = (o: THREE.Object3D): THREE.Object3D | undefined => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (wheelSet.has(p)) return p; return undefined; };
  const bodyParts: THREE.BufferGeometry[] = [];
  const wheelParts = new Map<THREE.Object3D, THREE.BufferGeometry[]>(wheelNodes.map((w) => [w.node!, []]));
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const w = inWheel(o);
    if (w) wheelParts.get(w)!.push(bake(o, new THREE.Matrix4().copy(w.matrixWorld).invert().multiply(o.matrixWorld)));
    else bodyParts.push(bake(o, o.matrixWorld));
  });
  if (bodyParts.length === 0) throw new Error(`${type}.glb: no body geometry`);

  const wheels = wheelNodes.map(({ name, node }) => {
    const parts = wheelParts.get(node!)!;
    if (parts.length === 0) throw new Error(`${type}.glb: ${name} has no mesh`);
    return { name, position: new THREE.Vector3().setFromMatrixPosition(node!.matrixWorld), geometry: merge(parts) };
  });
  wheels[0]!.geometry.computeBoundingBox();
  const wheelRadius = (wheels[0]!.geometry.boundingBox!.max.y - wheels[0]!.geometry.boundingBox!.min.y) / 2;
  const riderNode = scene.getObjectByName('rider');
  return {
    body: merge(bodyParts),
    wheels,
    wheelRadius,
    rider: riderNode ? new THREE.Vector3().setFromMatrixPosition(riderNode.matrixWorld) : undefined,
  };
}

/** One lit material for every baked vehicle; lamps glow with the night uniform. */
export function createVehicleMaterial(night: UniformNode<'float'>): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.vertexColors = true;
  const surf = TSL.attribute('surf', 'vec3');
  m.roughnessNode = surf.x;
  m.metalnessNode = surf.y;
  m.emissiveNode = TSL.attribute('color', 'vec3').mul(surf.z).mul(night).mul(LAMP_GLOW);
  return m;
}

export type VehicleModels = Partial<Record<VehicleType, VehicleModel>>;

/** The baked models and the shared material the renderers build vehicles from. Missing models mean the box fallback. */
export interface VehicleSkins { models: VehicleModels; material: THREE.Material }

/** Fetch `<base><type>.glb` for each type; a file that is missing or malformed is skipped (logged) so the box fallback stays. */
export async function loadVehicleModels(base: string, types: readonly VehicleType[] = VehicleType.options): Promise<VehicleModels> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const out: VehicleModels = {};
  await Promise.all(types.map(async (type) => {
    const url = `${base}${type}.glb`;
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const gltf = await loader.parseAsync(await r.arrayBuffer(), '');
      out[type] = parseVehicleModel(type, gltf.scene);
    } catch (e) {
      console.warn(`vehicle model ${type}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
  return out;
}
