import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CharacterAnimator, type AnimInput } from './CharacterAnimator.ts';
import { locomotionBlend, RUN_CLIP, WALK_CLIP } from './locomotion.ts';

const DURATIONS: Record<string, number> = {
  idle: 2.5,
  walk: WALK_CLIP.duration,
  run: RUN_CLIP.duration,
  jump_start: 1.3,
  jump_loop: 2.5,
  jump_land: 1.3,
  drive: 1.7,
};

function makeClips(): Record<string, THREE.AnimationClip> {
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const [name, duration] of Object.entries(DURATIONS)) {
    const track = new THREE.NumberKeyframeTrack('root.position[x]', [0, duration], [0, 1]);
    clips[name] = new THREE.AnimationClip(name, duration, [track]);
  }
  return clips;
}

function makeAnimator(): CharacterAnimator {
  const root = new THREE.Object3D();
  root.name = 'root';
  return new CharacterAnimator(root, makeClips());
}

const input = (over: Partial<AnimInput> = {}): AnimInput => ({ speed: 0, grounded: true, jumpPressed: false, driving: false, ...over });

function sum(w: Readonly<Record<string, number>>): number {
  return Object.values(w).reduce((a, b) => a + b, 0);
}

function expectSane(a: CharacterAnimator): void {
  for (const v of Object.values(a.weights)) {
    expect(Number.isNaN(v)).toBe(false);
    expect(v).toBeGreaterThanOrEqual(-1e-9);
    expect(v).toBeLessThanOrEqual(1 + 1e-6);
  }
  expect(sum(a.weights)).toBeLessThanOrEqual(1 + 1e-6);
}

describe('CharacterAnimator locomotion', () => {
  it('standing plays idle at full weight', () => {
    const a = makeAnimator();
    a.update(1 / 60, input());
    expect(a.state).toBe('ground');
    expect(a.weights.idle).toBeCloseTo(1, 6);
    expect(a.weights.walk).toBeCloseTo(0, 6);
    expect(a.weights.run).toBeCloseTo(0, 6);
  });

  it('at the walk clip speed the walk clip carries the weight', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ speed: WALK_CLIP.speed }));
    expect(a.weights.walk).toBeCloseTo(1, 6);
  });

  it('at 2.2 m/s the weights match locomotionBlend', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ speed: 2.2 }));
    const b = locomotionBlend(2.2);
    expect(a.weights.idle).toBeCloseTo(b.idle, 6);
    expect(a.weights.walk).toBeCloseTo(b.walk, 6);
    expect(a.weights.run).toBeCloseTo(b.run, 6);
  });

  it('at 5.5 m/s the run clip dominates', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ speed: 5.5 }));
    expect(a.weights.run).toBeGreaterThan(0.95);
  });

  it('walk and run share one phase, wrapped to [0, 1) even after a long frame', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ speed: 2.2 }));
    const p0 = a.phase;
    a.update(0.25, input({ speed: 5.5 }));
    expect(a.phase).toBeGreaterThanOrEqual(0);
    expect(a.phase).toBeLessThan(1);
    expect(a.phase).not.toBe(p0);
  });

  it('keeps weights summing to at most 1 and never NaN over a varied sequence', () => {
    const a = makeAnimator();
    const speeds = [0, 0.5, 2.2, 5.5, 1.0, 0, 3.3];
    for (let i = 0; i < 600; i++) {
      const speed = speeds[i % speeds.length]!;
      a.update(i % 97 === 0 ? 0.25 : 1 / 60, input({ speed, grounded: i % 53 < 40, jumpPressed: i % 61 === 0 }));
      expectSane(a);
    }
  });
});

describe('CharacterAnimator jump', () => {
  it('a jump press while grounded goes takeoff, then air once the take-off clip has played', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ speed: 2.2 }));
    a.update(1 / 60, input({ speed: 2.2, jumpPressed: true }));
    expect(a.state).toBe('takeoff');
    expect(a.weights.jump_start).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) a.update(0.5, input({ speed: 2.2, grounded: false }));
    expect(a.state).toBe('air');
    expect(a.weights.jump_loop).toBeCloseTo(1, 6);
    expectSane(a);
  });

  it('a jump press while airborne is ignored', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ grounded: false }));
    expect(a.state).toBe('air');
    a.update(1 / 60, input({ grounded: false, jumpPressed: true }));
    expect(a.state).toBe('air');
  });

  it('landing plays jump_land, then returns to locomotion', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ grounded: false }));
    a.update(1 / 60, input({ grounded: true }));
    expect(a.state).toBe('landing');
    expect(a.weights.jump_land).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) a.update(0.1, input());
    expect(a.state).toBe('ground');
    expect(a.weights.idle).toBeCloseTo(1, 6);
    expect(a.weights.jump_land).toBeCloseTo(0, 6);
    expectSane(a);
  });

  it('a standing jump from the ground takes off and lands cleanly through the whole cycle', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ jumpPressed: true }));
    expect(a.state).toBe('takeoff');
    for (let i = 0; i < 20; i++) { a.update(0.1, input({ grounded: false })); expectSane(a); }
    expect(a.state).toBe('air');
    a.update(1 / 60, input({ grounded: true }));
    expect(a.state).toBe('landing');
  });
});

describe('CharacterAnimator driving', () => {
  it('driving plays drive at full weight after the crossfade and silences the rest', () => {
    const a = makeAnimator();
    a.update(1 / 60, input({ speed: 2.2 }));
    a.update(0.1, input({ driving: true }));
    expect(a.state).toBe('driving');
    a.update(0.3, input({ driving: true }));
    expect(a.weights.drive).toBeCloseTo(1, 6);
    for (const name of ['idle', 'walk', 'run', 'jump_start', 'jump_loop', 'jump_land'] as const) expect(a.weights[name]).toBeCloseTo(0, 6);
    expectSane(a);
  });

  it('leaving the vehicle crossfades back to locomotion', () => {
    const a = makeAnimator();
    a.update(0.3, input({ driving: true }));
    a.update(0.3, input({ driving: false }));
    expect(a.state).toBe('ground');
    a.update(0.3, input({ driving: false }));
    expect(a.weights.idle).toBeCloseTo(1, 6);
    expect(a.weights.drive).toBeCloseTo(0, 6);
  });

  it('applies the drive clip to the rig at its current time', () => {
    const root = new THREE.Object3D();
    root.name = 'root';
    const clips = makeClips();
    // Replace the drive clip with a ramp from 0 to 1 over its loop, so the rig's x shows the clip time.
    clips.drive = new THREE.AnimationClip('drive', DURATIONS.drive!, [
      new THREE.NumberKeyframeTrack('root.position[x]', [0, DURATIONS.drive!], [0, 1]),
    ]);
    const a = new CharacterAnimator(root, clips);
    a.update(0.85, input({ driving: true }));
    expect(root.position.x).toBeCloseTo(0.85 / DURATIONS.drive!, 3);
  });

  it('does not produce NaN when given a zero or non-finite step', () => {
    const a = makeAnimator();
    a.update(0, input({ speed: 2.2 }));
    a.update(Number.NaN, input({ speed: 2.2 }));
    expectSane(a);
  });
});
