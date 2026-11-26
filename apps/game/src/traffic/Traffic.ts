import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { VehicleTuning, VehicleType } from '@ktm/schema';
import type { Physics } from '../physics/Physics.ts';
import { VEHICLE_COLORS, wheelLayout } from '../vehicles/Vehicle.ts';
import { IDM, idmAccel, idmStep } from './idm.ts';
import { laneCentre } from './lane.ts';
import type { Exit, GraphEdge, NavGraph } from './NavGraph.ts';

interface XZ { x: number; z: number }

/** The parts of a vehicle tuning the traffic model needs. */
export interface TrafficSpec { length: number; width: number; maxSpeedKmh: number }

export interface TrafficOptions {
  /** Vehicle cap. */
  max: number;
  /** New vehicles appear on edges within this distance of the player, m. */
  spawnRadius: number;
  /** Once the cap has been reached, respawns keep at least this far from the player so they do not pop up in view, m. */
  minSpawnDistance: number;
  /** Spawns always keep at least this far from the player, m. */
  playerClearance: number;
  /** Vehicles farther than this from the player are removed, m. */
  despawnRadius: number;
  /** At a node with three or more edges, yield while another vehicle with priority is within this distance of it, m. */
  yieldRadius: number;
  /** Spawn attempts per step. */
  spawnAttempts: number;
  random: () => number;
}

export const TRAFFIC_DEFAULTS: TrafficOptions = {
  max: 60, spawnRadius: 300, minSpawnDistance: 60, playerClearance: 25, despawnRadius: 450, yieldRadius: 8, spawnAttempts: 8, random: Math.random,
};

export interface TrafficCar {
  id: number;
  type: VehicleType;
  length: number; width: number;
  /** Own top speed, m/s. */
  maxSpeed: number;
  /** Fraction of the speed limit this driver aims for (0.85..1). */
  eagerness: number;
  edge: GraphEdge;
  /** Travelling edge.from -> edge.to. */
  forward: boolean;
  /** Distance travelled along the current edge from its entry node, m. */
  s: number;
  v: number;
  accel: number;
  yielding: boolean;
  /** Seconds spent yielding in a row; past YIELD_PATIENCE_S the vehicle goes anyway, which breaks any standoff. */
  yieldTime: number;
  /** Planned exits after the current edge, nearest first. */
  route: Exit[];
  /** World pose of the lane centre under the vehicle; yaw with forward = (sin yaw, cos yaw). y is interpolated from the nodes. */
  x: number; y: number; z: number; yaw: number;
}

const SPAWN_MIX: readonly [VehicleType, number][] = [['taxi', 0.4], ['motorbike', 0.4], ['tempo', 0.2]];
/** How far ahead the route is planned and leaders are searched for, m. */
const LOOKAHEAD_M = 80;
/** Junctions closer than this are checked for right of way, m. */
const YIELD_LOOKAHEAD_M = 40;
/** Front bumper stops this far before a junction node it yields at, m. */
const STOP_BACK_M = 3;
const YIELD_PATIENCE_S = 6;
/** No spawn within this distance of another vehicle in the same lane, m. */
const SPAWN_SPACING_M = 15;
/** Nor within this straight-line distance of any vehicle. */
const SPAWN_CLEARANCE_M = 6;
const MIN_SPAWN_EDGE_M = 8;
/** Below this distance to the next edge, its lower speed limit applies, m. */
const LIMIT_PREVIEW_M = 25;
/** Obstacles (player, drivable vehicles) are noticed this far ahead, m. */
const OBSTACLE_LOOKAHEAD_M = 30;
/** Lateral reach beyond half the vehicle width within which an obstacle blocks the lane, m. */
const OBSTACLE_MARGIN_M = 1.5;
/** Assumed half-length of an obstacle, m. */
const OBSTACLE_HALF_M = 1.5;

const kmh = (v: number) => v / 3.6;
const entryNode = (a: { edge: GraphEdge; forward: boolean }) => (a.forward ? a.edge.from : a.edge.to);
const exitNode = (a: { edge: GraphEdge; forward: boolean }) => (a.forward ? a.edge.to : a.edge.from);
const laneKey = (e: GraphEdge, forward: boolean) => (forward ? e.id : -e.id);

