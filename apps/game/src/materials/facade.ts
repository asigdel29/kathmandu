import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, float, floor, fract, hash, int, max, min, mix, normalMap, normalWorld, positionWorld, select, smoothstep, step, texture, uniform, uniformArray, uv, vec2, vec3 } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { loadFacadeTextures } from './facadeTextureLoader.ts';
import { FLAT_ROOF_INDEX, STYLE_IS_BRICK, STYLE_TILING_M, STYLE_TINT, TILE_ROOF_INDEX } from './facadeTextures.ts';
import { WINDOW_EMISSIVE } from '../world/lighting.ts';

const FLOOR_PITCH = 3.1;
const WINDOW_PITCH = 3.5;
// Window opening inside one (WINDOW_PITCH x FLOOR_PITCH) cell, as fractions of the cell.
const WIN_U0 = 0.3, WIN_U1 = 0.67, WIN_V0 = 0.3, WIN_V1 = 0.78;
const FRAME_M = 0.08;
const MULLION_M = 0.03;
const FLAT_ROOF_LIGHTEN = 1.3;
const TIN_INDEX = 5;

export function createNightUniform(): UniformNode<'float'> {
  return uniform(0);
}

/** The facade material plus the promise (in `userData`) that resolves once its texture arrays are decoded and uploaded. */
export type FacadeMaterial = THREE.MeshStandardNodeMaterial & { userData: { texturesReady: Promise<void> } };

/**
 * Textured facade: a PBR set per style (brick, plaster, concrete, tin, glass, clay tiles) sampled at
 * world scale, with procedural windows (frames, sills, sill shadows), shuttered ground floors, grime
 * streaks below the sills, ground-floor darkening and contact AO, and warm lit windows at night.
 * Expects uv in metres (u along the facade, v up the wall; roofs use x,z) and a per-vertex `_style`
 * float holding the StyleId index.
 */
