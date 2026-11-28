import * as THREE from 'three/webgpu';
import type { TileId } from '@ktm/geo';
import palette from '../../../../world/style/palette.json';
import { FOOT_CLASSES, type GraphEdge, type NavGraph } from '../traffic/NavGraph.ts';
import { makePath, pointAt, resolveOverlaps, stepWalker, type Path, type Walker, type XZ } from './steer.ts';
import { FIGURE_POOL_DEFAULT, FigurePool, type FigurePerson } from './PedFigures.ts';

/** Edge classes that are walked down the middle; every other class is a road, walked along both edges. */
export { FOOT_CLASSES };

/** People walk a road's edges this far from its centreline: half the carriageway plus 1 m. */
export const sidewalkOffset = (width: number): number => width / 2 + 1;

/** A vehicle people give way to: position, heading (forward = (sin yaw, cos yaw)), size and speed (m/s). */
export interface PedCar { x: number; z: number; yaw: number; length: number; width: number; v: number }

export interface PedOptions {
  /** Pedestrian cap. */
  max: number;
  /** New people appear on walkways within this distance of the player, m. */
  spawnRadius: number;
  /** People farther than this from the player are removed, m. */
  despawnRadius: number;
  /** Once the target count has been reached, respawns keep at least this far from the player, m. */
  minSpawnDistance: number;
  /** Spawns always keep at least this far from the player, m. */
  playerClearance: number;
  /** People per metre of walkway in a zone with factor 1 (each side of a road counts separately). */
  perMetre: number;
  /** Density factor for `*-core` zones. */
  coreFactor: number;
  /** Share of spawns placed at ped_spawn points when there are any in range. */
  propShare: number;
  /** At a junction, share of people who cross to the far side of the next street. */
  crossShare: number;
  spawnAttempts: number;
  random: () => number;
}

export const PED_DEFAULTS: PedOptions = {
  max: 120, spawnRadius: 200, despawnRadius: 300, minSpawnDistance: 40, playerClearance: 3, perMetre: 0.012, coreFactor: 3,
  propShare: 0.3, crossShare: 0.25, spawnAttempts: 6, random: Math.random,
};

/** How one path segment came about: walking a walkway (edge + side), or linking two walkways. */
interface Leg {
  edge?: GraphEdge;
  /** +1 left of from->to, -1 right, 0 down the middle (foot classes). */
  side: number;
  /** Walking from -> to. */
  forward: boolean;
  /** A link that crosses a carriageway. */
  crossing: boolean;
}

export interface Ped extends Walker {
  id: number;
  /** World Y of the walkway under the person (interpolated between nav nodes). */
  y: number;
  path: Path;
  /** legs[i] describes path segment i -> i + 1. */
  legs: Leg[];
  /** Last walkway planned; the route continues from its end. Undefined for scripted people. */
  tail?: Leg;
  /** Waiting for a vehicle to pass. */
  stopped: boolean;
  /** On a link across a carriageway. */
  crossing: boolean;
}

type WalkLeg = Leg & { edge: GraphEdge };

interface Walkway { edge: GraphEdge; side: number }

/** Distance along the path planned ahead of a person, m. */
const PLAN_AHEAD_M = 12;
/** Vehicles within this distance of a person are checked, m. */
const CAR_RANGE_M = 25;
/** The path ahead is checked for vehicles this far, m. */
const CONFLICT_LOOKAHEAD_M = 4;
const CONFLICT_STEP_M = 0.5;
/**
 * Stop when the path enters a vehicle's swept box within this distance: 1.5 m clearance plus the sampling step plus the
 * braking distance from walking speed, so a person comes to rest at least 1.5 m short of it.
 */