/**
 * Ambient traffic on the stitched nav graph, without any rendering or physics: spawning and despawning around the player,
 * route choice at nodes, IDM car-following along the planned route, right of way at junctions and left-hand lane poses.
 */
export class TrafficSim {
  readonly cars: TrafficCar[] = [];
  onSpawn?: (a: TrafficCar) => void;
  onDespawn?: (a: TrafficCar) => void;
  private opts: TrafficOptions;
  private nextId = 1;
  private filled = false;
  private candidates: { edges: GraphEdge[]; cum: number[]; total: number; version: number; at: XZ } | undefined;

  constructor(private graph: NavGraph, private specs: Record<VehicleType, TrafficSpec>, opts: Partial<TrafficOptions> = {}) {
    this.opts = { ...TRAFFIC_DEFAULTS, ...opts };
  }

  /** Place a vehicle explicitly (tests and scripted scenes); s is measured from the entry node in the travel direction. */
  addCar(type: VehicleType, edge: GraphEdge, forward: boolean, s: number, v = 0): TrafficCar {
    const spec = this.specs[type];
    const a: TrafficCar = {
      id: this.nextId++, type, length: spec.length, width: spec.width, maxSpeed: kmh(spec.maxSpeedKmh), eagerness: 0.85 + 0.15 * this.opts.random(),
      edge, forward, s, v, accel: 0, yielding: false, yieldTime: 0, route: [], x: 0, y: 0, z: 0, yaw: 0,
    };
    this.planRoute(a);
    this.pose(a);
    this.cars.push(a);
    this.onSpawn?.(a);
    return a;
  }

  /** obstacles: things in the world traffic must not drive into (the player, the drivable vehicles), world XZ. */
  step(dt: number, player: XZ, obstacles: readonly XZ[] = []): void {
    this.despawn(player);
    this.spawn(player);
    if (this.cars.length >= this.opts.max) this.filled = true;
    if (dt <= 0 || this.cars.length === 0) return;

    // Lanes (directed edges) sorted by position, and who is near which junction node.
    const lanes = new Map<number, TrafficCar[]>();
    for (const a of this.cars) {
      const k = laneKey(a.edge, a.forward);
      const l = lanes.get(k); if (l) l.push(a); else lanes.set(k, [a]);
    }
    for (const l of lanes.values()) l.sort((p, q) => p.s - q.s);
    const near = new Map<string, { a: TrafficCar; d: number; leaving: boolean }[]>();
    const reg = (node: string, a: TrafficCar, d: number, leaving: boolean) => {
      if (d >= this.opts.yieldRadius || this.graph.degree(node) < 3) return;
      const l = near.get(node); const item = { a, d, leaving };
      if (l) l.push(item); else near.set(node, [item]);
    };
    for (const a of this.cars) {
      reg(entryNode(a), a, a.s, true);
      let d = a.edge.length - a.s;
      reg(exitNode(a), a, d, false);
      for (const x of a.route) { if (d >= this.opts.yieldRadius) break; d += x.edge.length; reg(x.forward ? x.edge.to : x.edge.from, a, d, false); }
    }

    // Accelerations from the pre-step state, then integrate.
    const gaps = new Map<TrafficCar, number>();
    for (const a of this.cars) {
      const limit = this.limitFor(a);
      let { gap, dv } = this.leader(a, lanes);
      const block = this.obstacleGap(a, obstacles);
      if (block < gap) { gap = block; dv = a.v; }
      a.yielding = false;
      const stop = this.yieldStop(a, near);
      if (stop !== undefined && a.yieldTime < YIELD_PATIENCE_S && stop < gap) { gap = stop; dv = a.v; a.yielding = true; }
      a.yieldTime = a.yielding ? a.yieldTime + dt : 0;
      a.accel = idmAccel(a.v, limit * a.eagerness, gap, dv, IDM);
      gaps.set(a, gap);
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const a = this.cars[i]!;
      const r = idmStep(a.v, a.accel, dt, this.vMax(a), gaps.get(a));
      a.v = r.v;
      if (!this.advance(a, r.ds)) { this.cars.splice(i, 1); this.onDespawn?.(a); continue; }
      this.pose(a);
    }
  }

