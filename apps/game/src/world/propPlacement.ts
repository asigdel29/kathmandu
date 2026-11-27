import * as THREE from 'three/webgpu';
import type { Prop } from '@ktm/schema';
import palette from '../../../../world/style/palette.json';

export type PropType = Prop['type'];

/** Types that have a model; `taxi_spawn` and `ped_spawn` are markers and are not drawn. */
export const RENDERED = new Set<PropType>(['streetlight', 'tree', 'water_tank', 'rebar', 'powerpole', 'shrine', 'sign', 'awning', 'billboard', 'prayer_flags', 'shutter', 'wires']);

/** Tree models: peepal (wide crown), bottlebrush, jacaranda. A tree's variant comes from its position. */
export const TREE_VARIANTS = ['tree_peepal', 'tree_bottlebrush', 'tree_jacaranda'] as const;
const TREE_WEIGHTS = [0.4, 0.3, 0.3];

/** Cheap deterministic hash of a position into [0, 1). */
export function hash2(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export function variantOf(type: PropType, x: number, z: number): number {
  if (type !== 'tree') return 0;
  const h = hash2(x, z);
  let acc = 0;
  for (let i = 0; i < TREE_WEIGHTS.length; i++) { acc += TREE_WEIGHTS[i]!; if (h < acc) return i; }
  return TREE_WEIGHTS.length - 1;
}

/** Base name of `public/models/props/<name>.glb` for a prop type and variant. */
export function modelFile(type: PropType, variant: number): string {
  return type === 'tree' ? TREE_VARIANTS[variant] ?? TREE_VARIANTS[0] : type;
}

const P = palette as Record<string, string>;
const hex = (v: string): number => parseInt((P[v] ?? v).replace('#', ''), 16);

/**
 * Per-instance colour multiplied into the model's vertex colours, for models that are authored in near-white
 * (sign, awning, shutter) or that should vary a little (trees). Every other type keeps its own colours.
 */
const TINTS: Partial<Record<PropType, number[]>> = {
  sign: ['tin_blue', 'marigold', 'saffron', 'plaster_white', 'pastel_1', 'pastel_2', 'pastel_4', 'newari_brick', '#3f7a52'].map(hex),
  awning: ['tin_blue', 'saffron', 'marigold', 'newari_brick', '#3f7a52', '#c4281c'].map(hex),
  shutter: ['#b5bec2', '#9fb3c4', '#c97c6c', '#9cb894', '#e0d9c4', '#6c93c0'].map(hex),
  tree: ['#ffffff', '#e8f0d8', '#d4e2b8', '#f2f6e4', '#c9d9a8'].map(hex),
};

export function tintHex(type: PropType, x: number, z: number): number | undefined {
  const list = TINTS[type];
  if (!list) return undefined;
  return list[Math.floor(hash2(x, z, 7) * list.length) % list.length];
}

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion();
const pos = new THREE.Vector3(), scl = new THREE.Vector3();

/**
 * Instance matrix of a prop in a tile whose origin is `origin`. Models face +Z; `rotY` is the heading
 * (local +Z ends up along (sin rotY, cos rotY) in world X/Z). `wires` stretch along their own Z by
 * `scale` (the span in units of the 40 m model) and tilt by `pitch`; everything else scales uniformly.
 */
export function placeMatrix(prop: Pick<Prop, 'type' | 'x' | 'y' | 'z' | 'rotY' | 'scale'> & { pitch?: number }, origin: { x: number; z: number }, out: THREE.Matrix4): THREE.Matrix4 {
  pos.set(origin.x + prop.x, prop.y, origin.z + prop.z);
  qYaw.setFromAxisAngle(UP, prop.rotY);
  if (prop.type === 'wires') {
    qPitch.setFromAxisAngle(RIGHT, -(prop.pitch ?? 0));
    qYaw.multiply(qPitch);
    scl.set(1, 1, prop.scale);
  } else scl.setScalar(prop.scale);
  return out.compose(pos, qYaw, scl);
}
