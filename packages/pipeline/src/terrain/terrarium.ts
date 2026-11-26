import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export const TERRARIUM_Z = 14;
export const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/** Web Mercator global pixel coordinates at zoom z (256 px tiles). */
export function lonLatToPixel(lon: number, lat: number, z = TERRARIUM_Z): { x: number; y: number } {
  const n = 256 * 2 ** z;
  const latR = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n };
}

export interface PixelSource { elevationAt(gx: number, gy: number): Promise<number> }

/** Fetches and caches https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png (AWS Open Data, no key). */
export class TerrariumSource implements PixelSource {
  private tiles = new Map<string, Uint8Array>();
  constructor(private cacheDir: string, private z = TERRARIUM_Z) {}
  private async tile(tx: number, ty: number): Promise<Uint8Array> {
    const key = `${tx}/${ty}`;
    const hit = this.tiles.get(key);
    if (hit) return hit;
    const file = `${this.cacheDir}/${this.z}/${tx}/${ty}.png`;
    if (!existsSync(file)) {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${this.z}/${tx}/${ty}.png`);
      if (!res.ok) throw new Error(`terrarium ${this.z}/${tx}/${ty}: HTTP ${res.status}`);
      mkdirSync(`${this.cacheDir}/${this.z}/${tx}`, { recursive: true });
      writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
    }
    const png = PNG.sync.read(readFileSync(file));
    const data = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    this.tiles.set(key, data);
    return data;
  }
  async elevationAt(gx: number, gy: number): Promise<number> {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const d = await this.tile(tx, ty);
    const i = ((gy - ty * 256) * 256 + (gx - tx * 256)) * 4;
    return decodeTerrarium(d[i]!, d[i + 1]!, d[i + 2]!);
  }
}

export async function sampleElevation(src: PixelSource, lon: number, lat: number): Promise<number> {
  const p = lonLatToPixel(lon, lat);
  const fx = p.x - 0.5, fy = p.y - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const [a, b, c, d] = await Promise.all([src.elevationAt(x0, y0), src.elevationAt(x0 + 1, y0), src.elevationAt(x0, y0 + 1), src.elevationAt(x0 + 1, y0 + 1)]);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
