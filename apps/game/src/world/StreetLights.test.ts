import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { assignSlots, selectLamps, StreetLights, type Lamp } from './StreetLights.ts';
import { LAMP_MAX_LIGHTS } from './lighting.ts';

const lamp = (i: number, x: number, z: number): Lamp => ({ key: `l${i}`, x, y: 7, z });

describe('selectLamps', () => {
  it('keeps lamps within the radius, nearest first, capped', () => {
    const lamps = [lamp(0, 10, 0), lamp(1, 100, 0), lamp(2, 5, 0), lamp(3, 0, 59), lamp(4, 0, 61)];
    expect(selectLamps(lamps, 0, 0, 60, 24).map((l) => l.key)).toEqual(['l2', 'l0', 'l3']);
    expect(selectLamps(lamps, 0, 0, 60, 2).map((l) => l.key)).toEqual(['l2', 'l0']);
  });
  it('never returns more than the light cap', () => {
    const lamps = Array.from({ length: 100 }, (_, i) => lamp(i, i % 10, Math.floor(i / 10)));
    expect(selectLamps(lamps, 0, 0)).toHaveLength(LAMP_MAX_LIGHTS);
  });
});

describe('assignSlots', () => {
  it('keeps a lamp in its slot when the selection changes', () => {
    const first = assignSlots([undefined, undefined, undefined], [lamp(0, 0, 0), lamp(1, 1, 0)]);
    expect(first).toEqual(['l0', 'l1', undefined]);
    const second = assignSlots(first, [lamp(2, 0, 0), lamp(1, 1, 0)]);
    expect(second).toEqual(['l2', 'l1', undefined]);
  });
  it('drops lamps that fall out of range and ignores overflow', () => {
    expect(assignSlots(['a', 'b'], [lamp(0, 0, 0), lamp(1, 0, 0), lamp(2, 0, 0)])).toEqual(['l0', 'l1']);
  });
});

describe('StreetLights', () => {
  const lamps = Array.from({ length: 40 }, (_, i) => lamp(i, i * 3, 0));
  it('is off by day and lights at most 24 lamps at night, each within 18 m reach', () => {
    const scene = new THREE.Scene();
    const sl = new StreetLights(scene, () => lamps);
    const at = new THREE.Vector3(0, 0, 0);
    sl.update(1, at, 0);
    expect(sl.active).toBe(0);
    expect(scene.children.every((c) => !c.visible)).toBe(true);
    sl.update(1, at, 1);
    expect(sl.active).toBe(21); // lamps at x = 0, 3 .. 60 are within 60 m
    const lights = scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);
    expect(lights).toHaveLength(24);
    expect(lights.every((l) => l.distance === 18 && l.decay === 2 && !l.castShadow)).toBe(true);
  });
  it('is capped at 24 when more lamps are in range', () => {
    const scene = new THREE.Scene();
    const dense = Array.from({ length: 60 }, (_, i) => lamp(i, i, 0));
    const sl = new StreetLights(scene, () => dense);
    sl.update(1, new THREE.Vector3(30, 0, 0), 1);
    expect(sl.active).toBe(24);
  });
});
