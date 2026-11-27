import * as THREE from 'three/webgpu';
import type { TileMeta } from '@ktm/schema';
import buildingStyles from '../../../../world/style/building-styles.json';
import type { LoadedTile } from '../world/TileLoader.ts';

type ZoneId = TileMeta['zone'];

export type Ambience = 'market' | 'traffic' | 'wind';
export const AMBIENCES: readonly Ambience[] = ['market', 'traffic', 'wind'];
export type Weights = Record<Ambience, number>;

/** `_style` index of temple_brick in world/style/building-styles.json. */
export const TEMPLE_STYLE = buildingStyles.styles.indexOf('temple_brick');
export const BELL_RANGE_M = 80;
const AMBIENT_GAIN = 0.5;
const ENGINE_GAIN = 0.6;
const HORN_GAIN = 0.8;
const BELL_GAIN = 1;

export const AUDIO_FILES = {
  market: 'ambience-market.mp3', traffic: 'ambience-traffic.mp3', wind: 'ambience-wind.mp3',
  engine: 'engine-loop.mp3', horn: 'horn.mp3', bell: 'temple-bell.mp3',
} as const;
type Sound = keyof typeof AUDIO_FILES;

/** *-core zones play the market murmur, hills the wind; everything else (and no tile) the traffic hum. */
export function ambienceForZone(zone: ZoneId | undefined): Ambience {
  if (zone?.endsWith('-core')) return 'market';
  if (zone === 'hills') return 'wind';
  return 'traffic';
}

/** Move the bed weights linearly toward a one-hot `target` over `fadeS` seconds. The result always sums to 1. */
export function crossfadeWeights(current: Weights, target: Ambience, dt: number, fadeS = 2): Weights {
  const step = fadeS > 0 ? Math.max(0, dt) / fadeS : 1;
  const out = { market: 0, traffic: 0, wind: 0 };
  let total = 0;
  for (const a of AMBIENCES) {
    const v = Math.min(1, Math.max(0, Number.isFinite(current[a]) ? current[a] : 0));
    out[a] = a === target ? Math.min(1, v + step) : Math.max(0, v - step);
    total += out[a];
  }
  if (total <= 0) return { market: 0, traffic: 0, wind: 0, [target]: 1 };
  for (const a of AMBIENCES) out[a] /= total;
  return out;
}

/** Engine loop playback rate for a speed in m/s: 0.8 at idle, rising monotonically toward 2.0 (1.9 at 30 m/s). */
export function engineRate(speedMs: number): number {
  const s = Number.isFinite(speedMs) ? Math.abs(speedMs) : 0;
  return 0.8 + 1.2 * (1 - Math.exp(-s / 12));
}

/** Seconds until the next temple bell: uniform in [20, 40). */
export function nextBellDelay(rand: () => number = Math.random): number {
  return 20 + 20 * rand();
}

/** Centroids of the vertices with style `templeIndex`, one per `cellM` grid cell on XZ (positions xyz interleaved). */
export function templeCentroids(positions: ArrayLike<number>, styles: ArrayLike<number>, templeIndex = TEMPLE_STYLE, cellM = 20): { x: number; y: number; z: number }[] {
  const cells = new Map<string, { x: number; y: number; z: number; n: number }>();
  for (let i = 0; i < styles.length; i++) {
    if (Math.round(styles[i]!) !== templeIndex) continue;
    const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
    const key = `${Math.floor(x / cellM)},${Math.floor(z / cellM)}`;
    const c = cells.get(key);
    if (c) { c.x += x; c.y += y; c.z += z; c.n++; } else cells.set(key, { x, y, z, n: 1 });
  }
  return [...cells.values()].map((c) => ({ x: c.x / c.n, y: c.y / c.n, z: c.z / c.n }));
}

/** World-space bell sources for a loaded tile: temple_brick centroids of its building meshes. */
export function templeSourcesFromTile(tile: Pick<LoadedTile, 'buildings'>): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const mesh of tile.buildings ?? []) {
    const pos = mesh.geometry.getAttribute('position');
    const sty = mesh.geometry.getAttribute('_style');
    if (!pos || !sty) continue;
    mesh.updateWorldMatrix(true, false);
    // glb buffers are often strided (InterleavedBufferAttribute), so read through the accessors, not `.array`.
    const n = Math.min(pos.count, sty.count);
    const p = new Float32Array(n * 3); const s = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = pos.getX(i); p[i * 3 + 1] = pos.getY(i); p[i * 3 + 2] = pos.getZ(i); s[i] = sty.getX(i); }
    for (const c of templeCentroids(p, s)) out.push(new THREE.Vector3(c.x, c.y, c.z).applyMatrix4(mesh.matrixWorld));
  }
  return out;
}

/** Bell sources of the loaded tiles, computed once per tile and dropped when the tile unloads. */
export class TempleSources {
  private byTile = new Map<string, THREE.Vector3[]>();
  all: THREE.Vector3[] = [];

  sync(tiles: Iterable<{ id: string; buildings?: THREE.Mesh[] | undefined }>): void {
    const seen = new Set<string>();
    let changed = false;
    for (const t of tiles) {
      if (!t.buildings) continue;
      seen.add(t.id);
      if (!this.byTile.has(t.id)) { this.byTile.set(t.id, templeSourcesFromTile(t)); changed = true; }
    }
    for (const id of this.byTile.keys()) if (!seen.has(id)) { this.byTile.delete(id); changed = true; }
    if (changed) this.all = [...this.byTile.values()].flat();
  }
}

