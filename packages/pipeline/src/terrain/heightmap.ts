import { HEIGHTMAP_N, HEIGHT_STEP, localToLonLat, tileOrigin } from '@ktm/geo';
import { sampleElevation, type PixelSource } from './terrarium.ts';
export { heightAt, HEIGHT_STEP as STEP } from '@ktm/geo';

/** Rows run north->south (local z), columns west->east (local x). Values: meters above sea level. */
export async function buildHeightmap(src: PixelSource, tile: string): Promise<Float32Array> {
  const o = tileOrigin(tile);
  const out = new Float32Array(HEIGHTMAP_N * HEIGHTMAP_N);
  for (let r = 0; r < HEIGHTMAP_N; r++) {
    for (let c = 0; c < HEIGHTMAP_N; c++) {
      const { lon, lat } = localToLonLat(o.x + c * HEIGHT_STEP, o.z + r * HEIGHT_STEP);
      out[r * HEIGHTMAP_N + c] = await sampleElevation(src, lon, lat);
    }
  }
  return out;
}
