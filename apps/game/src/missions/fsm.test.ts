import { describe, expect, it } from 'vitest';
import { Mission } from '@ktm/schema';
import { MissionFsm, STOP_SPEED_MS, distanceXZ, inWindow, type MissionEvent, type MissionTick } from './fsm.ts';

const tick = (x: number, z: number, o: Partial<MissionTick> = {}): MissionTick => ({ dt: 0.1, x, z, speed: 0, photo: false, timeOfDay: 12, ...o });

/** Ticks through a scripted position feed, returning the events emitted at each tick. */
function feed(fsm: MissionFsm, points: Array<[number, number, Partial<MissionTick>?]>): MissionEvent[][] {
  return points.map(([x, z, o]) => fsm.tick(tick(x, z, o)));
}

const route = Mission.parse({
  id: 'route', title: 'Route', type: 'taxi', start: { x: 0, z: 0 }, rewardText: 'Fare paid',
  steps: [
    { kind: 'goto', x: 100, z: 0, radius: 10, text: 'Go' },
    { kind: 'pickup', x: 100, z: 100, radius: 10, text: 'Pick up' },
    { kind: 'dropoff', x: 0, z: 100, text: 'Drop off' },
  ],
});

describe('inWindow / distanceXZ', () => {
  it('treats a missing window as always open', () => { expect(inWindow(3, undefined)).toBe(true); });
  it('is inclusive at the start and exclusive at the end', () => {
    const w = { fromH: 17, toH: 19 };
    expect(inWindow(16.99, w)).toBe(false);
    expect(inWindow(17, w)).toBe(true);
    expect(inWindow(18.5, w)).toBe(true);
    expect(inWindow(19, w)).toBe(false);
  });
  it('wraps past midnight', () => {
    const w = { fromH: 22, toH: 2 };
    expect(inWindow(23, w)).toBe(true);
    expect(inWindow(1, w)).toBe(true);
    expect(inWindow(12, w)).toBe(false);
  });
  it('measures on the XZ plane', () => { expect(distanceXZ(0, 0, 3, 4)).toBe(5); });
});

