import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NavGraph } from '../traffic/NavGraph.ts';
import { Pedestrians } from './Pedestrians.ts';

function capsules(scene: THREE.Scene): THREE.InstancedMesh {
  const mesh = scene.children.find((c): c is THREE.InstancedMesh => c.name === 'pedestrians');
  if (!mesh) throw new Error('no pedestrians mesh');
  return mesh;
}

describe('Pedestrians rendering', () => {
  it('draws every person as a capsule while no character model has loaded', () => {
    const scene = new THREE.Scene();
    const peds = new Pedestrians(scene, new NavGraph(), { max: 5, figures: 3 });
    peds.sim.addPed([{ x: 0, z: 0 }, { x: 40, z: 0 }], 1.4);
    peds.sim.addPed([{ x: 0, z: 5 }, { x: 40, z: 5 }], 1.2);
    peds.update(1 / 30, { x: 0, z: 100 });
    expect(peds.count).toBe(2);
    expect(capsules(scene).count).toBe(2);
    peds.dispose();
  });

  it('removes its mesh from the scene on dispose', () => {
    const scene = new THREE.Scene();
    const peds = new Pedestrians(scene, new NavGraph(), { max: 5, figures: 0 });
    expect(scene.children.some((c) => c.name === 'pedestrians')).toBe(true);
    peds.dispose();
    expect(scene.children.some((c) => c.name === 'pedestrians')).toBe(false);
  });
});
