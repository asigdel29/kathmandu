import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { float, mix, vec3 } from 'three/tsl';

/** Roughness of wet asphalt: low enough (< 0.35) for the screen-space reflections to pick it up. */
export const WET_ASPHALT_ROUGHNESS = 0.1;
/** Albedo multiplier of fully wet asphalt: wet surfaces read darker. */
export const WET_ASPHALT_DARKEN = 0.62;

/**
 * Road surface material built from a glTF road material. Asphalt follows the `wet` uniform (0 dry, 1 wet) towards a
 * glossy, darker surface; other surfaces (unpaved, paths) stay as authored.
 */
export function createRoadMaterial(src: THREE.Material, wet: UniformNode<'float'>): THREE.Material {
  if (!(src instanceof THREE.MeshStandardMaterial) || src.name !== 'asphalt') return src;
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = src.name;
  mat.color.copy(src.color);
  mat.roughness = src.roughness;
  mat.metalness = 0;
  mat.roughnessNode = mix(float(src.roughness), float(WET_ASPHALT_ROUGHNESS), wet);
  mat.colorNode = vec3(src.color.r, src.color.g, src.color.b).mul(mix(float(1), float(WET_ASPHALT_DARKEN), wet));
  return mat;
}