const STOP_TRIGGER_M = 2.5;
/** Swept box margin around a vehicle, m. */
const CAR_MARGIN_M = 0.5;
/** Seconds of travel ahead of a vehicle that count as its path (at least CAR_MIN_AHEAD_M). */
const CAR_AHEAD_S = 2;
const CAR_MIN_AHEAD_M = 2;
/** No spawn within this distance of another person, m. */
const SPAWN_SPACING_M = 1;
const MIN_WALKWAY_M = 2;
/** Neighbours within this distance are passed to the steering, m. */
const NEIGHBOUR_M = 3;
/** A link longer than this crosses a carriageway, m. */
const CROSSING_LINK_M = 2.5;
const SPEED_MIN = 1.1; const SPEED_SPAN = 0.5;

/**
 * Distance along `path` from s to the first sample (every 0.5 m, up to `lookahead`) inside the swept box of a vehicle:
 * the box covers the vehicle plus CAR_MARGIN_M and the road CAR_AHEAD_S ahead of it. 0 when the person is already in it;
 * Infinity when the way is clear.
 */
export function conflictDistance(path: Path, s: number, cars: readonly PedCar[], lookahead = CONFLICT_LOOKAHEAD_M): number {
  if (cars.length === 0) return Infinity;
  for (let d = 0; d <= lookahead + 1e-9; d += CONFLICT_STEP_M) {
    if (s + d > path.length + 1e-9 && d > 0) break;
    const p = pointAt(path, s + d);
    for (const c of cars) {
      const fx = Math.sin(c.yaw); const fz = Math.cos(c.yaw);
      const rx = p.x - c.x; const rz = p.z - c.z;
      const along = rx * fx + rz * fz;
      const lat = rx * fz - rz * fx;
      const half = c.length / 2 + CAR_MARGIN_M;
      if (along < -half || along > half + Math.max(CAR_MIN_AHEAD_M, c.v * CAR_AHEAD_S)) continue;
      if (Math.abs(lat) > c.width / 2 + CAR_MARGIN_M) continue;
      return d;
    }
  }
  return Infinity;
}

