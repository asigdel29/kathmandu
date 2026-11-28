import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { WALK_CLIP, WALK_CLIP_FEMALE } from '../player/locomotion.ts';
import {
  FIGURE_HYSTERESIS_M, PedFigure, phaseOf, pickFigures, variantOf, walkScale, type GltfLike,
} from './PedFigures.ts';

const ground = (id: number, x: number, z: number) => ({ id, x, z });

/** A two-bone-free skinned body: one bone 'Hips', one skinned mesh, and idle/walk clips that rock the hips. */
function fixture(): GltfLike & { idle: THREE.AnimationClip; walk: THREE.AnimationClip } {
  const root = new THREE.Object3D();
  root.name = 'Character';
  const hips = new THREE.Bone();
  hips.name = 'Hips';
  root.add(hips);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = 'Body';
  mesh.add(hips.clone());
  root.add(mesh);
  mesh.bind(new THREE.Skeleton([hips]));
  const clip = (name: string, duration: number) => new THREE.AnimationClip(name, duration, [
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, duration / 2, duration],
      [0, 0, 0, 1, 0, 0.19899, 0, 0.98, 0, 0, 0, 1]),
  ]);
  const idle = clip('idle', 2.5);
  const walk = clip('walk', 1.3333);
  return { scene: root, animations: [idle, walk], idle, walk };
}

const moving = { x: 1, y: 0, z: 2, yaw: 0.5, vx: 1.2, vz: 0, speed: 1.2, stopped: false };
const still = { ...moving, vx: 0, speed: 0 };

describe('variantOf', () => {
  it('maps ids to the four character models, stably', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(variantOf)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(variantOf(1234)).toBe(variantOf(1234));
    for (let id = 1; id < 200; id++) expect(variantOf(id)).toBeGreaterThanOrEqual(0);
  });
});

describe('phaseOf', () => {
  it('is deterministic and within [0, 1)', () => {
    for (let id = 0; id < 500; id++) {
      const p = phaseOf(id);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      expect(phaseOf(id)).toBe(p);
    }
  });

  it('spreads 0..119 roughly uniformly over the four quarters', () => {
    const quarters = [0, 0, 0, 0];
    for (let id = 0; id < 120; id++) quarters[Math.floor(phaseOf(id) * 4)]!++;
    for (const q of quarters) {
      expect(q).toBeGreaterThanOrEqual(20);
      expect(q).toBeLessThanOrEqual(40);
    }
  });

  it('gives idle a different offset from walk for the same id', () => {
    let differ = 0;
    for (let id = 0; id < 50; id++) if (phaseOf(id, 1) !== phaseOf(id, 0)) differ++;
    expect(differ).toBe(50);
  });
});

describe('walkScale', () => {
  it('uses the male walk clip for even variants and the female clip for odd ones', () => {
    expect(walkScale(1.2, 0)).toBeCloseTo(1.2 / WALK_CLIP.speed, 12);
    expect(walkScale(1.2, 2)).toBeCloseTo(1.2 / WALK_CLIP.speed, 12);
    expect(walkScale(1.2, 1)).toBeCloseTo(1.2 / WALK_CLIP_FEMALE.speed, 12);
    expect(walkScale(1.2, 3)).toBeCloseTo(1.2 / WALK_CLIP_FEMALE.speed, 12);
  });

  it('is 1.2 to 1.8 for PedSim walking speeds', () => {
    expect(walkScale(1.1, 0)).toBeGreaterThan(1.2);
    expect(walkScale(1.6, 0)).toBeLessThan(1.8);
  });
});