export function createFacadeMaterial(night: UniformNode<'float'>, base: string = import.meta.env.BASE_URL): FacadeMaterial {
  const rgb = (hex: string) => { const c = new THREE.Color(hex); return vec3(c.r, c.g, c.b); };
  const textures = loadFacadeTextures(base);
  const tiling = uniformArray<'float'>(STYLE_TILING_M, 'float');
  const tint = uniformArray<'vec3'>(STYLE_TINT.map(([r, g, b]) => new THREE.Vector3(r, g, b)), 'vec3');

  const styleIdx = int(attribute('_style', 'float').add(0.5));
  const u = uv().x;
  const v = uv().y;

  // Walls only get windows; roof faces (flat: concrete set, pitched: clay tiles) stay plain.
  const isFlatRoof = normalWorld.y.greaterThan(0.5).and(styleIdx.notEqual(TILE_ROOF_INDEX));
  const wall = float(1).sub(step(0.5, normalWorld.y.abs()));
  const layer = select(isFlatRoof, int(FLAT_ROOF_INDEX), styleIdx);
  const texUv = vec2(u, v).div(tiling.element(layer));
  const diffS = texture(textures.diff, texUv).depth(layer);
  const norS = texture(textures.nor, texUv).depth(layer);
  const roughS = texture(textures.rough, texUv).depth(layer);

  // --- window layout ---------------------------------------------------------------------------
  const fu = fract(u.div(WINDOW_PITCH));
  const fv = fract(v.div(FLOOR_PITCH));
  const inRange = (x: typeof fu, lo: number, hi: number) => step(lo, x).mul(step(x, hi));
  const ground = float(1).sub(step(FLOOR_PITCH, v));
  const upper = float(1).sub(ground);

  const windowMask = inRange(fu, WIN_U0, WIN_U1).mul(inRange(fv, WIN_V0, WIN_V1)).mul(upper).mul(wall);
  // Metres to the nearest opening edge: the frame is the outer 0.08 m, plus a thin centre mullion.
  const edge = min(min(fu.sub(WIN_U0), float(WIN_U1).sub(fu)).mul(WINDOW_PITCH), min(fv.sub(WIN_V0), float(WIN_V1).sub(fv)).mul(FLOOR_PITCH));
  const mullion = step(abs(fu.sub((WIN_U0 + WIN_U1) / 2)).mul(WINDOW_PITCH), MULLION_M);
  const frameMask = windowMask.mul(max(float(1).sub(step(FRAME_M, edge)), mullion));
  const glassMask = windowMask.sub(frameMask);

  // The sill ledge sits on the window's lower edge and throws a shadow that fades over 0.45 m.
  const yb = fv.mul(FLOOR_PITCH);
  const sillY = WIN_V0 * FLOOR_PITCH;
  const ledge = inRange(fu, WIN_U0 - 0.03, WIN_U1 + 0.03).mul(inRange(yb, sillY - 0.07, sillY)).mul(upper).mul(wall);
  const sillShadow = inRange(fu, WIN_U0 - 0.01, WIN_U1 + 0.01).mul(step(yb, sillY - 0.07)).mul(upper).mul(wall)
    .mul(float(1).sub(clamp(float(sillY - 0.07).sub(yb).div(0.45), 0, 1))).mul(0.5);

  // Grime: vertical streaks running down from each sill; columns and length are picked per window,
  // seeded from the window whose sill is above the fragment so a streak stays coherent across floors.
  const tile = floor(positionWorld.xz.div(50));
  const tileSeed = tile.x.mul(7919).add(tile.y.mul(104729));
  const cellSeed = floor(u.div(WINDOW_PITCH)).add(floor(v.div(FLOOR_PITCH)).mul(131)).add(tileSeed);
  // hash() converts its seed to uint; negative world coordinates would all collapse to one value.
  const cellRand = hash(cellSeed.abs());
  const sillRow = float(v).sub(sillY).div(FLOOR_PITCH).ceil(); // index of the sill plane above this fragment
  const below = sillRow.mul(FLOOR_PITCH).add(sillY).sub(v); // metres under that sill
  const streakSeed = floor(u.div(WINDOW_PITCH)).add(sillRow.mul(131)).add(tileSeed);
  const streakLen = float(0.8).add(hash(streakSeed.abs()).mul(1.6));
  const column = floor(fu.mul(WINDOW_PITCH).mul(9));
  const colRand = hash(column.add(streakSeed.mul(31)).abs());
  const streakOn = inRange(fu, WIN_U0 - 0.02, WIN_U1 + 0.02).mul(step(0.4, colRand)).mul(float(1).sub(step(streakLen, below))).mul(step(1, sillRow));
  const grime = streakOn.mul(float(1).sub(below.div(streakLen))).mul(colRand).mul(0.8).mul(wall);
  // Each lit window gets its own brightness and a vertical falloff, so the night facade is not a grid of identical flat rectangles.
  const glow = mix(float(0.55), float(1), hash(cellSeed.abs().add(977))).mul(mix(float(1), float(0.6), clamp(fv.sub(0.3).div(0.48), 0, 1)));

  // --- shading ---------------------------------------------------------------------------------
  const groundBand = ground.mul(wall).mul(0.15);
  const contactAo = float(1).sub(float(1).sub(smoothstep(0, 0.8, v)).mul(0.4).mul(wall));
  const shade = float(1).sub(groundBand).mul(contactAo).mul(float(1).sub(sillShadow)).mul(float(1).sub(grime));

  const isBrick = STYLE_IS_BRICK.map((i) => styleIdx.equal(i)).reduce((a, b) => a.or(b));
  const albedo = diffS.rgb.mul(tint.element(layer)).mul(select(isFlatRoof, float(FLAT_ROOF_LIGHTEN), float(1)));
  const lit0 = albedo.mul(shade);
  const withLedge = mix(lit0, lit0.mul(1.7).add(0.06), ledge);

  // Ground-floor shutters: slatted roll-ups; painted wood on brick; a minority in saffron or teal.
  const shutterMask = inRange(fu, 0.1, 0.9).mul(inRange(fv, 0.05, 0.75)).mul(ground).mul(wall);
  const slats = float(0.8).add(float(0.2).mul(step(0.5, fract(v.div(0.1)))));
  const primary = select(isBrick, rgb('#6b4426'), rgb('#7c7f82'));
  const secondary = select(isBrick, rgb('#c98a1a'), rgb('#2f5d6e'));
  const shutterColor = mix(primary, secondary, step(0.72, cellRand)).mul(slats).mul(contactAo);
  const withShutters = mix(withLedge, shutterColor, shutterMask);

  const glassColor = mix(rgb('#1b2128'), rgb('#4d6377'), fract(fv.sub(WIN_V0).div(WIN_V1 - WIN_V0)).mul(0.55));
  const frameColor = select(isBrick.or(styleIdx.equal(TIN_INDEX)), rgb('#8a6a45'), rgb('#26292c'));
  const colorNode = mix(mix(withShutters, glassColor, glassMask), frameColor, frameMask);

  const lit = step(0.6, cellRand).mul(glassMask);

  const mat = new THREE.MeshStandardNodeMaterial() as FacadeMaterial;
  mat.colorNode = colorNode;
  // Glass and shutters stay flat; everything else takes the normal map.
  mat.normalNode = normalMap(mix(norS.rgb, vec3(0.5, 0.5, 1.0), windowMask.add(shutterMask.mul(0.7)).clamp(0, 1)), vec2(1, 1));
  mat.roughnessNode = mix(mix(roughS.r, float(0.6), max(frameMask, shutterMask.mul(0.5))), float(0.12), glassMask);
  mat.metalnessNode = select(styleIdx.equal(TIN_INDEX).and(wall.greaterThan(0.5)), float(0.35), float(0));
  mat.emissiveNode = vec3(1.0, 0.55, 0.22).mul(night).mul(lit).mul(glow).mul(WINDOW_EMISSIVE);
  mat.userData.texturesReady = textures.ready;
  return mat;
}
