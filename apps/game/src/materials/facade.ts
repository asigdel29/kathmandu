import * as THREE from 'three/webgpu';
import { attribute, clamp, float, floor, fract, hash, int, mix, normalWorld, positionWorld, select, step, uniform, uniformArray, uv, vec3 } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { WINDOW_EMISSIVE } from '../world/lighting.ts';

/** Base colour per facade style, index = StyleId enum order. */
const STYLE_COLORS = [
  '#8b3a2a', // newari_brick
  '#e8e2d6', // rcc_plaster_white
  '#d9c8b4', // rcc_plaster_pastel
  '#9a9790', // rcc_unfinished
  '#6f8aa0', // commercial_glass
  '#3b6ea5', // tin_shed
  '#7a2e22', // temple_brick
  '#d8cdb8', // institutional
  '#6b3b2e', // tile_roof (pitched roof slopes)
];

const FLOOR_PITCH = 3.1;
const WINDOW_PITCH = 3.5;

export function createNightUniform(): UniformNode<'float'> {
  return uniform(0);
}

/**
 * Procedural facade: rows of windows per floor, shuttered ground floor, brick mortar lines,
 * and warm lit windows at night. Expects uv in metres (u along the facade, v up the wall)
 * and a per-vertex `_style` float holding the StyleId index.
 */
export function createFacadeMaterial(night: UniformNode<'float'>): THREE.MeshStandardNodeMaterial {
  const linear = (hex: string) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };
  const rgb = (hex: string) => { const c = new THREE.Color(hex); return vec3(c.r, c.g, c.b); };
  const colors = uniformArray<'vec3'>(STYLE_COLORS.map(linear), 'vec3');
  const styleIdx = int(attribute('_style', 'float').add(0.5));
  const base0 = colors.element(styleIdx);

  const u = uv().x;
  const v = uv().y;
  const fu = fract(u.div(WINDOW_PITCH));
  const fv = fract(v.div(FLOOR_PITCH));
  const inRange = (x: typeof fu, lo: number, hi: number) => step(lo, x).mul(step(x, hi));

  // Walls only: roof faces share the material but should stay plain.
  const wall = float(1).sub(step(0.5, normalWorld.y.abs()));
  const ground = float(1).sub(step(FLOOR_PITCH, v));

  const windowMask = inRange(fu, 0.3, 0.67).mul(inRange(fv, 0.3, 0.78)).mul(float(1).sub(ground)).mul(wall);
  const shutterMask = inRange(fu, 0.1, 0.9).mul(inRange(fv, 0.05, 0.75)).mul(ground).mul(wall);

  const isBrick = styleIdx.equal(0).or(styleIdx.equal(6));
  const mortar = float(1).sub(step(0.12, fract(v.div(0.075)))).mul(wall);
  const base = base0.mul(float(1).sub(select(isBrick, mortar.mul(0.15), float(0))));

  const greyShutter = styleIdx.equal(1).or(styleIdx.equal(4));
  const shutterColor = select(greyShutter, rgb('#4a4a4a'), base);
  const glass = rgb('#1f242a');

  const withShutters = mix(base, shutterColor, shutterMask);
  const colorNode = mix(withShutters, glass, windowMask);

  const tile = floor(positionWorld.xz.div(50));
  const seed = floor(u.div(WINDOW_PITCH))
    .add(floor(v.div(FLOOR_PITCH)).mul(131))
    .add(tile.x.mul(7919))
    .add(tile.y.mul(104729));
  // hash() converts its seed to uint; negative world coordinates would all collapse to one value.
  const lit = step(0.6, hash(seed.abs())).mul(windowMask);
  // Each lit window gets its own brightness and a vertical falloff, so the night facade is not a grid of identical flat rectangles.
  const glow = mix(float(0.55), float(1), hash(seed.abs().add(977))).mul(mix(float(1), float(0.6), clamp(fv.sub(0.3).div(0.48), 0, 1)));

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = colorNode;
  mat.roughnessNode = mix(float(0.85), float(0.28), windowMask);
  mat.metalnessNode = float(0);
  mat.emissiveNode = vec3(1.0, 0.55, 0.22).mul(night).mul(lit).mul(glow).mul(WINDOW_EMISSIVE);
  return mat;
}
