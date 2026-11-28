import { describe, expect, it } from 'vitest';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { Nav } from '@ktm/schema';
import { NavGraph } from '../traffic/NavGraph.ts';
import { conflictDistance, PedSim, sidewalkOffset, type PedCar } from './Pedestrians.ts';
import { makePath } from './steer.ts';

const T: TileId = 'x14_y17';
const O = tileOrigin(T);
const DT = 1 / 30;

function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const node = (x: number, z: number) => ({ id: `n_${Math.round((O.x + x) * 100)}_${Math.round((O.z + z) * 100)}`, x, y: 0, z, border: false });
const edge = (a: { id: string }, b: { id: string }, cls = 'residential', width = 6) => ({ from: a.id, to: b.id, lanes: 2, oneway: false, speed: 25, cls, width });
const world = (x: number, z: number) => ({ x: O.x + x, z: O.z + z });

/** n x n street grid with `block` m blocks starting at local (100, 100). */
function gridNav(n = 6, block = 100): Nav {
  const nodes = []; const edges = [];
  const at = (i: number, j: number) => node(100 + i * block, 100 + j * block);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    nodes.push(at(i, j));
    if (i < n - 1) edges.push(edge(at(i, j), at(i + 1, j)));
    if (j < n - 1) edges.push(edge(at(i, j), at(i, j + 1)));
  }
  return { nodes, edges };
}

/** One straight east-west street from local x 100 to 700 at z 400, split into 20 m edges. */
function streetNav(width = 6): Nav {
  const nodes = []; const edges = [];
  for (let x = 100; x <= 700; x += 20) { nodes.push(node(x, 400)); if (x > 100) edges.push(edge(node(x - 20, 400), node(x, 400), 'residential', width)); }
  return { nodes, edges };
}

function graphOf(nav: Nav): NavGraph { const g = new NavGraph(); g.addTile(T, nav); return g; }

