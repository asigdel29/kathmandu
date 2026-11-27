import * as THREE from 'three/webgpu';
import { nightAmount, sunElevation } from './Clock.ts';

/**
 * Every lighting, exposure, sky and fog constant lives in this file. Sky.ts applies the values returned by
 * lightingAt(t); nothing else in the game hard-codes light intensities.
 *
 * Units: three.js physical units. Colours given as hex are sRGB; colours given as [r, g, b] triples are linear
 * radiance before tone mapping (the same space the sky shader and the fog work in).
 */

// ---------------------------------------------------------------------------------------------------------
// Tone mapping
// ---------------------------------------------------------------------------------------------------------

/** ACES filmic exposure. Day sits low so the Preetham sky and sunlit walls stay under the shoulder (no clipped white). */
export const EXPOSURE_DAY = 0.58;
/** A little more exposure at night so the moonlit street and the sky gradient read; still inside 0.55–0.75. */
export const EXPOSURE_NIGHT = 0.74;

// ---------------------------------------------------------------------------------------------------------
// Sky (SkyMesh, Preetham model)
// ---------------------------------------------------------------------------------------------------------

/** Haze. 4–6 keeps a dusty valley sky without turning the horizon white. */
export const SKY_TURBIDITY = 5;
/** Blue strength of the sky. 1.2–2. */
export const SKY_RAYLEIGH = 1.6;
/** Aerosol glow around the sun. 0.005–0.02. */
export const SKY_MIE = 0.012;
export const SKY_MIE_G = 0.8;
export const SKY_CLOUD_COVERAGE = 0.4;

/**
 * Twilight and night layer, added on top of the SkyMesh (which goes black once the sun is below the horizon).
 * Keyed by sun elevation in degrees; between keys the colours are interpolated linearly. Above the last key the
 * layer is zero. `zenith` is straight up, `horizon` at eye level; in between they are blended by view elevation.
 */
export interface SkyKey { elevDeg: number; zenith: [number, number, number]; horizon: [number, number, number] }
export const SKY_NIGHT_KEYS: readonly SkyKey[] = [
  { elevDeg: -12, zenith: [0.004, 0.009, 0.034], horizon: [0.016, 0.026, 0.07] }, // deep blue, never black
  { elevDeg: -6, zenith: [0.006, 0.013, 0.05], horizon: [0.05, 0.05, 0.11] },
  { elevDeg: -2, zenith: [0.012, 0.024, 0.075], horizon: [0.22, 0.11, 0.08] }, // dusk / dawn glow
  { elevDeg: 3, zenith: [0.01, 0.02, 0.05], horizon: [0.12, 0.06, 0.035] },
  { elevDeg: 9, zenith: [0, 0, 0], horizon: [0, 0, 0] },
];
/** Exponent of the zenith<->horizon blend for the added layer (smaller = horizon colour reaches higher). */
export const SKY_LAYER_GRADIENT_POWER = 0.45;

// ---------------------------------------------------------------------------------------------------------
// Sun and moon (one shadow-casting DirectionalLight: the sun by day, the moon by night)
// ---------------------------------------------------------------------------------------------------------

/** Sun intensity at full strength (midday). 2.0–3.0. */
export const SUN_NOON_INTENSITY = 2.6;
/** sin(elevation) at which the sun reaches full intensity; below it the sun scales down with elevation. */
export const SUN_FULL_AT_SIN_ELEVATION = 0.55;
/** Sun colour high in the sky and at the horizon (sRGB); interpolated by elevation. */
export const SUN_COLOR_HIGH = 0xfff2dc;
export const SUN_COLOR_LOW = 0xff9a55;
/** Elevation (radians) over which the sun colour goes from LOW to HIGH. */
export const SUN_COLOR_RAMP_RAD = 0.5;
/** Moon directional light, opposite the sun. */
export const MOON_INTENSITY = 0.15;
export const MOON_COLOR = 0x9db8ff;
/** Offset of the light from the shadow target, metres. */
export const SUN_DISTANCE_M = 800;

