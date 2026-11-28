import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { locomotionBlend, pedWalkScale, RUN_CLIP, STAND_SPEED, WALK_CLIP, WALK_CLIP_FEMALE } from './locomotion.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/models/characters/characters.json', import.meta.url), 'utf8')) as {
  models: Record<string, { clips: Record<string, { speed: number; duration: number }> }>;
};

describe('clip constants', () => {
  it('match the measurements recorded by the build', () => {
    const near = (a: number, b: number) => Math.abs(a - b) / b < 0.01;
    expect(near(WALK_CLIP.speed, manifest.models.player!.clips.walk!.speed)).toBe(true);
    expect(near(WALK_CLIP.duration, manifest.models.player!.clips.walk!.duration)).toBe(true);
    expect(near(RUN_CLIP.speed, manifest.models.player!.clips.run!.speed)).toBe(true);
    expect(near(RUN_CLIP.duration, manifest.models.player!.clips.run!.duration)).toBe(true);
    expect(near(WALK_CLIP_FEMALE.speed, manifest.models.ped_1!.clips.walk!.speed)).toBe(true);
  });
});

describe('locomotionBlend', () => {
  it('stands still below the stand threshold', () => {
    expect(locomotionBlend(0)).toEqual({ idle: 1, walk: 0, run: 0, rate: 0, walkScale: 0 });
    expect(locomotionBlend(STAND_SPEED / 2).idle).toBe(1);
  });

  it('weights always sum to 1', () => {
    for (let v = 0; v <= 9; v += 0.1) {
      const b = locomotionBlend(v);
      expect(b.idle + b.walk + b.run).toBeCloseTo(1, 9);
      expect(b.idle).toBeGreaterThanOrEqual(0); expect(b.walk).toBeGreaterThanOrEqual(0); expect(b.run).toBeGreaterThanOrEqual(0);
    }
  });

  it('plays the walk clip as authored at its own speed', () => {
    const b = locomotionBlend(WALK_CLIP.speed);
    expect(b.walk).toBeCloseTo(1, 9);
    expect(b.walkScale).toBeCloseTo(1, 6);
  });

  it('plays the jog clip as authored at its own speed', () => {
    const b = locomotionBlend(RUN_CLIP.speed);
    expect(b.run).toBe(1);
    expect(b.rate * RUN_CLIP.duration).toBeCloseTo(1, 6);
  });

  it('keeps the blended stride times the rate equal to the ground speed (no foot sliding) between walk and jog', () => {
    const strideWalk = WALK_CLIP.speed * WALK_CLIP.duration; const strideRun = RUN_CLIP.speed * RUN_CLIP.duration;
    for (const v of [1.0, 1.5, 2.2, 3, 4.5, 5.5]) {
      const b = locomotionBlend(v);
      expect(b.rate * (b.walk * strideWalk + b.run * strideRun)).toBeCloseTo(v, 6);
    }
  });

  it('walking speed 2.2 m/s blends mostly walk with some jog at a plausible cadence', () => {
    const b = locomotionBlend(2.2);
    expect(b.run).toBeGreaterThan(0.15); expect(b.run).toBeLessThan(0.4);
    expect(b.rate).toBeGreaterThan(0.8); expect(b.rate).toBeLessThan(1.2);
  });

  it('caps the jog playback scale above the jog speed', () => {
    expect(locomotionBlend(20).rate * RUN_CLIP.duration).toBeLessThanOrEqual(1.5 + 1e-9);
  });
});

describe('pedWalkScale', () => {
  it('is the ratio of the real speed to the clip root speed', () => {
    expect(pedWalkScale(WALK_CLIP.speed)).toBeCloseTo(1, 9);
    expect(pedWalkScale(1.36)).toBeCloseTo(1.36 / WALK_CLIP.speed, 9);
  });
});
