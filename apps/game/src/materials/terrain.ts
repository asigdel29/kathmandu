import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, clamp, dot, exp, float, floor, fract, length, mix, mx_noise_float, normalWorld, positionWorld, sin, smoothstep, step, texture, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type N = Node<'float'>;
type N2 = Node<'vec2'>;
type N3 = Node<'vec3'>;

/** World metres covered by one repeat of a detail texture. */
export const DETAIL_REPEAT_M = 8;
/** Size of the low-frequency variation patches that hide the repeat, m. */
export const MACRO_NOISE_M = 40;
/** Slope (degrees) at which the valley-rim rock starts to show; it is fully rock 10 degrees later. */
export const ROCK_SLOPE_DEG = 35;
const ROCK_FULL_DEG = 50;
/** Furrow spacing on farmland, m. */
const FURROW_M = 1.6;

/** Land-cover tints written to terrain.glb `COLOR_0` (linear), mirrored from the pipeline's LANDCOVER table. */
export const LANDCOVER_TINTS = {
  urban: [0.52, 0.48, 0.42], park: [0.30, 0.45, 0.22], forest: [0.16, 0.30, 0.14],
  farmland: [0.55, 0.47, 0.25], grass: [0.36, 0.50, 0.26], scrub: [0.33, 0.40, 0.22],
} as const;
/** How far (in linear colour distance) a vertex tint may sit from a land-cover colour and still count as it. */
const TINT_SIGMA = 0.05;

export type SurfaceLayer = 'dust' | 'grass' | 'farm' | 'forest' | 'rock';
export const TERRAIN_TEXTURE_FILES: Record<SurfaceLayer, string> = {
  dust: 'terrain-dust.jpg', grass: 'terrain-grass.jpg', farm: 'terrain-farm.jpg', forest: 'terrain-forest.jpg', rock: 'terrain-rock.jpg',
};
/** Mean linear luminance of each 1k texture; detail is expressed relative to it so the land-cover tint keeps the overall tone. */
const AVG_LUMA: Record<SurfaceLayer, number> = { dust: 0.2006, grass: 0.0737, farm: 0.0589, forest: 0.1101, rock: 0.1581 };
/** Mean linear colour of each texture; `DETAIL_CONTRAST` pulls a layer's detail towards it (1 = the photo as is). */
const AVG_COLOR: Record<SurfaceLayer, [number, number, number]> = {
  dust: [0.2343, 0.1963, 0.1448], grass: [0.0816, 0.0775, 0.0128], farm: [0.0979, 0.051, 0.0214], forest: [0.1475, 0.1042, 0.0597], rock: [0.2308, 0.1441, 0.0828],
};
const DETAIL_CONTRAST: Record<SurfaceLayer, number> = { dust: 0.45, grass: 0.9, farm: 0.85, forest: 0.9, rock: 0.85 };
const LAYER_OWN_HUE: Record<Exclude<SurfaceLayer, 'rock'>, number> = { dust: 0.65, grass: 0.4, farm: 0.5, forest: 0.4 };