// ---------------------------------------------------------------------------------------------------------
// Ambient: hemisphere light and sky environment map
// ---------------------------------------------------------------------------------------------------------

/** Day hemisphere fill: sky colour above, warm bounce from the ground below. 0.5–0.8. */
export const HEMI_SKY_DAY = 0xbfd4ff;
export const HEMI_GROUND_DAY = 0x8a7a66;
export const HEMI_INTENSITY_DAY = 0.5;
/** Night ambient. 0.08–0.12. */
export const HEMI_SKY_NIGHT = 0x6f8cff;
export const HEMI_GROUND_NIGHT = 0x4a4038;
export const HEMI_INTENSITY_NIGHT = 0.1;
/** Scene environment intensity (sky image-based light) by day and night. */
export const ENV_INTENSITY_DAY = 0.3;
export const ENV_INTENSITY_NIGHT = 4.5;
/** The environment map is rebuilt when the clock moves by at least this many game hours. */
export const ENV_REFRESH_HOURS = 0.5;
/** Cube face size of the sky capture before PMREM filtering (the generator rounds down to a power of two, minimum 256). */
export const ENV_CUBE_SIZE = 256;

// ---------------------------------------------------------------------------------------------------------
// Fog
// ---------------------------------------------------------------------------------------------------------

/** FogExp2 density. 0.00008–0.00015. */
export const FOG_DENSITY = 0.0001;
/** The fog takes the sampled sky horizon colour, pulled towards this dust tint by FOG_DUST_MIX. */
export const FOG_DUST_COLOR = 0xd9c7a8;
export const FOG_DUST_MIX = 0.2;
/** Elevation above the horizon (radians) and angles from the sun at which the horizon colour is sampled. */
export const FOG_SAMPLE_ELEVATION = 0.06;
export const FOG_SAMPLE_SUN_ANGLES: readonly number[] = [Math.PI / 2, Math.PI];

// ---------------------------------------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------------------------------------

export const SHADOW_MAP_SIZE = 4096;
/** Half-extent of the orthographic shadow frustum, metres (follows the player). */
export const SHADOW_RADIUS_M = 300;
export const SHADOW_NEAR = 1;
export const SHADOW_FAR = 2500;
/** Depth bias (against acne on flat roofs and roads) and normal-direction bias (against acne on facades). */
export const SHADOW_BIAS = -0.0004;
/** Metres. The texel is 600/4096 = 0.15 m; ~1.5 texels removes acne without detaching shadows from wall bases. */
export const SHADOW_NORMAL_BIAS = 0.22;

// ---------------------------------------------------------------------------------------------------------
// Night: streetlights and windows
// ---------------------------------------------------------------------------------------------------------

/** One PointLight per streetlight within this radius of the player, nearest first. */
export const LAMP_RADIUS_M = 60;
/** Hard cap on live PointLights. */
export const LAMP_MAX_LIGHTS = 24;
/** PointLight reach and falloff. */
export const LAMP_DISTANCE_M = 18;
export const LAMP_DECAY = 2;
/** Candela of a lit streetlight, and its warm colour (sodium-ish). */
export const LAMP_INTENSITY = 220;
export const LAMP_COLOR = 0xffb35c;
/** Height of the lamp head above the pole base (matches the placeholder streetlight model), metres, and its sideways reach. */
export const LAMP_HEAD_HEIGHT_M = 6.8;
export const LAMP_HEAD_REACH_M = 0.25;
/** night amount above which the lamp lights are on; below it they are hidden (no per-fragment cost by day). */
export const LAMP_ON_NIGHT = 0.05;
/** How often the nearest-lamp set is recomputed, seconds. */
export const LAMP_REFRESH_S = 0.25;
/** Window emissive strength at full night. 0.6–1.0. */
export const WINDOW_EMISSIVE = 0.8;

// ---------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------

