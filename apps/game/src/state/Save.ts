/**
 * Save and resume.
 *
 * The game writes `{version: 1, x, y, z, heading, timeOfDay, vehicle, savedAt}` to localStorage under
 * `ktm.save.v1` every 5 s and on `visibilitychange`. On load the entry is restored field by field, and explicit
 * URL parameters win:
 * - `reset=1` clears the entry and restores nothing;
 * - `tile`, `x`, `z` or `hero` keep the saved position (and the vehicle, which lives at that position) unused;
 * - `t` keeps the saved time unused;
 * - `vehicle` keeps the saved vehicle unused.
 * Entries that fail to parse, carry another version or hold malformed fields are ignored and cleared.
 */
import { VehicleType } from '@ktm/schema';

export const SAVE_KEY = 'ktm.save.v1';
export const SAVE_INTERVAL_MS = 5000;

export interface SaveData { version: 1; x: number; y: number; z: number; heading: number; timeOfDay: number; vehicle: VehicleType | null; savedAt: number }
export interface SaveStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface Resume { position?: { x: number; y: number; z: number; heading: number }; timeOfDay?: number; vehicle?: VehicleType }
export interface VisibilityTarget {
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

const NUMBER_FIELDS = ['x', 'y', 'z', 'heading', 'timeOfDay', 'savedAt'] as const;

export function serialiseSave(d: SaveData): string {
  return JSON.stringify(d);
}

export function parseSave(raw: string | null): SaveData | null {
  if (raw === null) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return null;
  for (const k of NUMBER_FIELDS) if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return null;
  let vehicle: VehicleType | null = null;
  if (o.vehicle !== null) {
    const parsed = VehicleType.safeParse(o.vehicle);
    if (!parsed.success) return null;
    vehicle = parsed.data;
  }
  const n = o as Record<(typeof NUMBER_FIELDS)[number], number>;
  return { version: 1, x: n.x, y: n.y, z: n.z, heading: n.heading, timeOfDay: n.timeOfDay, vehicle, savedAt: n.savedAt };
}

/** Writes the entry; storage errors (quota, private mode) are swallowed. */
export function writeSave(storage: SaveStorage, d: SaveData): void {
  try { storage.setItem(SAVE_KEY, serialiseSave(d)); } catch { /* storage unavailable */ }
}

function clear(storage: SaveStorage): void {
  try { storage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}

/** What to restore for this page load, given the stored entry and the URL query string. */
export function loadResume(storage: SaveStorage, search: string): Resume {
  const q = new URLSearchParams(search);
  if (q.get('reset') === '1') { clear(storage); return {}; }
  let raw: string | null;
  try { raw = storage.getItem(SAVE_KEY); } catch { return {}; }
  const save = parseSave(raw);
  if (!save) { if (raw !== null) clear(storage); return {}; }
  const out: Resume = {};
  const explicitPlace = q.has('tile') || q.has('x') || q.has('z') || q.has('hero') || q.has('mission');
  if (!explicitPlace) {
    out.position = { x: save.x, y: save.y, z: save.z, heading: save.heading };
    if (save.vehicle && !q.has('vehicle')) out.vehicle = save.vehicle;
  }
  if (!q.has('t')) out.timeOfDay = save.timeOfDay;
  return out;
}

/** Writes `snapshot()` every interval and on each visibility change; returns a stop function. */
export function startAutosave(opts: { storage: SaveStorage; snapshot: () => SaveData; target: VisibilityTarget; intervalMs?: number }): () => void {
  const write = () => {
    let d: SaveData;
    try { d = opts.snapshot(); } catch { return; }
    writeSave(opts.storage, d);
  };
  const id = setInterval(write, opts.intervalMs ?? SAVE_INTERVAL_MS);
  opts.target.addEventListener('visibilitychange', write);
  return () => {
    clearInterval(id);
    opts.target.removeEventListener('visibilitychange', write);
  };
}
