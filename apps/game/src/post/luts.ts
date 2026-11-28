import * as THREE from 'three/webgpu';

/**
 * Procedural colour-grading lookup tables. Both grades work in display space (after tone mapping and sRGB
 * encoding), on and into [0, 1] triples.
 */

export const LUT_SIZE = 32;
export type GradeKind = 'day' | 'night' | 'identity';
export type RGB = readonly [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const CONTRAST_PIVOT = 0.45;

interface Grade {
  /** Added to the colour in the shadows, scaled by (1 - smoothstep(0, 0.5, luma)). */
  shadow: RGB;
  /** Added in the highlights, scaled by smoothstep(0.5, 1, luma). */
  highlight: RGB;
  /** Mid-tone tint mixed in with a bell around luma 0.45. */
  mid?: { color: RGB; strength: number };
  saturation: number;
  /** Contrast about a mid-grey pivot (1 = none). */
  contrast: number;
  /** Black level: out = lift + out * (1 - max(lift)). */
  lift: RGB;
}

const GRADES: Record<'day' | 'night', Grade> = {
  // Warm highlights, teal shadows, +12 % saturation, lifted blacks.
  day: { shadow: [-0.045, 0.014, 0.032], highlight: [0.045, 0.012, -0.05], mid: { color: [1.0, 0.86, 0.68], strength: 0.08 }, saturation: 1.12, contrast: 1.1, lift: [0.02, 0.02, 0.02] },
  // Cool blue shadows, sodium-orange mids.
  night: { shadow: [-0.025, 0.0, 0.05], highlight: [0.0, 0.0, 0.0], mid: { color: [1.0, 0.62, 0.25], strength: 0.1 }, saturation: 1.08, contrast: 1.06, lift: [0.012, 0.016, 0.03] },
};

/** Grade one colour. */
export function gradeColor(kind: GradeKind, rgb: RGB): [number, number, number] {
  if (kind === 'identity') return [rgb[0], rgb[1], rgb[2]];
  const g = GRADES[kind];
  const l = luma(rgb);
  const shadowW = 1 - smoothstep(0, 0.5, l);
  const highW = smoothstep(0.5, 1, l);
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) c[i] = rgb[i]! + g.shadow[i]! * shadowW + g.highlight[i]! * highW;
  if (g.mid) {
    const bell = Math.exp(-(((l - 0.45) / 0.22) ** 2));
    // Tint towards the mid colour scaled to the pixel's own luma so brightness stays put.
    const tl = luma(g.mid.color);
    for (let i = 0; i < 3; i++) c[i] = lerp(c[i]!, l * (g.mid.color[i]! / tl), g.mid.strength * bell);
  }
  for (let i = 0; i < 3; i++) c[i] = clamp01(CONTRAST_PIVOT + (c[i]! - CONTRAST_PIVOT) * g.contrast);
  const l2 = luma(c);
  const out: [number, number, number] = [0, 0, 0];
  const liftMax = Math.max(...g.lift);
  for (let i = 0; i < 3; i++) {
    const sat = lerp(l2, c[i]!, g.saturation);
    out[i] = clamp01(g.lift[i]! + clamp01(sat) * (1 - liftMax));
  }
  return out;
}

/** RGBA float data, size^3 texels. Index = ((b * size + g) * size + r) * 4, so x = red, y = green, z = blue. */
export function generateLut(kind: GradeKind, size = LUT_SIZE): Float32Array {
  const data = new Float32Array(size * size * size * 4);
  const m = size - 1;
  let o = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const c = gradeColor(kind, [r / m, g / m, b / m]);
        data[o++] = c[0]; data[o++] = c[1]; data[o++] = c[2]; data[o++] = 1;
      }
    }
  }
  return data;
}

/** Trilinear lookup into data from generateLut (grid coordinate = rgb * (size - 1)). */
export function sampleLut(data: Float32Array, size: number, rgb: RGB): [number, number, number] {
  const m = size - 1;
  const p = rgb.map((v) => clamp01(v) * m) as [number, number, number];
  const i0 = p.map((v) => Math.min(Math.floor(v), m - 1)) as [number, number, number];
  const f = p.map((v, i) => v - i0[i]!) as [number, number, number];
  const at = (r: number, g: number, b: number, ch: number): number => data[((b * size + g) * size + r) * 4 + ch]!;
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      acc += w * at(i0[0] + dx, i0[1] + dy, i0[2] + dz, ch);
    }
    out[ch] = acc;
  }
  return out;
}

export function createLutTexture(kind: GradeKind, size = LUT_SIZE): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(generateLut(kind, size), size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.FloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
