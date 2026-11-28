import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { modelFile, placeMatrix, TREE_VARIANTS, tintHex, variantOf } from './propPlacement.ts';

const prop = (o: Partial<{ type: 'wires' | 'streetlight' | 'tree'; x: number; y: number; z: number; rotY: number; scale: number; pitch: number }>) =>
  ({ type: 'streetlight' as const, x: 0, y: 0, z: 0, rotY: 0, scale: 1, ...o });

it('rotY is a heading: local +Z points along (sin rotY, cos rotY)', () => {
  const m = placeMatrix(prop({ x: 10, y: 2, z: -5, rotY: Math.PI / 2 }), { x: 100, z: 200 }, new THREE.Matrix4());
  const p = new THREE.Vector3(0, 0, 1).applyMatrix4(m);
  expect(p.x).toBeCloseTo(111); expect(p.y).toBeCloseTo(2); expect(p.z).toBeCloseTo(195);
});

it('stretches wires along their own Z only and pitches them up along the slope', () => {
  const L = Math.hypot(40, 4), pitch = Math.atan2(4, 40);
  const m = placeMatrix(prop({ type: 'wires', y: 8, rotY: Math.PI / 2, pitch, scale: L / 40 }), { x: 0, z: 0 }, new THREE.Matrix4());
  const end = new THREE.Vector3(0, 0, 40).applyMatrix4(m);
  expect(end.x).toBeCloseTo(40); expect(end.y).toBeCloseTo(12); expect(end.z).toBeCloseTo(0);
  const side = new THREE.Vector3(1, 0, 0).applyMatrix4(m).sub(new THREE.Vector3(0, 8, 0));
  expect(side.length()).toBeCloseTo(1); // width and sag are not scaled
});

it('uniform scale for everything else', () => {
  const m = placeMatrix(prop({ type: 'tree', scale: 1.5 }), { x: 0, z: 0 }, new THREE.Matrix4());
  expect(new THREE.Vector3(0, 2, 0).applyMatrix4(m).y).toBeCloseTo(3);
});

it('picks a stable tree variant from the position and mixes all three', () => {
  expect(variantOf('streetlight', 1, 2)).toBe(0);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) seen.add(variantOf('tree', i * 13.7, i * 5.1));
  expect([...seen].sort()).toEqual([0, 1, 2]);
  expect(variantOf('tree', 12.5, -4)).toBe(variantOf('tree', 12.5, -4));
  expect(TREE_VARIANTS).toHaveLength(3);
});

it('maps type and variant to a model file', () => {
  expect(modelFile('streetlight', 0)).toBe('streetlight');
  expect(modelFile('wires', 0)).toBe('wires');
  expect(modelFile('tree', 1)).toBe('tree_bottlebrush');
});

it('tints only types whose model is a plain base colour, with colours from the palette', () => {
  expect(tintHex('streetlight', 1, 2)).toBeUndefined();
  expect(tintHex('powerpole', 1, 2)).toBeUndefined();
  const signs = new Set<number>();
  for (let i = 0; i < 100; i++) { const c = tintHex('sign', i * 3.3, i * 1.7)!; expect(c).toBeTypeOf('number'); signs.add(c); }
  expect(signs.size).toBeGreaterThan(3);
});
