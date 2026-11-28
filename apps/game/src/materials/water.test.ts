import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { WATER_COLOR, WATER_OPACITY, WATER_ROUGHNESS, createWaterMaterial, rippleNormal } from './water.ts';

describe('water', () => {
  it('is the brown-green river colour, not blue', () => {
    const c = new THREE.Color(WATER_COLOR);
    expect(WATER_COLOR).toBe('#4d5a3a');
    expect(c.g).toBeGreaterThan(c.b);
    expect(c.r).toBeGreaterThan(c.b);
  });

  it('builds a 0.6 opaque, roughness 0.15 material without depth writes', () => {
    const m = createWaterMaterial();
    expect([WATER_OPACITY, WATER_ROUGHNESS]).toEqual([0.6, 0.15]);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.normalNode).toBeDefined();
    expect(m.opacityNode).toBeDefined();
  });

  it('ripples only slightly and moves with time', () => {
    let steepest = 0;
    for (let i = 0; i < 400; i++) {
      const [nx, ny, nz] = rippleNormal(i * 0.37, i * 0.91, i * 0.05);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6);
      steepest = Math.max(steepest, Math.hypot(nx, nz) / ny);
    }
    expect(steepest).toBeGreaterThan(0.01);
    expect(steepest).toBeLessThanOrEqual(0.07 + 1e-9);
    expect(rippleNormal(10, 20, 0)).not.toEqual(rippleNormal(10, 20, 3));
  });
});