export interface LightingState {
  /** Sun elevation, radians. */
  elevation: number;
  /** Unit vector towards the sun. */
  sunDirection: THREE.Vector3;
  /** 0 by day, 1 at night (smooth through twilight). */
  night: number;
  /** Unit vector towards whichever body lights the scene (sun above the horizon, moon below it). */
  lightDirection: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
  fogColor: THREE.Color;
  fogDensity: number;
  /** Added to the SkyMesh output (linear). */
  skyZenithAdd: THREE.Color;
  skyHorizonAdd: THREE.Color;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number): number => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

/** Direction of the sun for time of day t (hours). East at dawn (+x), south at noon (+z), west at dusk. */
export function sunDirection(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const h = ((t - 12) / 12) * Math.PI;
  const elev = sunElevation(t);
  const az = -h;
  return out.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
}

/** Interpolated twilight/night sky layer for a sun elevation in degrees. */
export function skyNightLayer(elevDeg: number): { zenith: [number, number, number]; horizon: [number, number, number] } {
  const keys = SKY_NIGHT_KEYS;
  const first = keys[0]!; const last = keys[keys.length - 1]!;
  if (elevDeg <= first.elevDeg) return { zenith: [...first.zenith], horizon: [...first.horizon] };
  if (elevDeg >= last.elevDeg) return { zenith: [...last.zenith], horizon: [...last.horizon] };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!; const a = keys[i - 1]!;
    if (elevDeg > b.elevDeg) continue;
    const k = (elevDeg - a.elevDeg) / (b.elevDeg - a.elevDeg);
    const mix = (x: readonly number[], y: readonly number[]): [number, number, number] => [lerp(x[0]!, y[0]!, k), lerp(x[1]!, y[1]!, k), lerp(x[2]!, y[2]!, k)];
    return { zenith: mix(a.zenith, b.zenith), horizon: mix(a.horizon, b.horizon) };
  }
  return { zenith: [...last.zenith], horizon: [...last.horizon] };
}

// Preetham constants, as in SkyMesh (three/addons/objects/SkyMesh.js).
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5] as const;
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14] as const;
const CUTOFF_ANGLE = 1.6110731556870734;
const STEEPNESS = 1.5;

/** CPU mirror of the SkyMesh fragment shader: linear radiance (before tone mapping) seen along `dir`. */
export function skyRadiance(sunDir: THREE.Vector3, dir: THREE.Vector3): [number, number, number] {
  const zc = Math.min(1, Math.max(-1, sunDir.y));
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-(CUTOFF_ANGLE - Math.acos(zc)) / STEEPNESS));
  const betaM0 = 0.434 * 0.2 * SKY_TURBIDITY * 1e-17 * SKY_MIE;
  const za = Math.acos(Math.max(0, dir.y));
  const inverse = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
  const cosTheta = dir.dot(sunDir);
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g2 = SKY_MIE_G * SKY_MIE_G;
  const mPhase = (1 / (4 * Math.PI)) * (1 - g2) / Math.pow(1 - 2 * SKY_MIE_G * cosTheta + g2, 1.5);
  const horizonMix = clamp01(Math.pow(1 - sunDir.y, 5));
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const betaR = TOTAL_RAYLEIGH[c]! * SKY_RAYLEIGH;
    const betaM = betaM0 * MIE_CONST[c]!;
    const fex = Math.exp(-(betaR * 8.4e3 * inverse + betaM * 1.25e3 * inverse));
    const scatter = (sunE * (betaR * rPhase + betaM * mPhase)) / (betaR + betaM);
    let lin = Math.pow(scatter * (1 - fex), 1.5);
    lin *= lerp(1, Math.pow(scatter * fex, 0.5), horizonMix);
    out[c] = (lin + 0.1 * fex) * 0.04;
  }
  return [out[0] + 0, out[1] + 0.0003, out[2] + 0.00075];
}