describe('PedSim', () => {
  it('fills up to the cap within the spawn radius and never exceeds 120', () => {
    const sim = new PedSim(graphOf(gridNav()), { random: rng(2) }, () => 'old-core');
    const player = world(350, 350);
    for (let i = 0; i < 300; i++) {
      sim.step(DT, player);
      expect(sim.peds.length).toBeLessThanOrEqual(120);
    }
    expect(sim.target).toBe(120);
    expect(sim.peds.length).toBe(120);
    for (const p of sim.peds) expect(Math.hypot(p.x - player.x, p.z - player.z)).toBeLessThan(300);
  });

  it('puts three times as many people on core-zone streets', () => {
    const run = (zone: string) => {
      const sim = new PedSim(graphOf(gridNav(3, 60)), { random: rng(5) }, () => zone);
      const player = world(160, 160);
      for (let i = 0; i < 200; i++) sim.step(DT, player);
      return { target: sim.target, count: sim.peds.length };
    };
    const suburb = run('suburb'); const core = run('old-core');
    expect(suburb.target).toBeGreaterThan(3);
    expect(core.target).toBeLessThan(120);
    expect(core.target / suburb.target).toBeCloseTo(3, 0);
    expect(core.count).toBe(core.target);
    expect(suburb.count).toBe(suburb.target);
  });

  it('walks road edges at width / 2 + 1 m from the centreline', () => {
    const width = 8;
    const sim = new PedSim(graphOf(streetNav(width)), { random: rng(7) });
    const player = world(400, 400);
    for (let i = 0; i < 600; i++) {
      sim.step(DT, player);
      if (i < 60) continue;
      for (const p of sim.peds) {
        if (Math.abs(p.x - player.x) > 280) continue; // street ends, where people turn round and cross
        if (p.crossing) continue;
        expect(Math.abs(Math.abs(p.z - player.z) - sidewalkOffset(width))).toBeLessThan(1.5);
      }
    }
    expect(sidewalkOffset(width)).toBe(5);
    expect(sim.peds.length).toBeGreaterThan(10);
  });

  it('keeps people off the carriageway except where they cross', () => {
    const g = graphOf(gridNav());
    const sim = new PedSim(g, { random: rng(17) }, () => 'old-core');
    const player = world(350, 350);
    const edges = [...g.edges()].map((e) => [g.node(e.from)!, g.node(e.to)!] as const);
    const toRoad = (p: { x: number; z: number }) => Math.min(...edges.map(([a, b]) => {
      const dx = b.x - a.x; const dz = b.z - a.z; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
    }));
    let crossings = 0; let samples = 0;
    for (let i = 0; i < 900; i++) {
      sim.step(DT, player);
      if (i % 10 !== 0) continue;
      for (const p of sim.peds) {
        samples++;
        if (p.crossing) { crossings++; continue; }
        expect(toRoad(p)).toBeGreaterThan(sidewalkOffset(6) - 1.5);
      }
    }
    expect(crossings).toBeGreaterThan(0);
    expect(crossings / samples).toBeLessThan(0.2);
  });

  it('spawns at ped_spawn points', () => {
    const sim = new PedSim(graphOf(gridNav()), { random: rng(9), propShare: 1, max: 10 });
    const spot = world(330, 305);
    sim.setSpawnPoints([spot]);
    sim.step(DT, world(350, 350));
    expect(sim.peds.length).toBeGreaterThan(0);
    for (const p of sim.peds) expect(Math.hypot(p.x - spot.x, p.z - spot.z)).toBeLessThan(1.5);
  });

  it('removes people beyond 300 m and spawns new ones only within 200 m', () => {
    const sim = new PedSim(graphOf(gridNav(8)), { random: rng(11) });
    let player = world(200, 200);
    for (let i = 0; i < 60; i++) sim.step(DT, player);
    expect(sim.peds.length).toBeGreaterThan(0);
    player = world(800, 800);
    sim.step(DT, player);
    for (const p of sim.peds) expect(Math.hypot(p.x - player.x, p.z - player.z)).toBeLessThanOrEqual(300);
    for (let i = 0; i < 30; i++) sim.step(DT, player);
    for (const p of sim.peds) expect(Math.hypot(p.x - player.x, p.z - player.z)).toBeLessThanOrEqual(201);
  });

  it('keeps people apart from each other and out of the player', () => {
    const sim = new PedSim(graphOf(streetNav(4)), { random: rng(13), max: 120, perMetre: 0.2 });
    const player = { ...world(400, 400 - sidewalkOffset(4)), fixed: true };
    let minPair = Infinity; let minPlayer = Infinity;
    for (let i = 0; i < 400; i++) {
      sim.step(DT, player);
      const ps = sim.peds;
      for (let a = 0; a < ps.length; a++) {
        minPlayer = Math.min(minPlayer, Math.hypot(ps[a]!.x - player.x, ps[a]!.z - player.z));
        for (let b = a + 1; b < ps.length; b++) minPair = Math.min(minPair, Math.hypot(ps[a]!.x - ps[b]!.x, ps[a]!.z - ps[b]!.z));
      }
    }
    expect(sim.peds.length).toBeGreaterThan(60);
    expect(minPlayer).toBeGreaterThanOrEqual(0.7 - 1e-6);
    expect(minPair).toBeGreaterThan(0.6);
  });

  it('stops 1.5 m before a vehicle crossing its path, then goes on', () => {
    const sim = new PedSim(new NavGraph(), { random: rng(1), max: 0 });
    const p = sim.addPed([{ x: 0, z: 0 }, { x: 40, z: 0 }], 1.4);
    // Driving +z (forward = (sin yaw, cos yaw)), timed to reach the crossing point just as the walker does.
    const car: PedCar = { x: 12, z: -40, yaw: 0, length: 4, width: 1.7, v: 6 };
    let waited = false; let minGap = Infinity;
    for (let i = 0; i < 900; i++) {
      sim.step(DT, { x: 0, z: 100 }, [car]);
      car.z += car.v * DT;
      const inLane = Math.abs(car.z - p.z) < car.length / 2 + 6; // the car is near the crossing point
      if (inLane) minGap = Math.min(minGap, car.x - car.width / 2 - p.x);
      if (p.stopped) waited = true;
    }
    expect(waited).toBe(true);
    expect(minGap).toBeGreaterThanOrEqual(1.5 - 0.1);
    expect(p.x).toBeGreaterThan(30);
  });
});

describe('conflictDistance', () => {
  it('finds where a path enters a vehicle swept box', () => {
    const path = makePath([{ x: 0, z: 0 }, { x: 20, z: 0 }]);
    const car: PedCar = { x: 10, z: -3, yaw: 0, length: 4, width: 2, v: 5 };
    const d = conflictDistance(path, 0, [car], 12);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(9.6);
    expect(conflictDistance(path, 0, [{ ...car, z: 10 }], 12)).toBe(Infinity); // already past
    expect(conflictDistance(path, 0, [{ ...car, x: 30 }], 12)).toBe(Infinity); // too far along the path
    expect(conflictDistance(path, 9, [car], 12)).toBe(0); // already in its way: keep walking to clear it
  });
});
