import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadResume, parseSave, SAVE_KEY, type SaveData, type SaveStorage, serialiseSave, startAutosave, writeSave } from './Save.ts';

class FakeStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

const save: SaveData = { version: 1, x: 120.5, y: 3.2, z: -40.25, heading: 1.57, timeOfDay: 7.75, vehicle: 'taxi', savedAt: 1_800_000_000_000 };
const stored = (extra: Record<string, unknown> = {}) => {
  const s = new FakeStorage();
  s.setItem(SAVE_KEY, JSON.stringify({ ...save, ...extra }));
  return s;
};

describe('serialise and parse', () => {
  it('round trips', () => {
    expect(parseSave(serialiseSave(save))).toEqual(save);
    expect(parseSave(serialiseSave({ ...save, vehicle: null }))).toEqual({ ...save, vehicle: null });
  });
  it('rejects corrupt, mismatched and malformed entries', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('{not json')).toBeNull();
    expect(parseSave('42')).toBeNull();
    expect(parseSave('null')).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, version: 2 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, x: 'a' }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, timeOfDay: null }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, vehicle: 'hovercraft' }))).toBeNull();
  });
  it('drops unknown fields', () => {
    expect(parseSave(JSON.stringify({ ...save, extra: true }))).toEqual(save);
  });
});

describe('loadResume', () => {
  it('restores position, time and vehicle after a write', () => {
    const s = new FakeStorage();
    writeSave(s, save);
    expect(loadResume(s, '')).toEqual({ position: { x: 120.5, y: 3.2, z: -40.25, heading: 1.57 }, timeOfDay: 7.75, vehicle: 'taxi' });
  });
  it('restores on foot when no vehicle was saved', () => {
    expect(loadResume(stored({ vehicle: null }), '').vehicle).toBeUndefined();
  });
  it('returns nothing without an entry', () => {
    expect(loadResume(new FakeStorage(), '')).toEqual({});
  });
  it('ignores and clears corrupt JSON', () => {
    const s = new FakeStorage();
    s.setItem(SAVE_KEY, '{"version":1,');
    expect(loadResume(s, '')).toEqual({});
    expect(s.map.has(SAVE_KEY)).toBe(false);
  });
  it('ignores and clears a version mismatch', () => {
    const s = stored({ version: 2 });
    expect(loadResume(s, '')).toEqual({});
    expect(s.map.has(SAVE_KEY)).toBe(false);
  });
  it('ignores a bad field', () => {
    expect(loadResume(stored({ x: 'a' }), '')).toEqual({});
    expect(loadResume(stored({ vehicle: 'hovercraft' }), '')).toEqual({});
  });
  it('reset=1 clears the entry', () => {
    const s = stored();
    expect(loadResume(s, '?reset=1')).toEqual({});
    expect(s.map.has(SAVE_KEY)).toBe(false);
  });
  it('lets explicit position parameters win', () => {
    for (const q of ['?tile=x14_y17', '?x=1&z=2', '?x=1', '?hero=foo', '?mission=thamel-to-patan']) {
      const r = loadResume(stored(), q);
      expect(r.position, q).toBeUndefined();
      expect(r.vehicle, q).toBeUndefined();
      expect(r.timeOfDay, q).toBe(7.75);
    }
  });
  it('lets an explicit time win', () => {
    const r = loadResume(stored(), '?t=06:00');
    expect(r.timeOfDay).toBeUndefined();
    expect(r.position).toEqual({ x: 120.5, y: 3.2, z: -40.25, heading: 1.57 });
    expect(r.vehicle).toBe('taxi');
  });
  it('lets an explicit vehicle win', () => {
    const r = loadResume(stored(), '?vehicle=motorbike');
    expect(r.vehicle).toBeUndefined();
    expect(r.position).toBeDefined();
  });
  it('keeps the entry when explicit parameters win', () => {
    const s = stored();
    loadResume(s, '?tile=x14_y17&t=06:00');
    expect(parseSave(s.getItem(SAVE_KEY))).toEqual(save);
  });
  it('survives a storage that throws', () => {
    const s: SaveStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
    expect(loadResume(s, '')).toEqual({});
    expect(loadResume(s, '?reset=1')).toEqual({});
    expect(() => writeSave(s, save)).not.toThrow();
  });
});

describe('startAutosave', () => {
  afterEach(() => { vi.useRealTimers(); });
  const target = () => {
    const fns = new Set<() => void>();
    return {
      addEventListener: (_: 'visibilitychange', fn: () => void) => { fns.add(fn); },
      removeEventListener: (_: 'visibilitychange', fn: () => void) => { fns.delete(fn); },
      fire: () => { for (const fn of fns) fn(); },
    };
  };

  it('writes every 5 s and on visibilitychange until stopped', () => {
    vi.useFakeTimers();
    const s = new FakeStorage();
    const t = target();
    let n = 0;
    const stop = startAutosave({ storage: s, target: t, snapshot: () => ({ ...save, savedAt: ++n }) });
    vi.advanceTimersByTime(4999);
    expect(s.map.has(SAVE_KEY)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(parseSave(s.getItem(SAVE_KEY))?.savedAt).toBe(1);
    t.fire();
    expect(parseSave(s.getItem(SAVE_KEY))?.savedAt).toBe(2);
    stop();
    vi.advanceTimersByTime(20_000);
    t.fire();
    expect(n).toBe(2);
  });
  it('keeps running when a snapshot throws', () => {
    vi.useFakeTimers();
    const s = new FakeStorage();
    let n = 0;
    const stop = startAutosave({ storage: s, target: target(), snapshot: () => { if (++n === 1) throw new Error('not ready'); return save; } });
    vi.advanceTimersByTime(5000);
    expect(s.map.has(SAVE_KEY)).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(parseSave(s.getItem(SAVE_KEY))).toEqual(save);
    stop();
  });
});