  private despawn(player: XZ): void {
    const far = this.opts.despawnRadius;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const a = this.cars[i]!;
      if (a.edge.removed || Math.hypot(a.x - player.x, a.z - player.z) > far) { this.cars.splice(i, 1); this.onDespawn?.(a); continue; }
      // A planned edge streamed out: cut the route there and plan again on what is loaded now.
      const cut = a.route.findIndex((x) => x.edge.removed);
      if (cut >= 0) { a.route.length = cut; this.planRoute(a); }
    }
  }

  /** Edges with any part within the spawn radius, weighted by length and speed so main roads carry more traffic. */
  private spawnCandidates(player: XZ): NonNullable<TrafficSim['candidates']> {
    const c = this.candidates;
    if (c && c.version === this.graph.version && Math.hypot(c.at.x - player.x, c.at.z - player.z) < 20) return c;
    const edges: GraphEdge[] = []; const cum: number[] = []; let total = 0;
    const r = this.opts.spawnRadius;
    for (const e of this.graph.edges()) {
      if (e.length < MIN_SPAWN_EDGE_M) continue;
      const a = this.graph.node(e.from)!; const b = this.graph.node(e.to)!;
      if (segmentDistance(player, a, b) > r) continue;
      total += e.length * (e.speed / 25);
      edges.push(e); cum.push(total);
    }
    this.candidates = { edges, cum, total, version: this.graph.version, at: { x: player.x, z: player.z } };
    return this.candidates;
  }

  private spawn(player: XZ): void {
    const o = this.opts;
    if (this.cars.length >= o.max) return;
    const c = this.spawnCandidates(player);
    if (c.edges.length === 0) return;
    const minD = Math.max(o.playerClearance, this.filled ? o.minSpawnDistance : 0);
    for (let k = 0; k < o.spawnAttempts && this.cars.length < o.max; k++) {
      const pick = o.random() * c.total;
      let lo = 0; let hi = c.cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (c.cum[mid]! < pick) lo = mid + 1; else hi = mid; }
      const edge = c.edges[lo]!;
      const forward = edge.oneway || o.random() < 0.5;
      const type = this.pickType();
      const len = this.specs[type].length;
      if (edge.length < len + 2) continue;
      const s = len / 2 + 1 + o.random() * (edge.length - len - 2);
      const p = this.lanePoint(edge, forward, s);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d > o.spawnRadius || d < minD) continue;
      if (this.cars.some((a) => (a.edge === edge && a.forward === forward && Math.abs(a.s - s) < SPAWN_SPACING_M) || Math.hypot(a.x - p.x, a.z - p.z) < SPAWN_CLEARANCE_M)) continue;
      const a = this.addCar(type, edge, forward, s, 0);
      a.v = this.vMax(a) * a.eagerness * (0.5 + 0.5 * o.random());
    }
  }

  private pickType(): VehicleType {
    let r = this.opts.random();
    for (const [t, w] of SPAWN_MIX) { if (r < w) return t; r -= w; }
    return 'taxi';
  }

  /** Extend the planned route to the lookahead distance. */
  private planRoute(a: TrafficCar): void {
    let ahead = a.edge.length - a.s;
    let cur: Exit = { edge: a.edge, forward: a.forward };
    for (const x of a.route) { ahead += x.edge.length; cur = x; }
    while (ahead < LOOKAHEAD_M) {
      const next = this.chooseExit(cur);
      if (!next) break;
      a.route.push(next);
      ahead += next.edge.length;
      cur = next;
    }
  }

  /** Pick how to leave the node at the end of `via`: no U-turn unless it is a dead end; straighter and faster roads are likelier. */
  private chooseExit(via: Exit): Exit | undefined {
    const node = via.forward ? via.edge.to : via.edge.from;
    const all = this.graph.exits(node);
    const onward = all.filter((x) => x.edge !== via.edge);
    const options = onward.length > 0 ? onward : all;
    if (options.length === 0) return undefined;
    const dIn = this.direction(via);
    let total = 0;
    const w = options.map((x) => {
      const d = this.direction(x);
      const straight = Math.max(0, dIn.x * d.x + dIn.z * d.z);
      total += 0.15 + 2 * straight * straight + x.edge.speed / 25;
      return total;
    });
    const pick = this.opts.random() * total;
    return options[w.findIndex((c) => c >= pick)] ?? options[options.length - 1];
  }

  private direction(x: Exit): XZ {
    const a = this.graph.node(x.forward ? x.edge.from : x.edge.to); const b = this.graph.node(x.forward ? x.edge.to : x.edge.from);
    if (!a || !b) return { x: 0, z: 0 };
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }

  /** Speed limit of the current edge, eased down early when the next edge is slower, capped at the vehicle's top speed. */
  private limitFor(a: TrafficCar): number {
    let limit = kmh(a.edge.speed);
    const next = a.route[0];
    if (next && a.edge.length - a.s < LIMIT_PREVIEW_M) limit = Math.min(limit, kmh(next.edge.speed));
    return Math.min(limit, a.maxSpeed);
  }

  private vMax(a: TrafficCar): number { return Math.min(kmh(a.edge.speed), a.maxSpeed); }

  /** Gap to the nearest obstacle straight ahead within half a vehicle width plus OBSTACLE_MARGIN_M of the heading line. */
  private obstacleGap(a: TrafficCar, obstacles: readonly XZ[]): number {
    let best = Infinity;
    const fx = Math.sin(a.yaw); const fz = Math.cos(a.yaw);
    for (const o of obstacles) {
      const dx = o.x - a.x; const dz = o.z - a.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > OBSTACLE_LOOKAHEAD_M) continue;
      if (Math.abs(dx * fz - dz * fx) > a.width / 2 + OBSTACLE_MARGIN_M) continue;
      best = Math.min(best, Math.max(0, ahead - a.length / 2 - OBSTACLE_HALF_M));
    }
    return best;
  }

  /** Bumper-to-bumper gap to the nearest vehicle ahead along the planned route (Infinity if none within the lookahead). */
  private leader(a: TrafficCar, lanes: Map<number, TrafficCar[]>): { gap: number; dv: number } {
    const lane = lanes.get(laneKey(a.edge, a.forward))!;
    const i = lane.indexOf(a);
    const ahead = lane[i + 1];
    if (ahead) return { gap: ahead.s - a.s - (ahead.length + a.length) / 2, dv: a.v - ahead.v };
    let dist = a.edge.length - a.s;
    for (const x of a.route) {
      if (dist > LOOKAHEAD_M) break;
      const l = lanes.get(laneKey(x.edge, x.forward));
      const rear = l?.[0];
      if (rear && rear !== a) return { gap: dist + rear.s - (rear.length + a.length) / 2, dv: a.v - rear.v };
      dist += x.edge.length;
    }
    return { gap: Infinity, dv: 0 };
  }

  /**
   * Gap to a virtual stop line before the first junction (three or more edges) ahead where someone else has right of way:
   * a vehicle that has just left the node, or one approaching it that is closer (ties go to the older vehicle).
   */
  private yieldStop(a: TrafficCar, near: Map<string, { a: TrafficCar; d: number; leaving: boolean }[]>): number | undefined {
    let d = a.edge.length - a.s;
    let node = exitNode(a);
    const myEdges = new Set<GraphEdge>([a.edge, ...a.route.map((x) => x.edge)]);
    for (let k = 0; ; k++) {
      if (d > YIELD_LOOKAHEAD_M) return undefined;
      const others = near.get(node);
      if (others) {
        for (const o of others) {
          if (o.a === a) continue;
          // Same carriageway as one of my planned edges: that is following (or the opposite lane), not crossing.
          if (myEdges.has(o.a.edge)) continue;
          if (o.leaving || o.d < d || (o.d === d && o.a.id < a.id)) {
            const stop = d - a.length / 2 - STOP_BACK_M;
            return stop > 0.5 ? stop : undefined; // already over the line: clear the junction instead
          }
        }
      }
      const x = a.route[k];
      if (!x) return undefined;
      d += x.edge.length;
      node = x.forward ? x.edge.to : x.edge.from;
    }
  }

  /** Move along the route; false when the route ran out (the vehicle leaves the simulation). */
  private advance(a: TrafficCar, ds: number): boolean {
    a.s += ds;
    while (a.s >= a.edge.length) {
      const next = a.route.shift();
      if (!next) return false;
      a.s -= a.edge.length;
      a.edge = next.edge; a.forward = next.forward;
    }
    this.planRoute(a);
    return true;
  }

  private lanePoint(edge: GraphEdge, forward: boolean, s: number): { x: number; y: number; z: number; yaw: number } {
    const n0 = this.graph.node(forward ? edge.from : edge.to); const n1 = this.graph.node(forward ? edge.to : edge.from);
    if (!n0 || !n1) return { x: 0, y: 0, z: 0, yaw: 0 };
    const t = edge.length > 0 ? Math.min(1, Math.max(0, s / edge.length)) : 0;
    const c = laneCentre(n0, n1, t, edge.width);
    return { x: c.x, y: n0.y + (n1.y - n0.y) * t, z: c.z, yaw: Math.atan2(n1.x - n0.x, n1.z - n0.z) };
  }

  private pose(a: TrafficCar): void { Object.assign(a, this.lanePoint(a.edge, a.forward, a.s)); }
}

