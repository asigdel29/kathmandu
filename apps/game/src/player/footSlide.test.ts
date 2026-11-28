import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { CharacterAnimator } from './CharacterAnimator.ts';
import { clipsOf, loadCharacter } from './glb.testutil.ts';
import { RUN_CLIP, WALK_CLIP, WALK_CLIP_FEMALE } from './locomotion.ts';
import { variantOf, walkScale } from '../people/PedFigures.ts';

/**
 * Ground speed of the planted foot of a model that is not translated: while a foot is on the ground it slides back
 * along the facing axis (+Z) at the speed the character appears to travel at. Measured as the least-squares slope of the
 * ball-of-foot position over each contact run (ball within 2 cm of its lowest point), averaged over both feet.
 */
function plantedFootSpeed(samples: { t: number; z: number; y: number }[][]): number {
  const slopes: { v: number; n: number }[] = [];
  for (const feet of samples) {
    const low = Math.min(...feet.map((s) => s.y));
    let run: typeof feet = [];
    const flush = () => {
      if (run.length >= 3) {
        const n = run.length; const mt = run.reduce((a, r) => a + r.t, 0) / n; const mz = run.reduce((a, r) => a + r.z, 0) / n;
        const den = run.reduce((a, r) => a + (r.t - mt) ** 2, 0);
        if (den > 0) slopes.push({ v: Math.abs(run.reduce((a, r) => a + (r.t - mt) * (r.z - mz), 0) / den), n });
      }
      run = [];
    };
    for (const s of feet) { if (s.y < low + 0.02) run.push(s); else flush(); }
    flush();
  }
  const total = slopes.reduce((a, s) => a + s.n, 0);
  return slopes.reduce((a, s) => a + s.v * s.n, 0) / total;
}

describe('foot sliding in the loaded rig', () => {
  it('player: the planted foot moves at the ground speed across walk, blend and run speeds', async () => {
    const gltf = await loadCharacter('player.glb');
    const anim = new CharacterAnimator(gltf.scene, clipsOf(gltf));
    gltf.scene.updateMatrixWorld(true);
    const ballL = gltf.scene.getObjectByName('ball_l')!; const ballR = gltf.scene.getObjectByName('ball_r')!;
    const p = new THREE.Vector3();
    const dt = 1 / 60;
    const report: Record<string, number> = {};
    for (const v of [WALK_CLIP.speed, 1.4, 2.2, 3.5, 5.5]) {
      // settle the blend and phase for one second, then record three seconds
      for (let i = 0; i < 60; i++) anim.update(dt, { speed: v, grounded: true, jumpPressed: false, driving: false });
      const feet: { t: number; z: number; y: number }[][] = [[], []];
      for (let i = 0; i < 180; i++) {
        anim.update(dt, { speed: v, grounded: true, jumpPressed: false, driving: false });
        gltf.scene.updateMatrixWorld(true);
        [ballL, ballR].forEach((b, k) => { b.getWorldPosition(p); feet[k]!.push({ t: i * dt, z: p.z, y: p.y }); });
      }
      report[v.toFixed(2)] = plantedFootSpeed(feet) / v;
    }
    console.log('player planted foot speed / ground speed', JSON.stringify(report));
    // At the authored speeds the feet stay planted to within 6 %; between clips the blend is within 25 %.
    expect(Math.abs(report[WALK_CLIP.speed.toFixed(2)]! - 1)).toBeLessThan(0.06);
    expect(Math.abs(report['5.50']! - 1)).toBeLessThan(0.1);
    for (const r of Object.values(report)) expect(Math.abs(r - 1)).toBeLessThan(0.25);
  });

  it.each([['ped_0.glb', WALK_CLIP], ['ped_1.glb', WALK_CLIP_FEMALE]])('%s: the walk clip at speed / clip root speed keeps the feet planted', async (file, clip) => {
    const gltf = await loadCharacter(file);
    const walk = clipsOf(gltf).walk!;
    const root = gltf.scene;
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(walk, root); action.play();
    const ballL = root.getObjectByName('ball_l')!; const ballR = root.getObjectByName('ball_r')!;
    const p = new THREE.Vector3(); const dt = 1 / 60;
    const variant = variantOf(file === 'ped_0.glb' ? 0 : 1);
    for (const speed of [1.1, 1.36, 1.6]) {
      action.timeScale = walkScale(speed, variant);
      mixer.update(0.5);
      const feet: { t: number; z: number; y: number }[][] = [[], []];
      for (let i = 0; i < 180; i++) {
        mixer.update(dt); root.updateMatrixWorld(true);
        [ballL, ballR].forEach((b, k) => { b.getWorldPosition(p); feet[k]!.push({ t: i * dt, z: p.z, y: p.y }); });
      }
      expect(Math.abs(plantedFootSpeed(feet) / speed - 1)).toBeLessThan(0.08);
    }
    expect(clip.speed).toBeGreaterThan(0);
  });

  it('the jog clip at its authored scale carries the run speed', () => {
    expect(RUN_CLIP.speed).toBeGreaterThan(5);
  });
});