export function loadRepeatingTexture(url: string, loader: THREE.TextureLoader = new THREE.TextureLoader()): THREE.Texture {
  const tex = loader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export type TerrainTextures = Record<SurfaceLayer, THREE.Texture>;
export function loadTerrainTextures(base: string, loader?: THREE.TextureLoader): TerrainTextures {
  const out = {} as TerrainTextures;
  for (const k of Object.keys(TERRAIN_TEXTURE_FILES) as SurfaceLayer[]) out[k] = loadRepeatingTexture(`${base}${TERRAIN_TEXTURE_FILES[k]}`, loader);
  return out;
}

const LUMA = vec3(0.2126, 0.7152, 0.0722);
export const luminance3 = (c: N3): N => dot(c, LUMA);

/** Rotates a world-space xz coordinate by `deg` degrees. */
export function rotateXZ(p: N2, deg: number): N2 {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
}

/** ~[-1, 1] value noise in 40 m patches; one octave, so it only breaks up repeats and never adds detail of its own. */
export function macroNoise(wp: N2, offset = 0): N {
  return mx_noise_float(vec3(wp.x.div(MACRO_NOISE_M).add(offset), wp.y.div(MACRO_NOISE_M).add(offset * 1.7), float(offset)));
}

/**
 * One tiling-free sample: a fine layer at `repeatM` metres per repeat and a coarser, rotated layer at 1.7x that,
 * cross-faded by the macro noise so no single repeat grid shows across a patch.
 */
export function sampleUntiled(tex: THREE.Texture, wp: N2, repeatM: number, macro: N): N3 {
  const a = (wp.div(repeatM).add(vec2(macro.mul(0.35), macro.mul(-0.35))) as unknown as N2);
  const b = rotateXZ(wp, 37).div(repeatM * 1.7);
  const fine = texture(tex, a).rgb as unknown as N3;
  const coarse = texture(tex, b).rgb as unknown as N3;
  return mix(fine, coarse, smoothstep(-0.45, 0.45, macro)) as N3;
}

/** Normalised weights of the four ground layers for a vertex tint. Exposed as plain maths for tests via `landcoverWeights`. */
export function landcoverWeights(tint: readonly [number, number, number]): Record<'dust' | 'grass' | 'forest' | 'farm', number> {
  const w = (c: readonly [number, number, number]) => Math.exp(-((tint[0] - c[0]) ** 2 + (tint[1] - c[1]) ** 2 + (tint[2] - c[2]) ** 2) / (2 * TINT_SIGMA ** 2));
  const L = LANDCOVER_TINTS;
  // A small constant keeps tints that match no class (seams between classes) on dusty ground.
  const dust = w(L.urban) + 0.02, grass = w(L.park) + w(L.grass) + w(L.scrub), forest = w(L.forest), farm = w(L.farmland);
  const sum = dust + grass + forest + farm;
  return { dust: dust / sum, grass: grass / sum, forest: forest / sum, farm: farm / sum };
}

/**
 * Valley terrain: dusty ground, grass, farmland and forest-floor detail textures weighted by the vertex
 * land-cover tint (`COLOR_0`), world-projected at 8 m per repeat with 40 m macro variation, and rock on
 * slopes steeper than 35 degrees.
 */
export function createTerrainMaterial(textures: TerrainTextures): THREE.MeshStandardNodeMaterial {
  const wp = positionWorld.xz as unknown as N2;
  const tint = attribute('color', 'vec3') as unknown as N3;
  const n40 = macroNoise(wp);
  const n17 = macroNoise(wp.mul(2.3), 5.3);

  const wgt = (c: readonly [number, number, number]) => {
    const d = tint.sub(vec3(c[0], c[1], c[2]));
    return exp(dot(d, d).div(-2 * TINT_SIGMA ** 2)) as N;
  };
  const L = LANDCOVER_TINTS;
  const wDust = wgt(L.urban).add(0.02), wGrass = wgt(L.park).add(wgt(L.grass)).add(wgt(L.scrub)), wForest = wgt(L.forest), wFarm = wgt(L.farmland);
  const wSum = wDust.add(wGrass).add(wForest).add(wFarm);

  const tintLuma = luminance3(tint);
  // Detail relative to the texture's mean, rescaled to the tint's brightness; `own` is how much of the texture's own
  // hue replaces the tint's (the tint carries the green of forest and grass, the texture the dust of bare ground).
  const layer = (k: Exclude<SurfaceLayer, 'rock'>): N3 => {
    const avg = AVG_COLOR[k];
    const detail = mix(vec3(avg[0], avg[1], avg[2]), sampleUntiled(textures[k], wp, DETAIL_REPEAT_M, n40), DETAIL_CONTRAST[k]) as N3;
    return mix(tint, detail.mul(tintLuma.div(AVG_LUMA[k])), LAYER_OWN_HUE[k]) as N3;
  };

  // Rows across farmland, along x or z per 90 m field, faded out with distance (they would alias).
  const fieldKey = floor(wp.div(90));
  const fieldDir = step(0.5, fract(sin(dot(fieldKey, vec2(12.9898, 78.233))).mul(43758.5453)));
  const rowCoord = mix(wp.x, wp.y, fieldDir).add(n17.mul(0.4));
  const rowFade = float(1).sub(smoothstep(60, 220, length(positionWorld.sub(cameraPosition))));
  const row = sin(rowCoord.mul((Math.PI * 2) / FURROW_M)).mul(0.5).add(0.5);
  const furrow = mix(float(1), mix(float(0.78), float(1.1), row), rowFade);

  const ground = wDust.mul(layer('dust')).add(wGrass.mul(layer('grass'))).add(wForest.mul(layer('forest'))).add(wFarm.mul(layer('farm')).mul(furrow)).div(wSum) as N3;

  // Rock: the photo pulled towards grey (the raw one is rust-brown), at the tint's brightness so it sits in the surrounding ground.
  const rockRaw = sampleUntiled(textures.rock, wp, DETAIL_REPEAT_M, n40) as N3;
  const rockLum = luminance3(rockRaw);
  const rock = mix(rockRaw, vec3(rockLum, rockLum, rockLum).mul(vec3(1.0, 0.95, 0.88)), 0.45).mul(0.85) as N3;
  const cosFull = Math.cos((ROCK_FULL_DEG * Math.PI) / 180), cosStart = Math.cos((ROCK_SLOPE_DEG * Math.PI) / 180);
  const rockW = float(1).sub(smoothstep(cosFull, cosStart, normalWorld.y));

  let albedo = mix(ground, rock, rockW) as N3;
  // Macro tone and a slight warm/cool drift per patch.
  albedo = albedo.mul(clamp(n40.mul(0.22).add(1), 0.7, 1.3)) as N3;
  // Mid-scale mottling (7 m patches) keeps open ground from going flat once the photo detail has mipped out at
  // iso distance. It is noise, so it has no grid; it fades out far away where it would only shimmer.
  const mottleFade = float(1).sub(smoothstep(250, 900, length(positionWorld.sub(cameraPosition))));
  albedo = albedo.mul(float(1).add(macroNoise(wp.mul(MACRO_NOISE_M / 7), 11.7).mul(0.14).mul(mottleFade))) as N3;
  albedo = mix(albedo, albedo.mul(vec3(1.07, 1.0, 0.9)), n17.mul(0.5).add(0.5)) as N3;

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = albedo;
  mat.roughnessNode = mix(float(0.97), float(0.88), rockW);
  mat.metalnessNode = float(0);
  return mat;
}
