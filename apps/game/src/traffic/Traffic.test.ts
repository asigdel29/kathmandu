import { describe, expect, it } from 'vitest';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { Nav, VehicleType } from '@ktm/schema';
import { NavGraph, type GraphEdge } from './NavGraph.ts';
import { TrafficSim, type TrafficSpec } from './Traffic.ts';

const T: TileId = 'x14_y17';
const O = tileOrigin(T);
const SPECS: Record<VehicleType, TrafficSpec> = {
  taxi: { length: 4, width: 1.7, maxSpeedKmh: 90 },
  tempo: { length: 3.2, width: 1.2, maxSpeedKmh: 45 },
  motorbike: { length: 2, width: 0.6, maxSpeedKmh: 80 },
  micro: { length: 4.6, width: 1.7, maxSpeedKmh: 80 },
  bus: { length: 9.8, width: 2.45, maxSpeedKmh: 60 },
  truck: { length: 7.2, width: 2.35, maxSpeedKmh: 60 },
};

/** Deterministic PRNG so spawn tests are repeatable. */
function rng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const node = (x: number, z: number) => ({ id: `n_${Math.round((O.x + x) * 100)}_${Math.round((O.z + z) * 100)}`, x, y: 0, z, border: false });
const edge = (a: { id: string }, b: { id: string }, oneway = false, speed = 25) => ({ from: a.id, to: b.id, lanes: 2, oneway, speed, cls: 'residential', width: 8 });

/** A 6x6 street grid with 100 m blocks starting at local (100, 100). */
function gridNav(): Nav {
  const nodes = []; const edges = [];
  const at = (i: number, j: number) => node(100 + i * 100, 100 + j * 100);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    nodes.push(at(i, j));
    if (i < 5) edges.push(edge(at(i, j), at(i + 1, j)));
    if (j < 5) edges.push(edge(at(i, j), at(i, j + 1)));
  }
  return { nodes, edges };
}

function graphOf(nav: Nav): NavGraph { const g = new NavGraph(); g.addTile(T, nav); return g; }
const world = (x: number, z: number) => ({ x: O.x + x, z: O.z + z });
const findEdge = (g: NavGraph, from: string, to: string): GraphEdge => [...g.edges()].find((e) => e.from === from && e.to === to)!;