describe('MissionFsm', () => {
  it('a scripted position feed drives idle -> active(0..2) -> done', () => {
    const fsm = new MissionFsm(route);
    expect(fsm.status).toBe('idle');
    expect(fsm.stepIndex).toBe(-1);
    expect(fsm.step).toBeUndefined();
    expect(fsm.distanceTo(0, 0)).toBeUndefined();
    expect(fsm.tick(tick(100, 0))).toEqual([]); // idle ignores positions

    expect(fsm.accept()).toEqual([{ kind: 'accepted' }, { kind: 'step', index: 0 }]);
    expect(fsm.status).toBe('active');
    expect(fsm.stepIndex).toBe(0);
    expect(fsm.distanceTo(0, 0)).toBe(100);
    expect(fsm.accept()).toEqual([]);

    const events = feed(fsm, [[20, 0], [60, 0], [95, 0]]);
    expect(events).toEqual([[], [], [{ kind: 'step', index: 1 }]]);
    expect(fsm.stepIndex).toBe(1);
    expect(fsm.step?.text).toBe('Pick up');

    expect(feed(fsm, [[100, 50], [100, 95]])).toEqual([[], [{ kind: 'step', index: 2 }]]);
    expect(fsm.stepIndex).toBe(2);

    const last = feed(fsm, [[50, 100], [10, 100], [3, 100]]);
    expect(last.slice(0, 2)).toEqual([[], []]);
    expect(last[2]).toEqual([{ kind: 'done', elapsedS: expect.closeTo(0.8, 6) as number }]);
    expect(fsm.status).toBe('done');
    expect(fsm.stepIndex).toBe(3);
    expect(fsm.step).toBeUndefined();
    expect(fsm.tick(tick(3, 100))).toEqual([]);
  });

  it('completes at most one step per tick', () => {
    const stacked = Mission.parse({ ...route, steps: [route.steps[0], { ...route.steps[0], text: 'Again' }] });
    const fsm = new MissionFsm(stacked);
    fsm.accept();
    expect(fsm.tick(tick(100, 0))).toEqual([{ kind: 'step', index: 1 }]);
    expect(fsm.tick(tick(100, 0))).toEqual([{ kind: 'done', elapsedS: expect.closeTo(0.2, 6) as number }]);
  });

  it('pickup waits until the vehicle stops inside the radius', () => {
    const fsm = new MissionFsm(route);
    fsm.accept();
    fsm.tick(tick(100, 0));
    expect(fsm.tick(tick(100, 100, { speed: 12 }))).toEqual([]);
    expect(fsm.tick(tick(100, 100, { speed: STOP_SPEED_MS + 0.1 }))).toEqual([]);
    expect(fsm.stepIndex).toBe(1);
    expect(fsm.tick(tick(100, 100, { speed: STOP_SPEED_MS }))).toEqual([{ kind: 'step', index: 2 }]);
  });

  it('fails with timeout once the time limit passes', () => {
    const fsm = new MissionFsm(Mission.parse({ ...route, timeLimitS: 1 }));
    fsm.accept();
    expect(fsm.remainingS).toBe(1);
    const events = feed(fsm, Array.from({ length: 10 }, () => [0, 0] as [number, number]));
    expect(events.flat()).toEqual([]);
    expect(fsm.remainingS).toBeCloseTo(0, 6);
    // Standing on the target in the expiring tick still fails: the limit is checked first.
    expect(fsm.tick(tick(100, 0))).toEqual([{ kind: 'failed', reason: 'timeout', elapsedS: expect.closeTo(1.1, 6) as number }]);
    expect(fsm.status).toBe('failed');
    expect(fsm.failReason).toBe('timeout');
    expect(fsm.remainingS).toBeUndefined();
    expect(fsm.tick(tick(100, 0))).toEqual([]);
  });

  it('a photo step needs F pressed inside the radius, within the clock window', () => {
    const photo = Mission.parse({
      id: 'p', title: 'P', type: 'photo', start: { x: 0, z: 0 }, rewardText: 'Photo saved',
      steps: [{ kind: 'photo', x: 0, z: 0, radius: 40, window: { fromH: 17, toH: 19 }, text: 'Photograph' }],
    });
    const fsm = new MissionFsm(photo);
    fsm.accept();
    expect(fsm.tick(tick(60, 0, { photo: true, timeOfDay: 17.5 }))).toEqual([]); // outside the radius
    expect(fsm.tick(tick(10, 0, { photo: false, timeOfDay: 17.5 }))).toEqual([]); // inside, no key
    expect(fsm.tick(tick(10, 0, { photo: true, timeOfDay: 16.5 }))).toEqual([]); // before the window
    expect(fsm.status).toBe('active');
    expect(fsm.tick(tick(10, 0, { photo: true, timeOfDay: 17.5 }))).toEqual([{ kind: 'done', elapsedS: expect.closeTo(0.4, 6) as number }]);
  });

  it('a wait step resets when the player leaves the radius', () => {
    const wait = Mission.parse({
      id: 'w', title: 'W', type: 'collect', start: { x: 0, z: 0 }, rewardText: 'r',
      steps: [{ kind: 'wait', x: 0, z: 0, radius: 5, waitS: 1, text: 'Wait' }],
    });
    const fsm = new MissionFsm(wait);
    fsm.accept();
    feed(fsm, Array.from({ length: 6 }, () => [0, 0] as [number, number]));
    expect(fsm.waitedS).toBeCloseTo(0.6, 6);
    fsm.tick(tick(10, 0));
    expect(fsm.waitedS).toBe(0);
    const events = feed(fsm, Array.from({ length: 10 }, () => [1, 1] as [number, number]));
    expect(events.slice(0, 9).flat()).toEqual([]);
    expect(events[9]).toEqual([{ kind: 'done', elapsedS: expect.closeTo(1.7, 6) as number }]);
  });

  it('abandon fails the mission; accept restarts it from step 0', () => {
    const fsm = new MissionFsm(Mission.parse({ ...route, timeLimitS: 60 }));
    expect(fsm.abandon()).toEqual([]);
    fsm.accept();
    fsm.tick(tick(100, 0));
    expect(fsm.stepIndex).toBe(1);
    expect(fsm.abandon()).toEqual([{ kind: 'failed', reason: 'abandoned', elapsedS: expect.closeTo(0.1, 6) as number }]);
    expect(fsm.status).toBe('failed');
    expect(fsm.failReason).toBe('abandoned');
    expect(fsm.accept()).toEqual([{ kind: 'accepted' }, { kind: 'step', index: 0 }]);
    expect(fsm.stepIndex).toBe(0);
    expect(fsm.elapsedS).toBe(0);
    expect(fsm.remainingS).toBe(60);
    expect(fsm.failReason).toBeUndefined();
    fsm.reset();
    expect(fsm.status).toBe('idle');
    expect(fsm.stepIndex).toBe(-1);
  });
});