/** Sampled horizon colour (linear): the sky at eye level averaged over directions at fixed angles from the sun, plus the night layer. */
export function horizonColor(sunDir: THREE.Vector3, out = new THREE.Color()): THREE.Color {
  const elevDeg = (Math.asin(Math.min(1, Math.max(-1, sunDir.y))) * 180) / Math.PI;
  const up = new THREE.Vector3(0, 1, 0);
  // Horizontal unit vector pointing at the sun (any horizontal vector when the sun is at the zenith).
  const toSun = new THREE.Vector3(sunDir.x, 0, sunDir.z);
  if (toSun.lengthSq() < 1e-8) toSun.set(0, 0, 1);
  toSun.normalize();
  const dir = new THREE.Vector3();
  let r = 0; let g = 0; let b = 0;
  for (const a of FOG_SAMPLE_SUN_ANGLES) {
    dir.copy(toSun).applyAxisAngle(up, a).multiplyScalar(Math.cos(FOG_SAMPLE_ELEVATION)).setY(Math.sin(FOG_SAMPLE_ELEVATION));
    const c = skyRadiance(sunDir, dir);
    r += c[0]; g += c[1]; b += c[2];
  }
  const n = FOG_SAMPLE_SUN_ANGLES.length;
  const layer = skyNightLayer(elevDeg).horizon;
  return out.setRGB(r / n + layer[0], g / n + layer[1], b / n + layer[2], THREE.LinearSRGBColorSpace);
}

/** All lighting values for time of day t (hours). Pure: same t, same result. */
export function lightingAt(t: number): LightingState {
  const elevation = sunElevation(t);
  const elevDeg = (elevation * 180) / Math.PI;
  const night = nightAmount(t);
  const sunDir = sunDirection(t);

  const sunUp = elevation > 0;
  const lightDirection = sunUp ? sunDir.clone() : sunDir.clone().negate();
  const lightColor = new THREE.Color();
  let lightIntensity: number;
  if (sunUp) {
    lightIntensity = SUN_NOON_INTENSITY * smoothstep(0, SUN_FULL_AT_SIN_ELEVATION, Math.sin(elevation));
    lightColor.set(SUN_COLOR_LOW).lerp(new THREE.Color(SUN_COLOR_HIGH), clamp01(elevation / SUN_COLOR_RAMP_RAD));
  } else {
    // The moon takes over once the sun is below the horizon.
    lightIntensity = MOON_INTENSITY * smoothstep(0, 0.08, -elevation);
    lightColor.set(MOON_COLOR);
  }

  const hemiSky = new THREE.Color(HEMI_SKY_DAY).lerp(new THREE.Color(HEMI_SKY_NIGHT), night);
  const hemiGround = new THREE.Color(HEMI_GROUND_DAY).lerp(new THREE.Color(HEMI_GROUND_NIGHT), night);

  const layer = skyNightLayer(elevDeg);
  const skyZenithAdd = new THREE.Color().setRGB(...layer.zenith, THREE.LinearSRGBColorSpace);
  const skyHorizonAdd = new THREE.Color().setRGB(...layer.horizon, THREE.LinearSRGBColorSpace);

  const fogColor = horizonColor(sunDir).lerp(new THREE.Color(FOG_DUST_COLOR), FOG_DUST_MIX * (1 - night));

  return {
    elevation, sunDirection: sunDir, night, lightDirection, lightColor, lightIntensity,
    hemiSky, hemiGround, hemiIntensity: lerp(HEMI_INTENSITY_DAY, HEMI_INTENSITY_NIGHT, night),
    envIntensity: lerp(ENV_INTENSITY_DAY, ENV_INTENSITY_NIGHT, night),
    exposure: lerp(EXPOSURE_DAY, EXPOSURE_NIGHT, night),
    fogColor, fogDensity: FOG_DENSITY, skyZenithAdd, skyHorizonAdd,
  };
}

/** True when the clock has moved far enough (wrapping at midnight) that the environment map should be rebuilt. */
export function needsEnvRefresh(last: number | undefined, now: number): boolean {
  if (last === undefined) return true;
  const d = Math.abs(now - last) % 24;
  return Math.min(d, 24 - d) >= ENV_REFRESH_HOURS;
}
