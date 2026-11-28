import { describe, expect, it } from 'vitest';
import { Mission } from '@ktm/schema';
import type { MissionTick } from './fsm.ts';
import { formatDistance, formatDuration, MissionSystem, type MarkerSink, type MarkerTarget } from './MissionSystem.ts';

const taxi = Mission.parse({
  id: 'fare', title: 'Fare', type: 'taxi', start: { x: 0, z: 0 }, rewardText: 'Rs 100', timeLimitS: 60,
  steps: [
    { kind: 'pickup', x: 0, z: 0, radius: 10, text: 'Pick up' },
    { kind: 'dropoff', x: 1000, z: 0, radius: 10, text: 'Drop off' },
  ],
});
const photo = Mission.parse({
  id: 'snap', title: 'Snap', type: 'photo', start: { x: 0, z: 0 }, rewardText: 'Photo taken',
  steps: [
    { kind: 'wait', x: 0, z: 0, radius: 5, waitS: 3, text: 'Hold' },
    { kind: 'photo', x: 50, z: 0, radius: 10, text: 'Take the photo', window: { fromH: 17, toH: 19 } },
  ],
});

class Sink implements MarkerSink {
  targets: MarkerTarget[] = [];
  set(t: readonly MarkerTarget[]): void { this.targets = [...t]; }
}

const t = (x: number, z: number, o: Partial<MissionTick> = {}): MissionTick => ({ dt: 0.5, x, z, speed: 0, photo: false, timeOfDay: 12, ...o });

describe('formatting', () => {
  it('formats distances in metres, then kilometres', () => {
    expect(formatDistance(4.4)).toBe('4 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(4615)).toBe('4.6 km');
  });
  it('formats countdowns as m:ss, rounding up', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59.4)).toBe('1:00');
    expect(formatDuration(605)).toBe('10:05');
  });
});

describe('MissionSystem', () => {
  it('is quiet and marker-free until a mission is accepted', () => {
    const sink = new Sink();
    const sys = new MissionSystem([taxi, photo], sink);
    expect(sys.active).toBeUndefined();
    expect(sys.hudText(0, 0, 12)).toBe('');
    expect(sys.tick(t(0, 0))).toEqual([]);
    expect(sink.targets).toEqual([]);
  });

  it('accept marks the current step and previews the next one', () => {
    const sink = new Sink();
    const sys = new MissionSystem([taxi, photo], sink);
    expect(sys.accept('fare')).toBe(true);
    expect(sys.active?.mission.id).toBe('fare');
    expect(sink.targets).toEqual([
      { x: 0, z: 0, radius: 10, current: true },
      { x: 1000, z: 0, radius: 10, current: false },
    ]);
    expect(sys.hudText(0, 0, 12)).toBe('Fare  1/2  1:00\nPick up  0 m');
  });

  it('accepts by list index and refuses unknown ids', () => {
    const sys = new MissionSystem([taxi, photo]);
    expect(sys.accept('nope')).toBe(false);
    expect(sys.accept(7)).toBe(false);
    expect(sys.accept(1)).toBe(true);
    expect(sys.active?.mission.id).toBe('snap');
  });

  it('follows the step machine: markers move on, HUD shows distance, done shows the reward then clears', () => {
    const sink = new Sink();
    const sys = new MissionSystem([taxi], sink);
    sys.accept('fare');
    expect(sys.tick(t(0, 0))).toEqual([{ kind: 'step', index: 1 }]);
    expect(sink.targets).toEqual([{ x: 1000, z: 0, radius: 10, current: true }]);
    expect(sys.hudText(0, 0, 12)).toBe('Fare  2/2  1:00\nDrop off  1.0 km');
    sys.tick(t(0, 0, { dt: 1 }));
    expect(sys.hudText(0, 0, 12)).toBe('Fare  2/2  0:59\nDrop off  1.0 km');
    const done = sys.tick(t(995, 0));
    expect(done).toEqual([{ kind: 'done', elapsedS: 2 }]);
    expect(sink.targets).toEqual([]);
    expect(sys.hudText(995, 0, 12)).toBe('Mission complete: Fare\nRs 100');
    for (let i = 0; i < 12; i++) sys.tick(t(995, 0));
    expect(sys.active).toBeUndefined();
    expect(sys.hudText(995, 0, 12)).toBe('');
  });

  it('reports a timeout and clears the markers', () => {
    const sink = new Sink();
    const sys = new MissionSystem([taxi], sink);
    sys.accept('fare');
    const ev = sys.tick(t(500, 500, { dt: 61 }));
    expect(ev).toEqual([{ kind: 'failed', reason: 'timeout', elapsedS: 61 }]);
    expect(sink.targets).toEqual([]);
    expect(sys.hudText(500, 500, 12)).toBe('Mission failed: Fare\nOut of time');
  });

  it('abandon fails the active mission; accepting another while one runs is refused', () => {
    const sys = new MissionSystem([taxi, photo]);
    sys.accept('fare');
    expect(sys.accept('snap')).toBe(false);
    expect(sys.abandon()).toEqual([{ kind: 'failed', reason: 'abandoned', elapsedS: 0 }]);
    expect(sys.hudText(0, 0, 12)).toBe('Mission failed: Fare\nAbandoned');
    expect(sys.accept('snap')).toBe(true);
  });

  it('shows the wait countdown, the photo key and a closed clock window', () => {
    const sys = new MissionSystem([photo]);
    sys.accept('snap');
    sys.tick(t(0, 0, { dt: 1 }));
    expect(sys.hudText(0, 0, 12)).toBe('Snap  1/2\nHold  0 m  hold 2 s');
    sys.tick(t(0, 0, { dt: 2 }));
    expect(sys.active?.stepIndex).toBe(1);
    expect(sys.hudText(45, 0, 12)).toBe('Snap  2/2\nTake the photo  5 m  [F] photo  (17:00-19:00)');
    expect(sys.tick(t(45, 0, { photo: true, timeOfDay: 12 }))).toEqual([]);
    expect(sys.tick(t(45, 0, { photo: true, timeOfDay: 17.5 }))[0]?.kind).toBe('done');
  });

  it('lists missions with their number keys and marks the active one', () => {
    const sys = new MissionSystem([taxi, photo]);
    expect(sys.listOpen).toBe(false);
    sys.toggleList();
    expect(sys.listOpen).toBe(true);
    expect(sys.listText()).toBe('Missions (J to close)\n1  Fare  [taxi]\n2  Snap  [photo]\n\nPress a number to accept.');
    sys.accept(0);
    expect(sys.listOpen).toBe(false);
    sys.toggleList();
    expect(sys.listText()).toBe('Missions (J to close)\n1  Fare  [taxi]  < active\n2  Snap  [photo]\n\nBackspace abandons the active mission.');
  });
});
