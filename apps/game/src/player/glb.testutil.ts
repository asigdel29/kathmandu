import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/** The directory of the character models. */
export const CHARACTER_DIR = new URL('../../public/models/characters/', import.meta.url);

interface GltfJson {
  images?: unknown; textures?: unknown; samplers?: unknown;
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }[];
}

/** Splits a GLB into its JSON and binary chunks. */
export function readGlb(file: string): { json: Record<string, unknown>; bin: Uint8Array } {
  const buf = readFileSync(new URL(file, CHARACTER_DIR));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Record<string, unknown>;
  const binStart = 20 + jsonLen + 8;
  return { json, bin: new Uint8Array(buf.buffer, buf.byteOffset + binStart, view.getUint32(20 + jsonLen, true)) };
}

/** Parses a character GLB in node: textures are dropped (nothing here needs pixels), everything else loads as in the app. */
export async function loadCharacter(file: string): Promise<GLTF> {
  const { json, bin } = readGlb(file);
  const g = json as GltfJson;
  delete g.images; delete g.textures; delete g.samplers;
  for (const m of g.materials ?? []) if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.length % 4)) % 4;
  const jsonChunk = new Uint8Array(text.length + jsonPad).fill(0x20); jsonChunk.set(text);
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length + binPad;
  const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jsonChunk, 20);
  const o = 20 + jsonChunk.length;
  dv.setUint32(o, bin.length + binPad, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(out.buffer, '', resolve, reject);
  });
}

export function clipsOf(gltf: GLTF): Record<string, THREE.AnimationClip> {
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const c of gltf.animations) clips[c.name] = c;
  return clips;
}
