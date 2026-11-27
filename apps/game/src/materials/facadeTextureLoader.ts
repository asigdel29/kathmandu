import * as THREE from 'three/webgpu';
import { FACADE_STYLES, facadeTextureUrl, KIND_SIZE, STYLE_COUNT, type TextureKind } from './facadeTextures.ts';

export interface FacadeTextureSet {
  /** sRGB colour, one layer per style. */
  diff: THREE.DataArrayTexture;
  /** Tangent-space (GL) normals, one layer per style. */
  nor: THREE.DataArrayTexture;
  /** Roughness in the red channel, one layer per style. */
  rough: THREE.DataArrayTexture;
  /** Resolves once every layer has been decoded and uploaded; a failed layer keeps its neutral placeholder. */
  ready: Promise<void>;
}

function makeArray(kind: TextureKind): THREE.DataArrayTexture {
  const size = KIND_SIZE[kind];
  const channels = kind === 'rough' ? 1 : 4;
  const data = new Uint8Array(size * size * channels * STYLE_COUNT);
  // Neutral placeholder until the layers decode: mid grey, flat normal, rough surface.
  if (kind === 'diff') data.fill(160);
  else if (kind === 'rough') data.fill(217);
  else for (let i = 0; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 128; data[i + 2] = 255; data[i + 3] = 255; }
  const tex = new THREE.DataArrayTexture(data, size, size, STYLE_COUNT);
  tex.format = kind === 'rough' ? THREE.RedFormat : THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

async function decode(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, size, size).data;
}

/** Starts loading the per-style texture arrays from `<base>textures/facades/`. */
export function loadFacadeTextures(base: string): FacadeTextureSet {
  const diff = makeArray('diff'), nor = makeArray('nor'), rough = makeArray('rough');
  const targets: Record<TextureKind, THREE.DataArrayTexture> = { diff, nor, rough };
  const jobs: Promise<void>[] = [];
  FACADE_STYLES.forEach((style, layer) => {
    for (const kind of ['diff', 'nor', 'rough'] as const) {
      jobs.push(decode(facadeTextureUrl(base, style, kind), KIND_SIZE[kind]).then((rgba) => {
        const size = KIND_SIZE[kind];
        const tex = targets[kind];
        const dst = tex.image.data as Uint8Array;
        if (kind === 'rough') {
          const off = layer * size * size;
          for (let i = 0; i < size * size; i++) dst[off + i] = rgba[i * 4]!;
        } else {
          dst.set(rgba, layer * size * size * 4);
        }
      }).catch((e: unknown) => { console.warn(`facade texture ${style}_${kind}:`, e); }));
    }
  });
  const ready = Promise.all(jobs).then(() => { for (const t of [diff, nor, rough]) t.needsUpdate = true; });
  return { diff, nor, rough, ready };
}