/** Nearest source within `maxM` of `p`, if any. */
export function nearestSource(p: { x: number; y: number; z: number }, sources: readonly THREE.Vector3[], maxM = BELL_RANGE_M): THREE.Vector3 | undefined {
  let best: THREE.Vector3 | undefined; let bestD = maxM * maxM;
  for (const s of sources) {
    const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
    if (d <= bestD) { bestD = d; best = s; }
  }
  return best;
}

export interface AudioFrame { position: THREE.Vector3; zone: ZoneId | undefined; driving: boolean; speedMs: number; temples: readonly THREE.Vector3[]; horn: boolean }
export interface AudioState { started: boolean; muted: boolean; loaded: number; ambience: Ambience; weights: Weights; bellIn: number; bells: number }

/** Ambience beds, engine loop, horn and a positional temple bell. Silent until start() (first user gesture). */
export class GameAudio {
  readonly listener: THREE.AudioListener;
  private beds = new Map<Ambience, THREE.Audio>();
  private engine?: THREE.Audio;
  private horn?: THREE.Audio;
  private bell?: THREE.PositionalAudio;
  private bellAnchor = new THREE.Object3D();
  private starting?: Promise<void>;
  private _state: AudioState = { started: false, muted: false, loaded: 0, ambience: 'traffic', weights: { market: 0, traffic: 1, wind: 0 }, bellIn: nextBellDelay(), bells: 0 };

  constructor(camera: THREE.Object3D, scene: THREE.Scene, private base = '/audio/') {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.bellAnchor.name = 'temple-bell';
    scene.add(this.bellAnchor);
  }

  get state(): AudioState { return this._state; }

  /** Start on the first pointer or key press (browsers keep an AudioContext suspended until a gesture). */
  armOnGesture(target: EventTarget = window): void {
    const go = () => { target.removeEventListener('pointerdown', go); target.removeEventListener('keydown', go); void this.start(); };
    target.addEventListener('pointerdown', go);
    target.addEventListener('keydown', go);
  }

  start(): Promise<void> {
    this.starting ??= this.load();
    return this.starting;
  }

  toggleMute(): boolean {
    this._state.muted = !this._state.muted;
    this.listener.setMasterVolume(this._state.muted ? 0 : 1);
    return this._state.muted;
  }

  private async load(): Promise<void> {
    await this.listener.context.resume();
    const loader = new THREE.AudioLoader();
    const buffers = new Map<Sound, AudioBuffer>();
    await Promise.all((Object.keys(AUDIO_FILES) as Sound[]).map(async (k) => {
      try { buffers.set(k, await loader.loadAsync(this.base + AUDIO_FILES[k])); } catch (e) { console.warn(`audio ${AUDIO_FILES[k]}: ${e instanceof Error ? e.message : String(e)}`); }
    }));
    this._state.loaded = buffers.size;
    const loop = (b: AudioBuffer | undefined, volume: number) => {
      if (!b) return undefined;
      const a = new THREE.Audio(this.listener);
      a.setBuffer(b); a.setLoop(true); a.setVolume(volume); a.play();
      return a;
    };
    for (const a of AMBIENCES) { const s = loop(buffers.get(a), this._state.weights[a] * AMBIENT_GAIN); if (s) this.beds.set(a, s); }
    this.engine = loop(buffers.get('engine'), 0);
    const horn = buffers.get('horn');
    if (horn) { this.horn = new THREE.Audio(this.listener); this.horn.setBuffer(horn); this.horn.setVolume(HORN_GAIN); }
    const bell = buffers.get('bell');
    if (bell) {
      this.bell = new THREE.PositionalAudio(this.listener);
      this.bell.setBuffer(bell); this.bell.setVolume(BELL_GAIN);
      this.bell.setDistanceModel('linear'); this.bell.setRefDistance(10); this.bell.setMaxDistance(BELL_RANGE_M); this.bell.setRolloffFactor(1);
      this.bellAnchor.add(this.bell);
    }
    this._state.started = true;
  }

  update(dt: number, f: AudioFrame): void {
    const s = this._state;
    s.ambience = ambienceForZone(f.zone);
    s.weights = crossfadeWeights(s.weights, s.ambience, dt);
    if (!s.started) return;
    for (const [a, bed] of this.beds) bed.setVolume(s.weights[a] * AMBIENT_GAIN);
    if (this.engine) {
      this.engine.setVolume(f.driving ? ENGINE_GAIN : 0);
      this.engine.setPlaybackRate(engineRate(f.driving ? f.speedMs : 0));
    }
    if (f.horn && f.driving && this.horn) { if (this.horn.isPlaying) this.horn.stop(); this.horn.play(); }
    s.bellIn -= dt;
    if (s.bellIn <= 0) {
      s.bellIn = nextBellDelay();
      const src = nearestSource(f.position, f.temples);
      if (src && this.bell) {
        this.bellAnchor.position.copy(src);
        this.bellAnchor.updateMatrixWorld();
        if (this.bell.isPlaying) this.bell.stop();
        this.bell.play();
        s.bells++;
      }
    }
  }
}
