import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { LANDCOVER } from '../../../../packages/pipeline/src/build/terrain.ts';
import { DETAIL_REPEAT_M, LANDCOVER_TINTS, MACRO_NOISE_M, ROCK_SLOPE_DEG, TERRAIN_TEXTURE_FILES, createTerrainMaterial, landcoverWeights, type TerrainTextures } from './terrain.ts';

const tex = (): TerrainTextures => ({ dust: new THREE.Texture(), grass: new THREE.Texture(), farm: new THREE.Texture(), forest: new THREE.Texture(), rock: new THREE.Texture() });

describe('land-cover tints', () => {
  it('mirror the pipeline table that writes COLOR_0', () => {
    for (const [k, v] of Object.entries(LANDCOVER)) expect(LANDCOVER_TINTS[k as keyof typeof LANDCOVER_TINTS]).toEqual(v);
  });

  it('weight each ground layer by its own land cover', () => {
    const w = (k: keyof typeof LANDCOVER_TINTS) => landcoverWeights(LANDCOVER_TINTS[k]);
    expect(w('urban').dust).toBeGreaterThan(0.9);
    expect(w('farmland').farm).toBeGreaterThan(0.9);
    expect(w('forest').forest).toBeGreaterThan(0.9);
    for (const k of ['park', 'grass', 'scrub'] as const) expect(w(k).grass).toBeGreaterThan(0.9);
  });

  it('normalises, and sends tints that match nothing to dust', () => {
    const odd = landcoverWeights([0.9, 0.05, 0.9]);
    expect(odd.dust + odd.grass + odd.forest + odd.farm).toBeCloseTo(1, 6);
    expect(odd.dust).toBeGreaterThan(0.9);
  });
});

describe('terrain material', () => {
  it('uses 8 m detail, 40 m macro noise and rock from 35 degrees', () => {
    expect([DETAIL_REPEAT_M, MACRO_NOISE_M, ROCK_SLOPE_DEG]).toEqual([8, 40, 35]);
  });
  it('ships a texture file per layer', () => {
    expect(Object.keys(TERRAIN_TEXTURE_FILES).sort()).toEqual(['dust', 'farm', 'forest', 'grass', 'rock']);
  });
  it('builds a node material that does not read vertex colours through the fixed pipeline', () => {
    const m = createTerrainMaterial(tex());
    expect(m.colorNode).toBeDefined();
    expect(m.vertexColors).toBe(false);
    expect(m.roughnessNode).toBeDefined();
  });
});
