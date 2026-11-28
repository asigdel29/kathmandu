import * as THREE from 'three/webgpu';
import { cos, dot, float, mix, mx_noise_float, normalize, positionWorld, time, transformNormalToView, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type N = Node<'float'>;
type N2 = Node<'vec2'>;

/** The Bagmati and Bishnumati are brown-green, not blue. */
export const WATER_COLOR = '#4d5a3a';
export const WATER_ROUGHNESS = 0.15;
export const WATER_OPACITY = 0.6;
/** Tilt of the ripple normal at its steepest, as a slope (rise over run). Small: the rivers are slow. */
const RIPPLE_SLOPE = 0.07;

// Direction (unit xz), wavelength (m), speed (m/s), weight.
const WAVES: readonly [number, number, number, number, number][] = [
  [0.92, 0.39, 2.3, 0.45, 1.0],
  [-0.38, 0.92, 1.4, 0.35, 0.8],
  [0.71, -0.71, 0.9, 0.28, 0.6],
  [-0.97, -0.26, 0.55, 0.2, 0.5],
];

/** Scales the summed gradient so the steepest possible ripple has slope RIPPLE_SLOPE. */
const RIPPLE_SCALE = RIPPLE_SLOPE / WAVES.reduce((s, [, , wavelength, , weight]) => s + (weight * Math.PI * 2) / wavelength, 0);

/** Normal (world space, unit) of a sum of travelling sine ripples at world xz `p`, `t` seconds. Pure maths, mirrored in the shader below. */
export function rippleNormal(px: number, pz: number, t: number): [number, number, number] {
  let gx = 0, gz = 0;
  for (const [dx, dz, wavelength, speed, weight] of WAVES) {
    const k = (Math.PI * 2) / wavelength;
    const c = Math.cos(k * (dx * px + dz * pz) + k * speed * t) * weight * k;
    gx += c * dx; gz += c * dz;
  }
  gx *= RIPPLE_SCALE; gz *= RIPPLE_SCALE;
  const l = Math.hypot(gx, 1, gz);
  return [-gx / l, 1 / l, -gz / l];
}

/**
 * River water: flat `#4d5a3a`, roughness 0.15, 0.6 opaque over the terrain, with a slight ripple normal scrolled by time.
 * The mesh is a flat polygon a little below the terrain minimum, so the terrain hides it wherever the bank rises.
 */
export function createWaterMaterial(): THREE.MeshStandardNodeMaterial {
  const wp = positionWorld.xz as unknown as N2;
  let gx: N = float(0), gz: N = float(0);
  for (const [dx, dz, wavelength, speed, weight] of WAVES) {
    const k = (Math.PI * 2) / wavelength;
    const phase = dot(wp, vec2(dx, dz)).mul(k).add((time as unknown as N).mul(k * speed));
    const c = cos(phase).mul(weight * k);
    gx = gx.add(c.mul(dx)); gz = gz.add(c.mul(dz));
  }
  const worldNormal = normalize(vec3(gx.mul(-RIPPLE_SCALE), float(1), gz.mul(-RIPPLE_SCALE)));

  const base = new THREE.Color(WATER_COLOR);
  // A little murk: slow patches of lighter silt so the surface is not one flat colour.
  const silt = mx_noise_float(vec3(wp.x.div(14), wp.y.div(14), (time as unknown as N).mul(0.02))) as unknown as N;

  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  mat.colorNode = mix(vec3(base.r, base.g, base.b), vec3(base.r * 1.25, base.g * 1.18, base.b * 1.05), silt.mul(0.5).add(0.5));
  mat.opacityNode = float(WATER_OPACITY);
  mat.roughnessNode = float(WATER_ROUGHNESS);
  mat.metalnessNode = float(0);
  // The water mesh sits in a tile group that is only translated, so its world normal equals its object normal.
  mat.normalNode = transformNormalToView(worldNormal);
  return mat;
}