describe('TrafficSim', () => {
  it('fills up to the cap on edges within the spawn radius and never exceeds it', () => {
    const g = graphOf(gridNav());
    const sim = new TrafficSim(g, SPECS, { max: 25, random: rng(3) });
    const player = world(350, 350);
    for (let i = 0; i < 300; i++) {
      sim.step(1 / 30, player);
      expect(sim.cars.length).toBeLessThanOrEqual(25);
    }
    expect(sim.cars.length).toBe(25);
    for (const a of sim.cars) expect(Math.hypot(a.x - player.x, a.z - player.z)).toBeLessThan(450);
  });

  it('despawns beyond 450 m and respawns near the player', () => {
    const g = graphOf(gridNav());
    const sim = new TrafficSim(g, SPECS, { max: 10, spawnRadius: 120, random: rng(5) });
    for (let i = 0; i < 10; i++) sim.step(1 / 30, world(150, 150));
    const first = new Set(sim.cars);
    expect(first.size).toBe(10);
    // Jump 700 m diagonally (beyond the 500 m grid): everything spawned around the first spot is now > 450 m away.
    sim.step(1 / 30, world(850, 850));
    expect(sim.cars.some((a) => first.has(a))).toBe(false);
    // Back on the grid, the cap refills around the new position.
    const p = world(550, 550);
    for (let i = 0; i < 10; i++) sim.step(1 / 30, p);
    expect(sim.cars.length).toBe(10);
    for (const a of sim.cars) expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeLessThanOrEqual(130);
  });

  it('places an eastbound vehicle north of the centreline (left-hand traffic)', () => {
    const a = node(0, 50); const b = node(200, 50);
    const g = graphOf({ nodes: [a, b], edges: [edge(a, b)] });
    const sim = new TrafficSim(g, SPECS, { max: 0, random: rng(1) });
    const car = sim.addCar('taxi', findEdge(g, a.id, b.id), true, 50, 0);
    expect(car.z).toBeCloseTo(O.z + 50 - 8 / 4, 9);
    expect(car.x).toBeCloseTo(O.x + 50, 9);
    expect(car.yaw).toBeCloseTo(Math.PI / 2, 9); // forward = (sin yaw, cos yaw) = +x
    const back = sim.addCar('taxi', findEdge(g, a.id, b.id), false, 50, 0);
    expect(back.z).toBeCloseTo(O.z + 50 + 2, 9);
  });

  it('follows a leader without overlapping and never exceeds the edge limit', () => {
    // A 400 m oneway loop.
    const n = [node(100, 100), node(200, 100), node(200, 200), node(100, 200)];
    const g = graphOf({ nodes: n, edges: n.map((p, i) => edge(p, n[(i + 1) % 4]!, true, 30)) });
    const sim = new TrafficSim(g, SPECS, { max: 0, random: rng(9) });
    const e0 = findEdge(g, n[0]!.id, n[1]!.id);
    for (let i = 0; i < 8; i++) sim.addCar(i % 2 ? 'motorbike' : 'taxi', e0, true, 5 + i * 11, i % 3);
    const limit = 30 / 3.6;
    const along = (a: (typeof sim.cars)[number]) => {
      const k = n.findIndex((p) => p.id === (a.forward ? a.edge.from : a.edge.to));
      return k * 100 + a.s;
    };
    for (let step = 0; step < 1500; step++) {
      sim.step(1 / 30, world(150, 150));
      const order = [...sim.cars].sort((p, q) => along(p) - along(q));
      for (let i = 0; i < order.length; i++) {
        const me = order[i]!; const lead = order[(i + 1) % order.length]!;
        const gap = ((along(lead) - along(me) + 400) % 400) - (me.length + lead.length) / 2;
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(me.v).toBeLessThanOrEqual(limit + 1e-9);
      }
    }
    expect(sim.cars.length).toBe(8);
  });

  it('yields at a junction of three or more edges to a vehicle closer to the node', () => {
    const c = node(300, 300); const w = node(200, 300); const e = node(400, 300); const s = node(300, 400);
    const g = graphOf({ nodes: [c, w, e, s], edges: [edge(w, c), edge(c, e), edge(s, c)] });
    expect(g.degree(c.id)).toBe(3);
    const mk = () => new TrafficSim(g, SPECS, { max: 0, random: rng(2) });

    const free = mk();
    const lone = free.addCar('taxi', findEdge(g, w.id, c.id), true, 85, 4);
    free.step(1 / 30, world(300, 300));
    expect(lone.accel).toBeGreaterThan(0);

    const busy = mk();
    const me = busy.addCar('taxi', findEdge(g, w.id, c.id), true, 85, 4); // 15 m out
    const other = busy.addCar('taxi', findEdge(g, s.id, c.id), true, 95, 0); // 5 m out on the south arm, travelling north
    busy.step(1 / 30, world(300, 300));
    expect(me.accel).toBeLessThan(0);
    expect(me.yielding).toBe(true);
    expect(other.yielding).toBe(false);
  });

  it('does not yield at a plain two-edge node', () => {
    const a = node(100, 100); const b = node(200, 100); const c = node(300, 100);
    const g = graphOf({ nodes: [a, b, c], edges: [edge(a, b), edge(b, c)] });
    const sim = new TrafficSim(g, SPECS, { max: 0, random: rng(1) });
    const me = sim.addCar('taxi', findEdge(g, a.id, b.id), true, 90, 4);
    sim.addCar('taxi', findEdge(g, b.id, c.id), false, 95, 0);
    sim.step(1 / 30, world(200, 100));
    expect(me.yielding).toBe(false);
  });

  it('keeps a busy street grid moving: no NaN, no same-lane overlap, no gridlock', () => {
    const g = graphOf(gridNav());
    const sim = new TrafficSim(g, SPECS, { max: 60, random: rng(11) });
    const player = world(350, 350);
    let moving = 0; let samples = 0;
    for (let step = 0; step < 3000; step++) {
      sim.step(1 / 20, player);
      const lanes = new Map<string, typeof sim.cars>();
      for (const a of sim.cars) {
        expect(Number.isFinite(a.x + a.z + a.v + a.s)).toBe(true);
        const k = `${a.edge.id}:${a.forward}`;
        lanes.set(k, [...(lanes.get(k) ?? []), a]);
      }
      for (const l of lanes.values()) {
        l.sort((p, q) => p.s - q.s);
        for (let i = 1; i < l.length; i++) expect(l[i]!.s - l[i - 1]!.s - (l[i]!.length + l[i - 1]!.length) / 2).toBeGreaterThanOrEqual(0);
      }
      if (step >= 2000) { samples += sim.cars.length; moving += sim.cars.filter((a) => a.v > 0.5).length; }
    }
    expect(sim.cars.length).toBe(60);
    expect(moving / samples).toBeGreaterThan(0.5);
  });

  it('brakes for an obstacle in its lane ahead (the player or a parked vehicle) but not for one beside or behind', () => {
    const a = node(0, 50); const b = node(300, 50);
    const g = graphOf({ nodes: [a, b], edges: [edge(a, b)] });
    const run = (ob: { x: number; z: number }) => {
      const sim = new TrafficSim(g, SPECS, { max: 0, random: rng(1) });
      const car = sim.addCar('taxi', findEdge(g, a.id, b.id), true, 100, 3);
      sim.step(1 / 30, world(0, 0), [world(ob.x, ob.z)]);
      return car.accel;
    };
    expect(run({ x: 108, z: 48 })).toBeLessThan(-1);
    expect(run({ x: 108, z: 56 })).toBeGreaterThan(0);
    expect(run({ x: 90, z: 48 })).toBeGreaterThan(0);
  });

  it('drops vehicles whose edge streamed out', () => {
    const g = graphOf(gridNav());
    const sim = new TrafficSim(g, SPECS, { max: 5, random: rng(4) });
    const gone: number[] = [];
    sim.onDespawn = (a) => gone.push(a.id);
    sim.step(1 / 30, world(350, 350));
    expect(sim.cars.length).toBe(5);
    g.removeTile(T);
    sim.step(1 / 30, world(350, 350));
    expect(sim.cars.length).toBe(0);
    expect(gone).toHaveLength(5);
  });

  describe('foot-class edges', () => {
    const FOOT = ['footway', 'path', 'pedestrian', 'steps'];
    /** The street grid plus, at every node, a footway spur, and a path cutting every block diagonally. */
    function gridWithFootways(): Nav {
      const nav = gridNav();
      const byXZ = new Map(nav.nodes.map((n) => [`${n.x},${n.z}`, n]));
      const foot = (a: { id: string }, b: { id: string }, k: number) => ({ from: a.id, to: b.id, lanes: 0, oneway: false, speed: 5, cls: FOOT[k % FOOT.length]!, width: 2 });
      let k = 0;
      for (const n of [...nav.nodes]) {
        const s = node(n.x + 20, n.z + 20);
        nav.nodes.push(s);
        nav.edges.push(foot(n, s, k++));
        const d = byXZ.get(`${n.x + 100},${n.z + 100}`);
        if (d) nav.edges.push(foot(n, d, k++));
      }
      return nav;
    }

    it('never spawns on or routes onto a foot-class edge in 1,000 steps', () => {
      const nav = gridWithFootways();
      const g = graphOf(nav);
      expect([...g.edges()].filter((e) => e.lanes === 0).length).toBeGreaterThan(40);
      const sim = new TrafficSim(g, SPECS, { max: 40, random: rng(11) });
      const player = world(350, 350);
      let seen = 0;
      for (let i = 0; i < 1000; i++) {
        sim.step(1 / 30, player);
        for (const a of sim.cars) {
          seen++;
          expect(a.edge.lanes, `car ${a.id} on ${a.edge.cls}`).toBeGreaterThan(0);
          expect(FOOT).not.toContain(a.edge.cls);
          for (const x of a.route) { expect(x.edge.lanes).toBeGreaterThan(0); expect(FOOT).not.toContain(x.edge.cls); }
        }
      }
      expect(seen).toBeGreaterThan(10_000);
    });

    it('treats a footway-only spur as a dead end for vehicles, even when it is the only other way on', () => {
      const a = node(0, 50); const b = node(200, 50); const f = node(200, 150);
      const g = graphOf({ nodes: [a, b, f], edges: [edge(a, b), { from: b.id, to: f.id, lanes: 0, oneway: false, speed: 5, cls: 'footway', width: 2 }] });
      const sim = new TrafficSim(g, SPECS, { max: 0, random: rng(2) });
      const car = sim.addCar('taxi', findEdge(g, a.id, b.id), true, 150, 5);
      expect(car.route.every((x) => x.edge.cls !== 'footway')).toBe(true);
      for (let i = 0; i < 600 && sim.cars.length > 0; i++) { sim.step(1 / 30, world(100, 50)); expect(car.edge.cls).not.toBe('footway'); }
    });

    it('does not yield at a two-road node just because a footway meets it', () => {
      const a = node(0, 50); const b = node(100, 50); const c = node(200, 50); const f = node(100, 150);
      const g = graphOf({ nodes: [a, b, c, f], edges: [edge(a, b), edge(b, c), { from: b.id, to: f.id, lanes: 0, oneway: false, speed: 5, cls: 'path', width: 1.5 }] });
      expect(g.degree(b.id)).toBe(3);
      expect(g.driveDegree(b.id)).toBe(2);
      const sim = new TrafficSim(g, SPECS, { max: 0, random: rng(1) });
      const car = sim.addCar('taxi', findEdge(g, a.id, b.id), true, 30, 6);
      const other = sim.addCar('taxi', findEdge(g, b.id, c.id), true, 1, 6);
      sim.step(1 / 30, world(0, 0));
      expect(car.yielding).toBe(false);
      expect(other.yielding).toBe(false);
    });
  });
});