/** Distance from p to segment ab in XZ. */
function segmentDistance(p: XZ, a: XZ, b: XZ): number {
  const dx = b.x - a.x; const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}

export interface TrafficViewOptions extends Partial<TrafficOptions> {
  /** Only vehicles this close to the player get a kinematic collider, m. */
  colliderRadius?: number;
  /** Ground height under a point (world Y), when known; otherwise the height interpolated between nav nodes is used. */
  groundY?: (x: number, z: number) => number | undefined;
}

const COLLIDER_RADIUS_M = 60;
const COLLIDER_HYSTERESIS_M = 5;
const MAX_SUBSTEP_S = 0.05;
const TURN_RATE = 4; // rad/s, visual heading easing at corners
const ROAD_LIFT_M = 0.08;

interface TypeMeshes { body: THREE.InstancedMesh; wheels: THREE.InstancedMesh; wheelSpots: { x: number; z: number }[]; rideHeight: number }

/**
 * Renders the traffic simulation with the G1 placeholder vehicle shapes (one instanced body and wheel set per type)
 * and gives vehicles near the player kinematic colliders. No dynamic bodies: traffic moves kinematically along edges.
 */
export class Traffic {
  readonly sim: TrafficSim;
  private meshes = new Map<VehicleType, TypeMeshes>();
  private colliders = new Map<number, { body: RAPIER.RigidBody; collider: RAPIER.Collider }>();
  private headings = new Map<number, number>();
  private colliderRadius: number;
  private groundY?: (x: number, z: number) => number | undefined;
  private disposables: { dispose(): void }[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private scene: THREE.Scene, private physics: Physics, graph: NavGraph, private tunings: Record<VehicleType, VehicleTuning>, opts: TrafficViewOptions = {}) {
    const { colliderRadius = COLLIDER_RADIUS_M, groundY, ...simOpts } = opts;
    this.colliderRadius = colliderRadius;
    this.groundY = groundY;
    this.sim = new TrafficSim(graph, tunings, simOpts);
    const max = { ...TRAFFIC_DEFAULTS, ...simOpts }.max;
    this.sim.onDespawn = (a) => { this.dropCollider(a.id); this.headings.delete(a.id); };
    const wheelMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b1b1b, roughness: 0.9 });
    this.disposables.push(wheelMat);
    for (const type of Object.keys(tunings) as VehicleType[]) {
      const t = tunings[type];
      const bodyMat = new THREE.MeshStandardNodeMaterial({ color: VEHICLE_COLORS[type], roughness: 0.6, metalness: 0.1 });
      const bodyGeo = new THREE.BoxGeometry(t.width, t.height, t.length);
      const wheelWidth = type === 'motorbike' ? 0.12 : 0.2;
      const wheelGeo = new THREE.CylinderGeometry(t.wheelRadius, t.wheelRadius, wheelWidth, 12).rotateZ(Math.PI / 2);
      const spots = type === 'motorbike'
        ? wheelLayout(type, t).filter((_, i) => i % 2 === 0).map((w) => ({ x: 0, z: w.z }))
        : wheelLayout(type, t).map((w) => ({ x: w.x, z: w.z }));
      const body = new THREE.InstancedMesh(bodyGeo, bodyMat, Math.max(1, max));
      const wheels = new THREE.InstancedMesh(wheelGeo, wheelMat, Math.max(1, max * spots.length));
      for (const im of [body, wheels]) { im.count = 0; im.castShadow = true; im.frustumCulled = false; im.name = `traffic-${type}`; scene.add(im); }
      body.receiveShadow = true;
      this.disposables.push(bodyMat, bodyGeo, wheelGeo, body, wheels);
      // Same rest pose as the drivable vehicle: chassis centre at suspension rest + wheel radius above the wheel mount.
      this.meshes.set(type, { body, wheels, wheelSpots: spots, rideHeight: t.suspensionRestLength + t.wheelRadius + t.height / 2 - 0.1 });
    }
  }

  get count(): number { return this.sim.cars.length; }

  /** Advance by dt seconds of simulated time around the player, then sync meshes and colliders. Traffic stops for the obstacles (default: the player). */
  update(dt: number, player: XZ, obstacles: readonly XZ[] = [player]): void {
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_S));
    for (let i = 0; i < n; i++) this.sim.step(dt / n, player, obstacles);
    const counts = new Map<VehicleType, number>();
    for (const a of this.sim.cars) {
      const tm = this.meshes.get(a.type)!;
      const k = counts.get(a.type) ?? 0; counts.set(a.type, k + 1);
      const ground = this.groundY?.(a.x, a.z);
      const y = (ground !== undefined && Number.isFinite(ground) ? ground : a.y) + ROAD_LIFT_M;
      let yaw = this.headings.get(a.id) ?? a.yaw;
      const d = Math.atan2(Math.sin(a.yaw - yaw), Math.cos(a.yaw - yaw));
      yaw += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * Math.max(dt, 1 / 60));
      this.headings.set(a.id, yaw);
      this.q.setFromAxisAngle(this.up, yaw);
      this.p.set(a.x, y + tm.rideHeight, a.z);
      tm.body.setMatrixAt(k, this.m.compose(this.p, this.q, this.one));
      const r = this.tunings[a.type].wheelRadius;
      const sin = Math.sin(yaw); const cos = Math.cos(yaw);
      tm.wheelSpots.forEach((w, j) => {
        // Local +X is the vehicle's left, +Z forward; rotate by yaw about +Y.
        this.p.set(a.x + w.x * cos + w.z * sin, y + r, a.z - w.x * sin + w.z * cos);
        tm.wheels.setMatrixAt(k * tm.wheelSpots.length + j, this.m.compose(this.p, this.q, this.one));
      });
      this.syncCollider(a, y + tm.rideHeight, yaw, player);
    }
    for (const [type, tm] of this.meshes) {
      const c = counts.get(type) ?? 0;
      tm.body.count = c; tm.wheels.count = c * tm.wheelSpots.length;
      tm.body.instanceMatrix.needsUpdate = true; tm.wheels.instanceMatrix.needsUpdate = true;
    }
  }

  /** Number of vehicles that currently have a collider (debug). */
  get colliderCount(): number { return this.colliders.size; }

  private syncCollider(a: TrafficCar, cy: number, yaw: number, player: XZ): void {
    const d = Math.hypot(a.x - player.x, a.z - player.z);
    let c = this.colliders.get(a.id);
    if (!c && d > this.colliderRadius) return;
    if (c && d > this.colliderRadius + COLLIDER_HYSTERESIS_M) { this.dropCollider(a.id); return; }
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    if (!c) {
      const t = this.tunings[a.type];
      const w = this.physics.world;
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(a.x, cy, a.z).setRotation(rot));
      const collider = w.createCollider(RAPIER.ColliderDesc.cuboid(t.width / 2, t.height / 2, t.length / 2), body);
      c = { body, collider };
      this.colliders.set(a.id, c);
      return;
    }
    c.body.setNextKinematicTranslation({ x: a.x, y: cy, z: a.z });
    c.body.setNextKinematicRotation(rot);
  }

  private dropCollider(id: number): void {
    const c = this.colliders.get(id);
    if (!c) return;
    this.physics.world.removeRigidBody(c.body); // removes the attached collider too
    this.colliders.delete(id);
  }

  dispose(): void {
    for (const id of [...this.colliders.keys()]) this.dropCollider(id);
    for (const tm of this.meshes.values()) { this.scene.remove(tm.body); this.scene.remove(tm.wheels); }
    for (const d of this.disposables) d.dispose();
  }
}