/** Segment index of arc length s on a path. */
function segmentIndex(path: Path, s: number): number {
  let lo = 0; let hi = Math.max(0, path.pts.length - 2);
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (path.cum[mid]! <= s) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Distance from p to segment ab in XZ. */
function segmentDistance(p: XZ, a: XZ, b: XZ): number {
  const dx = b.x - a.x; const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}

/**
 * Pedestrians on the walkways of the stitched nav graph, without any rendering: both edges of every road (offset
 * width / 2 + 1 m) and the middle of foot-class edges. Spawning and despawning around the player with a target count
 * set by walkway length and zone density, route choice at nodes, steering with separation, and waiting for vehicles.
 * People are not physics bodies; they make way for the player instead (soft repulsion).
 */
export class PedSim {
  readonly peds: Ped[] = [];
  private opts: PedOptions;
  private nextId = 1;
  private filled = false;
  private spawnPoints: XZ[] = [];
  private _target = 0;
  private candidates: { ways: Walkway[]; cum: number[]; total: number; version: number; at: XZ } | undefined;

  /** zoneOf: style zone of a tile (from its meta); `*-core` zones get coreFactor times the density. */
  constructor(private graph: NavGraph, opts: Partial<PedOptions> = {}, private zoneOf: (tile: TileId) => string | undefined = () => undefined) {
    this.opts = { ...PED_DEFAULTS, ...opts };
  }

  /** Number of people the area around the player calls for (capped at max). */
  get target(): number { return this._target; }

  /** ped_spawn prop positions (world XZ) of the loaded tiles. */
  setSpawnPoints(points: readonly XZ[]): void { this.spawnPoints = points.map((p) => ({ x: p.x, z: p.z })); }

  /** Place a person on a fixed path (tests and scripted scenes); they stop at its end. */
  addPed(pts: readonly XZ[], speed: number): Ped {
    const path = makePath(pts);
    const p = this.make(path, path.pts.slice(1).map(() => ({ side: 0, forward: true, crossing: false })), speed, 0);
    this.peds.push(p);
    return p;
  }

  /** player: world XZ of the player, kept clear (fixed in the overlap resolution). cars: vehicles to give way to. */
  step(dt: number, player: XZ, cars: readonly PedCar[] = []): void {
    this.despawn(player);
    this.spawn(player);
    if (this._target > 0 && this.peds.length >= this._target) this.filled = true;
    if (dt <= 0 || this.peds.length === 0) return;

    const snap = this.peds.map((p) => ({ x: p.x, z: p.z }));
    const near: PedCar[] = [];
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i]!;
      const nb: XZ[] = [];
      for (let j = 0; j < snap.length; j++) {
        if (j === i) continue;
        const q = snap[j]!;
        if (Math.abs(q.x - p.x) < NEIGHBOUR_M && Math.abs(q.z - p.z) < NEIGHBOUR_M) nb.push(q);
      }
      if (Math.abs(player.x - p.x) < NEIGHBOUR_M && Math.abs(player.z - p.z) < NEIGHBOUR_M) nb.push(player);
      near.length = 0;
      for (const c of cars) if (Math.abs(c.x - p.x) < CAR_RANGE_M && Math.abs(c.z - p.z) < CAR_RANGE_M) near.push(c);
      const d = conflictDistance(p.path, p.s, near);
      p.stopped = d > 0 && d <= STOP_TRIGGER_M;
      stepWalker(p, p.path, nb, dt, p.stopped);
    }
    resolveOverlaps([...this.peds, { x: player.x, z: player.z, fixed: true }]);
    for (const p of this.peds) { this.extend(p); this.locate(p); }
  }

  private make(path: Path, legs: Leg[], speed: number, y: number): Ped {
    const start = path.pts[0] ?? { x: 0, z: 0 };
    return { id: this.nextId++, x: start.x, z: start.z, vx: 0, vz: 0, s: 0, speed, y, path, legs, stopped: false, crossing: false };
  }

  private despawn(player: XZ): void {
    const far = this.opts.despawnRadius;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i]!;
      if (Math.hypot(p.x - player.x, p.z - player.z) > far || p.legs.some((l) => l.edge?.removed)) this.peds.splice(i, 1);
    }
  }

  private factor(e: GraphEdge): number { return this.zoneOf(e.tile)?.endsWith('-core') ? this.opts.coreFactor : 1; }

  /** Walkways with any part within the spawn radius, weighted by length and zone density. */
  private spawnCandidates(player: XZ): NonNullable<PedSim['candidates']> {
    const c = this.candidates;
    if (c && c.version === this.graph.version && Math.hypot(c.at.x - player.x, c.at.z - player.z) < 20) return c;
    const ways: Walkway[] = []; const cum: number[] = []; let total = 0;
    const r = this.opts.spawnRadius;
    for (const e of this.graph.edges()) {
      if (e.length < MIN_WALKWAY_M) continue;
      const a = this.graph.node(e.from)!; const b = this.graph.node(e.to)!;
      if (segmentDistance(player, a, b) > r) continue;
      const w = e.length * this.factor(e);
      for (const side of FOOT_CLASSES.has(e.cls) ? [0] : [1, -1]) { total += w; ways.push({ edge: e, side }); cum.push(total); }
    }
    this.candidates = { ways, cum, total, version: this.graph.version, at: { x: player.x, z: player.z } };
    this._target = Math.min(this.opts.max, Math.round(total * this.opts.perMetre));
    return this.candidates;
  }

  private spawn(player: XZ): void {
    const o = this.opts;
    const c = this.spawnCandidates(player);
    if (this.peds.length >= this._target || c.ways.length === 0) return;
    const minD = Math.max(o.playerClearance, this.filled ? o.minSpawnDistance : 0);
    const props = this.spawnPoints.filter((q) => { const d = Math.hypot(q.x - player.x, q.z - player.z); return d <= o.spawnRadius && d >= minD; });
    // Until the target has been reached once, fill in one go so the street is populated from the first frame.
    const attempts = this.filled ? o.spawnAttempts : Math.max(o.spawnAttempts, 2 * (this._target - this.peds.length));
    for (let k = 0; k < attempts && this.peds.length < this._target; k++) {
      const p = props.length > 0 && o.random() < o.propShare ? this.spawnAtPoint(props[Math.floor(o.random() * props.length)]!, c.ways) : this.spawnOnWalkway(c);
      if (!p) continue;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d > o.spawnRadius || d < minD) continue;
      if (this.peds.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < SPAWN_SPACING_M)) continue;
      this.extend(p);
      this.locate(p);
      this.peds.push(p);
    }
  }

  private speed(): number { return SPEED_MIN + SPEED_SPAN * this.opts.random(); }

  private spawnOnWalkway(c: NonNullable<PedSim['candidates']>): Ped | undefined {
    const o = this.opts;
    const pick = o.random() * c.total;
    let lo = 0; let hi = c.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (c.cum[mid]! < pick) lo = mid + 1; else hi = mid; }
    const w = c.ways[lo]!;
    const forward = o.random() < 0.5;
    const a = this.wayPoint(w.edge, w.side, forward ? w.edge.from : w.edge.to);
    const b = this.wayPoint(w.edge, w.side, forward ? w.edge.to : w.edge.from);
    if (!a || !b) return undefined;
    const t = o.random() * 0.9;
    const start = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const leg: Leg = { edge: w.edge, side: w.side, forward, crossing: false };
    const p = this.make(makePath([start, b]), [leg], this.speed(), 0);
    p.tail = leg;
    return p;
  }

  /** At a ped_spawn point, walking to the nearest walkway first. */
  private spawnAtPoint(q: XZ, ways: readonly Walkway[]): Ped | undefined {
    let best: { w: Walkway; a: XZ; b: XZ; t: number; d: number } | undefined;
    for (const w of ways) {
      const a = this.wayPoint(w.edge, w.side, w.edge.from); const b = this.wayPoint(w.edge, w.side, w.edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2)) : 0;
      const d = Math.hypot(a.x + dx * t - q.x, a.z + dz * t - q.z);
      if (!best || d < best.d) best = { w, a, b, t, d };
    }
    if (!best) return undefined;
    const forward = this.opts.random() < 0.5;
    const join = { x: best.a.x + (best.b.x - best.a.x) * best.t, z: best.a.z + (best.b.z - best.a.z) * best.t };
    const leg: Leg = { edge: best.w.edge, side: best.w.side, forward, crossing: false };
    const pts = [q, join, forward ? best.b : best.a];
    const legs: Leg[] = [{ edge: best.w.edge, side: best.w.side, forward, crossing: false }, leg];
    const path = makePath(pts);
    // makePath drops a repeated point (q already on the walkway): keep legs aligned with segments.
    const p = this.make(path, legs.slice(legs.length - (path.pts.length - 1)), this.speed(), 0);
    p.tail = leg;
    return p;
  }

  /**
   * Point of walkway (edge, side) at one of the edge's nodes. At a junction (three or more edges) the walkway stops short
   * of the node by the widest crossing street's sidewalk offset, so walkways of neighbouring streets meet at the corners
   * instead of in the middle of the junction.
   */
  private wayPoint(e: GraphEdge, side: number, nodeId: string): XZ | undefined {
    const a = this.graph.node(e.from); const b = this.graph.node(e.to); const n = this.graph.node(nodeId);
    if (!a || !b || !n) return undefined;
    const dx = b.x - a.x; const dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
    let trim = 0;
    const at = this.graph.edgesAt(nodeId);
    if (at.length >= 3) {
      for (const x of at) if (x !== e) trim = Math.max(trim, FOOT_CLASSES.has(x.cls) ? x.width / 2 : sidewalkOffset(x.width));
      trim = Math.min(trim, 0.45 * e.length);
    }
    // Unit direction from the node into the edge.
    const sign = nodeId === e.from ? 1 : -1;
    const ix = (sign * dx) / l; const iz = (sign * dz) / l;
    const off = side === 0 ? 0 : side * sidewalkOffset(e.width);
    // Left of from -> to: for east (1, 0) that is north, -z.
    return { x: n.x + ix * trim + (dz / l) * off, z: n.z + iz * trim + (-dx / l) * off };
  }

  /** Plan the route past the end of the current path until PLAN_AHEAD_M is left ahead of the person. */
  private extend(p: Ped): void {
    if (!p.tail || p.path.length - p.s >= PLAN_AHEAD_M) return;
    const k = segmentIndex(p.path, p.s);
    const pts: XZ[] = [{ x: p.x, z: p.z }, ...p.path.pts.slice(k + 1)];
    const legs: Leg[] = p.legs.slice(k);
    let ahead = p.path.length - p.s;
    for (let guard = 0; guard < 16 && ahead < PLAN_AHEAD_M; guard++) {
      const next = this.nextWalkway(p.tail);
      if (!next) break;
      const end = pts[pts.length - 1]!;
      const a = this.wayPoint(next.edge, next.side, next.forward ? next.edge.from : next.edge.to);
      const b = this.wayPoint(next.edge, next.side, next.forward ? next.edge.to : next.edge.from);
      if (!a || !b) break;
      const link = Math.hypot(a.x - end.x, a.z - end.z);
      if (link > 0.05) { pts.push(a); legs.push({ ...next, crossing: link > CROSSING_LINK_M }); ahead += link; }
      pts.push(b); legs.push(next); ahead += next.edge.length;
      p.tail = next;
    }
    const path = makePath(pts);
    if (path.pts.length !== pts.length) return; // degenerate geometry; keep the old path this step
    p.path = path; p.legs = legs; p.s = 0;
  }

  /** How to go on from the end of walkway `w`: another edge at its end node (no U-turn unless it is a dead end) and a side. */
  private nextWalkway(w: Leg): WalkLeg | undefined {
    const e = w.edge;
    if (!e) return undefined;
    const node = w.forward ? e.to : e.from;
    const all = this.graph.edgesAt(node).filter((x) => !x.removed);
    const onward = all.filter((x) => x !== e);
    if (onward.length === 0) {
      // Dead end: turn round, crossing to the other side of a road.
      return { edge: e, side: -w.side, forward: !w.forward, crossing: false };
    }
    const n0 = this.graph.node(w.forward ? e.from : e.to)!; const n1 = this.graph.node(node)!;
    const inX = n1.x - n0.x; const inZ = n1.z - n0.z; const inL = Math.hypot(inX, inZ) || 1;
    let total = 0;
    const weights = onward.map((x) => {
      const other = this.graph.node(x.from === node ? x.to : x.from)!;
      const ox = other.x - n1.x; const oz = other.z - n1.z; const ol = Math.hypot(ox, oz) || 1;
      const straight = Math.max(0, (inX * ox + inZ * oz) / (inL * ol));
      total += 0.3 + straight * straight;
      return total;
    });
    const pick = this.opts.random() * total;
    const edge = onward[weights.findIndex((c) => c >= pick)] ?? onward[onward.length - 1]!;
    const forward = edge.from === node;
    if (FOOT_CLASSES.has(edge.cls)) return { edge, side: 0, forward, crossing: false };
    // Stay on the near side, except that some people cross over at junctions.
    const end = this.wayPoint(e, w.side, node)!;
    const dist = (side: number) => { const q = this.wayPoint(edge, side, node)!; return Math.hypot(q.x - end.x, q.z - end.z); };
    const nearSide = dist(1) <= dist(-1) ? 1 : -1;
    const side = all.length >= 3 && this.opts.random() < this.opts.crossShare ? -nearSide : nearSide;
    return { edge, side, forward, crossing: false };
  }

  /** Crossing flag and height from the segment the person is on. */
  private locate(p: Ped): void {
    const leg = p.legs[segmentIndex(p.path, p.s)];
    p.crossing = leg?.crossing ?? false;
    const e = leg?.edge;
    if (!e) return;
    const a = this.graph.node(e.from); const b = this.graph.node(e.to);
    if (!a || !b) return;
    const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    p.y = a.y + (b.y - a.y) * t;
  }
}