describe('pickFigures', () => {
  // Ids 1..10 stand at x = id, so the nearest three are 1, 2, 3 (distances from the player at the origin).
  const people = Array.from({ length: 10 }, (_, i) => ground(i + 1, i + 1, 0));
  const player = { x: 0, z: 0 };

  it('picks the nearest n when nobody has a figure yet', () => {
    expect([...pickFigures(people, player, 3, new Set())].sort()).toEqual([1, 2, 3]);
  });

  it('returns every person when there are fewer than n', () => {
    expect([...pickFigures(people.slice(0, 2), player, 5, new Set())].sort()).toEqual([1, 2]);
  });

  it('returns nobody for n = 0', () => {
    expect(pickFigures(people, player, 0, new Set([1])).size).toBe(0);
  });

  it('keeps a current figure holder within the hysteresis band', () => {
    // Id 7 is 7 m away, the 3rd nearest is 3 m away: 4 m beyond it, within the 5 m band.
    expect(7 - 3).toBeLessThan(FIGURE_HYSTERESIS_M);
    const kept = pickFigures(people, player, 3, new Set([7]));
    expect(kept.has(7)).toBe(true);
    expect(kept.size).toBe(3);
  });

  it('drops a current figure holder once farther than the band', () => {
    // Id 9 is 6 m beyond the 3rd nearest: released.
    const kept = pickFigures(people, player, 3, new Set([9]));
    expect([...kept].sort()).toEqual([1, 2, 3]);
  });

  it('forgets people who have despawned', () => {
    const kept = pickFigures(people.filter((p) => p.id !== 2), player, 3, new Set([2]));
    expect(kept.has(2)).toBe(false);
    expect(kept.size).toBe(3);
  });
});

describe('PedFigure', () => {
  it('keeps the mixer and every bone finite over steps of 0.25 s', () => {
    const fx = fixture();
    const fig = new PedFigure(fx, 0);
    fig.assign(7, moving);
    for (let i = 0; i < 200; i++) {
      fig.update(0.25, i % 40 < 20 ? moving : still);
      expect(Number.isFinite(fig.mixer.time)).toBe(true);
    }
    const bones: THREE.Bone[] = [];
    fig.root.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Bone) bones.push(o); });
    expect(bones.length).toBeGreaterThan(0);
    for (const b of bones) for (const v of b.quaternion.toArray()) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isFinite(fig.root.position.x)).toBe(true);
  });

  it('places the figure at the person position and turns it to the person yaw', () => {
    const fig = new PedFigure(fixture(), 2);
    fig.assign(2, moving);
    fig.update(0.1, moving);
    expect(fig.root.position.toArray()).toEqual([1, 0, 2]);
    expect(fig.root.rotation.y).toBeCloseTo(0.5, 12);
  });

  it('plays the walk clip at speed / clip speed and fades to idle over 0.2 s', () => {
    const fx = fixture();
    const fig = new PedFigure(fx, 0);
    fig.assign(4, moving);
    fig.update(0.001, moving);
    const walk = fig.mixer.existingAction(fx.walk, fig.root)!;
    const idle = fig.mixer.existingAction(fx.idle, fig.root)!;
    expect(walk.timeScale).toBeCloseTo(1.2 / WALK_CLIP.speed, 12);
    expect(idle.timeScale).toBe(1);

    fig.update(0.1, still);
    expect(fig.walkWeight).toBeCloseTo(0.5, 6);
    fig.update(0.1, still);
    expect(fig.walkWeight).toBeCloseTo(0, 6);
    expect(walk.getEffectiveWeight()).toBeCloseTo(0, 6);
    expect(idle.getEffectiveWeight()).toBeCloseTo(1, 6);

    fig.update(0.2, { ...moving, stopped: true });
    expect(fig.walkWeight).toBeCloseTo(0, 6);
    fig.update(0.2, moving);
    expect(fig.walkWeight).toBeCloseTo(1, 6);
  });

  it('starts each assignment at a phase offset from its id', () => {
    const fx = fixture();
    const fig = new PedFigure(fx, 0);
    fig.assign(33, moving);
    const walk = fig.mixer.existingAction(fx.walk, fig.root)!;
    expect(walk.time).toBeCloseTo(phaseOf(33) * fx.walk.duration, 9);
  });

  it('removes its root and mixer on dispose', () => {
    const fig = new PedFigure(fixture(), 0);
    const scene = new THREE.Object3D();
    scene.add(fig.root);
    fig.dispose();
    expect(fig.root.parent).toBeNull();
  });
});
