import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTER_DIR, readGlb } from './glb.testutil.ts';

interface Accessor { count: number }
interface Primitive { attributes: Record<string, number>; indices?: number }
interface Json {
  accessors: Accessor[];
  meshes: { primitives: Primitive[] }[];
  images?: { bufferView: number; mimeType: string }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  animations?: { name: string }[];
  skins?: { joints: number[] }[];
  nodes: { name?: string }[];
}

const MODELS = ['player', 'ped_0', 'ped_1', 'ped_2', 'ped_3'];
const PLAYER_CLIPS = ['idle', 'walk', 'run', 'sprint', 'jump_start', 'jump_loop', 'jump_land', 'enter', 'drive', 'sit'];
const MB = 1024 * 1024;

/** Width and height of a JPEG from its first SOF marker. */
function jpegSize(data: Uint8Array): { w: number; h: number } {
  let i = 2;
  while (i < data.length) {
    if (data[i] !== 0xff) { i++; continue; }
    const marker = data[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (data[i + 5]! << 8) | data[i + 6]!, w: (data[i + 7]! << 8) | data[i + 8]! };
    }
    i += 2 + ((data[i + 2]! << 8) | data[i + 3]!);
  }
  throw new Error('no SOF marker');
}

function triangles(j: Json): number {
  let n = 0;
  for (const m of j.meshes) for (const p of m.primitives) n += (p.indices !== undefined ? j.accessors[p.indices]!.count : j.accessors[p.attributes.POSITION!]!.count) / 3;
  return n;
}

describe('character models', () => {
  it.each(MODELS)('%s stays inside the art budget', (name) => {
    const file = `${name}.glb`;
    const { json, bin } = readGlb(file);
    const j = json as unknown as Json;
    expect(statSync(new URL(file, CHARACTER_DIR)).size).toBeLessThan(8 * MB);
    expect(triangles(j)).toBeLessThan(25_000);
    expect(j.images).toBeDefined();
    for (const img of j.images!) {
      expect(img.mimeType).toBe('image/jpeg');
      const bv = j.bufferViews[img.bufferView]!;
      const start = bv.byteOffset ?? 0;
      const { w, h } = jpegSize(bin.subarray(start, start + bv.byteLength));
      expect(w).toBeLessThanOrEqual(1024); expect(h).toBeLessThanOrEqual(1024);
    }
    expect(j.skins).toHaveLength(1);
    expect(j.skins![0]!.joints).toHaveLength(65);
    const names = (j.animations ?? []).map((a) => a.name);
    const want = name === 'player' ? PLAYER_CLIPS : ['idle', 'walk'];
    for (const clip of want) expect(names).toContain(clip);
  });

  it('all five models together stay under 20 MB', () => {
    const total = MODELS.reduce((a, m) => a + statSync(new URL(`${m}.glb`, CHARACTER_DIR)).size, 0);
    expect(total).toBeLessThan(20 * MB);
  });
});