export interface PedestriansOptions extends Partial<PedOptions> {
  /** Ground height under a point (world Y), when known; otherwise the height interpolated between nav nodes is used. */
  groundY?: (x: number, z: number) => number | undefined;
  zoneOf?: (tile: TileId) => string | undefined;
  /** How many of the people nearest the player are drawn as animated figures; the rest stay capsules. */
  figures?: number;
}

/** Capsule placeholder, 0.35 m wide and 1.7 m tall, for people without a figure. */
const BODY_RADIUS_M = 0.175;
const BODY_HEIGHT_M = 1.7;
const MAX_SUBSTEP_S = 0.05;
const TURN_RATE = 6; // rad/s
const COLOURS = Object.values(palette as Record<string, string>).filter((c) => c !== (palette as Record<string, string>).asphalt);

/**
 * Renders the pedestrian simulation: the people nearest the player as animated character figures (FigurePool), everyone
 * else as instanced capsules in palette colours.
 */
export class Pedestrians {
  readonly sim: PedSim;
  private mesh: THREE.InstancedMesh;
  private geo: THREE.CapsuleGeometry;
  private mat: THREE.MeshStandardNodeMaterial;
  private colours: THREE.Color[];
  private headings = new Map<number, number>();
  private groundY?: (x: number, z: number) => number | undefined;
  private figures: FigurePool;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private scene: THREE.Scene, graph: NavGraph, opts: PedestriansOptions = {}) {
    const { groundY, zoneOf, figures, ...simOpts } = opts;
    this.groundY = groundY;
    this.figures = new FigurePool(scene, figures ?? FIGURE_POOL_DEFAULT);
    this.sim = new PedSim(graph, simOpts, zoneOf);
    const max = Math.max(1, { ...PED_DEFAULTS, ...simOpts }.max);
    this.geo = new THREE.CapsuleGeometry(BODY_RADIUS_M, BODY_HEIGHT_M - 2 * BODY_RADIUS_M, 4, 8);
    this.mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, max);
    this.mesh.count = 0; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.mesh.name = 'pedestrians';
    this.colours = COLOURS.map((c) => new THREE.Color(c));
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, this.colours[0]!);
    scene.add(this.mesh);
  }

  get count(): number { return this.sim.peds.length; }

  setSpawnPoints(points: readonly XZ[]): void { this.sim.setSpawnPoints(points); }

  update(dt: number, player: XZ, cars: readonly PedCar[] = []): void {
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_S));
    for (let i = 0; i < n; i++) this.sim.step(dt / n, player, cars);
    const people: FigurePerson[] = this.sim.peds.map((a) => {
      const ground = this.groundY?.(a.x, a.z);
      const y = ground !== undefined && Number.isFinite(ground) ? ground : a.y;
      return { id: a.id, x: a.x, y, z: a.z, yaw: this.turn(a, dt), vx: a.vx, vz: a.vz, speed: a.speed, stopped: a.stopped };
    });
    const live = new Set(people.map((a) => a.id));
    for (const id of this.headings.keys()) if (!live.has(id)) this.headings.delete(id);
    this.figures.update(dt, people, player);
    // Capsules are compacted: only people without a figure take an instance slot.
    let k = 0;
    for (const a of people) {
      if (this.figures.has(a.id)) continue;
      this.q.setFromAxisAngle(this.up, a.yaw);
      this.p.set(a.x, a.y + BODY_HEIGHT_M / 2, a.z);
      this.mesh.setMatrixAt(k, this.m.compose(this.p, this.q, this.one));
      this.mesh.setColorAt(k, this.colours[a.id % this.colours.length]!);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Heading of a person, turned towards their velocity at most TURN_RATE rad/s. */
  private turn(a: Ped, dt: number): number {
    let yaw = this.headings.get(a.id) ?? Math.atan2(a.vx, a.vz);
    if (Math.hypot(a.vx, a.vz) > 0.2) {
      const want = Math.atan2(a.vx, a.vz);
      const d = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
      yaw += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * Math.max(dt, 1 / 60));
    }
    this.headings.set(a.id, yaw);
    return yaw;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose(); this.geo.dispose(); this.mat.dispose();
    this.figures.dispose();
  }
}
