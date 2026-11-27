import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inGrid, tileIndexAt } from '@ktm/geo';
import { Mission } from '@ktm/schema';
import { MISSIONS, parseCatalog } from './catalog.ts';

const DIR = new URL('../../../../world/missions/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const raw = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(new URL(f, DIR), 'utf8')) as unknown]));

const SEED_IDS = [
  'airport-to-thamel', 'asan-to-new-road', 'bhaktapur-pottery', 'kirtipur-hill-climb', 'momo-to-boudha',
  'old-core-hiti', 'pashupatinath-pilgrimage', 'ring-road-lap', 'swayambhu-sunset', 'thamel-to-patan',
];

describe('world/missions/*.json', () => {
  it('holds the ten seed missions', () => {
    expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(SEED_IDS);
  });

  for (const f of files) {
    describe(f, () => {
      const m = Mission.safeParse(raw[f]);
      it('matches the Mission schema', () => { expect(m.error?.issues ?? []).toEqual([]); });
      if (!m.success) return;
      it('is named after its id', () => { expect(`${m.data.id}.json`).toBe(f); });
      it('places the start and every step inside the tile grid', () => {
        for (const p of [m.data.start, ...m.data.steps]) {
          const { i, j } = tileIndexAt(p.x, p.z);
          expect(inGrid(i, j), `${p.x},${p.z}`).toBe(true);
        }
      });
      it('keeps radii between 5 and 50 m and step text short', () => {
        for (const s of m.data.steps) {
          expect(s.radius).toBeGreaterThanOrEqual(5);
          expect(s.radius).toBeLessThanOrEqual(50);
          expect(s.text.length).toBeLessThanOrEqual(80);
        }
      });
    });
  }

  it('times the Swayambhunath photo to the 17:00-19:00 window', () => {
    const m = Mission.parse(raw['swayambhu-sunset.json']);
    const photo = m.steps.find((s) => s.kind === 'photo');
    expect(photo?.window).toEqual({ fromH: 17, toH: 19 });
  });

  it('laps the Ring Road through four checkpoints back to the start', () => {
    const m = Mission.parse(raw['ring-road-lap.json']);
    expect(m.steps).toHaveLength(5);
    expect(m.steps.every((s) => s.kind === 'goto')).toBe(true);
    const last = m.steps[4]!;
    expect(Math.hypot(last.x - m.start.x, last.z - m.start.z)).toBeLessThan(1);
  });

  it('asks for five distinct hiti', () => {
    const m = Mission.parse(raw['old-core-hiti.json']);
    expect(m.steps).toHaveLength(5);
    expect(new Set(m.steps.map((s) => `${s.x},${s.z}`)).size).toBe(5);
  });

  it('opens the Thamel fare with a pickup at the start, so step 2 is the drive to Patan', () => {
    const m = Mission.parse(raw['thamel-to-patan.json']);
    expect(m.steps.map((s) => s.kind)).toEqual(['pickup', 'dropoff']);
    expect(Math.hypot(m.steps[0]!.x - m.start.x, m.steps[0]!.z - m.start.z)).toBeLessThan(m.steps[0]!.radius);
  });
});

describe('catalog', () => {
  it('bundles every mission file, sorted by id', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual(SEED_IDS);
  });

  it('rejects a file whose id does not match its name', () => {
    const m = { id: 'a', title: 'A', type: 'photo', start: { x: 0, z: 0 }, steps: [{ kind: 'goto', x: 0, z: 0, text: 'go' }], rewardText: 'r' };
    expect(() => parseCatalog({ '/world/missions/b.json': m })).toThrow(/b\.json/);
    expect(parseCatalog({ '/world/missions/a.json': m })[0]?.steps[0]?.radius).toBe(8);
  });

  it('names the file in schema errors', () => {
    expect(() => parseCatalog({ '/x/bad.json': { id: 'bad' } })).toThrow(/bad\.json/);
  });
});
