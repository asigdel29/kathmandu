import { describe, expect, it } from 'vitest';
import {
  circleOfConfusionMm, dofAmount, FrameProbe, IdleTracker, LOW_ABOVE_MS, MED_ABOVE_MS, motionBlurAmount, parseQuality, pickQuality, wetness,
} from './quality.ts';

describe('quality tiers', () => {
  it('parses only the three tier names', () => {
    expect(parseQuality('low')).toBe('low');
    expect(parseQuality('med')).toBe('med');
    expect(parseQuality('high')).toBe('high');
    expect(parseQuality('ultra')).toBeUndefined();
    expect(parseQuality(null)).toBeUndefined();
  });

  it('steps down as the probed frame time grows', () => {
    expect(pickQuality(8)).toBe('high');
    expect(pickQuality(MED_ABOVE_MS)).toBe('high');
    expect(pickQuality(MED_ABOVE_MS + 0.1)).toBe('med');
    expect(pickQuality(LOW_ABOVE_MS + 0.1)).toBe('low');
  });

  it('the probe reports the median once, after two seconds of frames', () => {
    const p = new FrameProbe();
    let result: number | undefined;
    let calls = 0;
    p.add(300); // a stall at the start does not move the median
    for (let i = 0; i < 400 && result === undefined; i++) { result = p.add(10); calls++; }
    expect(result).toBe(10);
    expect(calls).toBe(170); // 0.3 s stall + 1.7 s of 10 ms frames
    expect(p.add(10)).toBeUndefined();
  });

  it('a machine where every frame is slow still completes the probe', () => {
    const p = new FrameProbe();
    const results = [p.add(700), p.add(700), p.add(700)];
    expect(results).toEqual([undefined, undefined, 700]);
    expect(pickQuality(700)).toBe('low');
  });
});

describe('depth of field timing', () => {
  it('is off while moving and below 3 s idle, fades in over 1 s after', () => {
    expect(dofAmount(0, false)).toBe(0);
    expect(dofAmount(3, false)).toBe(0);
    expect(dofAmount(3.5, false)).toBeGreaterThan(0);
    expect(dofAmount(3.5, false)).toBeLessThan(1);
    expect(dofAmount(4, false)).toBe(1);
    expect(dofAmount(60, false)).toBe(1);
  });
  it('is always off while driving or when the camera is not the follow camera', () => {
    expect(dofAmount(60, true)).toBe(0);
    expect(dofAmount(60, false, false)).toBe(0);
  });
  it('idle tracker resets on movement', () => {
    const t = new IdleTracker();
    t.update(1, false); t.update(1.5, false);
    expect(t.seconds).toBe(2.5);
    t.update(0.016, true);
    expect(t.seconds).toBe(0);
  });
  it('50 mm f/2.8 focused at 3.5 m: blur at infinity is a fraction of a millimetre, none at the focus plane', () => {
    expect(circleOfConfusionMm(3.5, 3.5)).toBe(0);
    const far = circleOfConfusionMm(3.5, 1e4);
    expect(far).toBeGreaterThan(0.2);
    expect(far).toBeLessThan(0.35);
    expect(circleOfConfusionMm(3.5, 10)).toBeLessThan(far);
  });
});

describe('driving blur and wetness', () => {
  it('blur starts above 40 km/h and only while driving', () => {
    expect(motionBlurAmount(40, true)).toBe(0);
    expect(motionBlurAmount(41, true)).toBeGreaterThan(0);
    expect(motionBlurAmount(120, true)).toBe(1);
    expect(motionBlurAmount(120, false)).toBe(0);
  });
  it('roads are wet when forced or at night', () => {
    expect(wetness(false, 0)).toBe(0);
    expect(wetness(true, 0)).toBe(1);
    expect(wetness(false, 0.4)).toBe(0.4);
    expect(wetness(false, 1)).toBe(1);
  });
});
