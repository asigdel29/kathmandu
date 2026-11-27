import * as THREE from 'three/webgpu';
import { BASE_ELEVATION_M, inGrid, lonLatToLocal, TILE_SIZE_M, tileId, tileIndexAt, tileOrigin } from '@ktm/geo';
import { VehicleTunings, type VehicleType } from '@ktm/schema';
import vehiclesJson from '../../../world/vehicles.json';
import { GameAudio, TempleSources, type AudioState } from './audio/Audio.ts';
import { FollowCamera } from './camera/FollowCamera.ts';
import { readConfig } from './config.ts';
import { Input } from './input/Input.ts';
import { createFacadeMaterial, createNightUniform } from './materials/facade.ts';
import { uniform } from 'three/tsl';
import { Physics } from './physics/Physics.ts';
import { Character } from './player/Character.ts';
import { IdleTracker, wetness } from './post/quality.ts';
import { createRenderer } from './renderer.ts';
import { Hud } from './ui/Hud.ts';
import { fallbackSpawns, fixedSteps, nearestWithin, propSpawns, yawTowards } from './vehicles/Garage.ts';
import { msToKmh, Vehicle } from './vehicles/Vehicle.ts';
import { Clock, nightAmount } from './world/Clock.ts';
import { HeroLoader, heroSpawn } from './world/HeroLoader.ts';
import { loadManifest } from './world/manifest.ts';
import { PropsRenderer } from './world/PropsRenderer.ts';
import { Sky } from './world/Sky.ts';
import { StreetLights } from './world/StreetLights.ts';
import { TileLoader } from './world/TileLoader.ts';
import { TileStreamer } from './world/TileStreamer.ts';
import { NavGraph } from './traffic/NavGraph.ts';
import { Traffic } from './traffic/Traffic.ts';

interface KtmDebug { speed: number; speedKmh: number; driving: VehicleType | null; vehicles: number; trafficCount: number; audio?: AudioState; temples: number }
declare global { interface Window { __ktmReady?: boolean; __ktm?: unknown; __ktmDebug?: KtmDebug } }

const STEP = 1 / 60;
// The 0.25 s frame clamp is the binding limit: 15 steps, so frame rates down to 4 fps still simulate in real time.
const MAX_STEPS = 15;
// `autodrive=1` is for headless test runs, where a software renderer can drop to ~1 fps; allow up to 1.5 s per frame there.
const AUTODRIVE_MAX_FRAME_S = 1.5;
const WARM_FRAME_MS = 1000;
const ENTER_RADIUS_M = 3;
const AUTODRIVE_S = 5;
const CAPSULE_LIFT_M = 1.2;
const LOST_BELOW_Y = -500;

async function main(): Promise<void> {
  const config = readConfig(location.search, import.meta.env.VITE_WORLD_BASE_URL ?? '/world/');
  const manifest = await loadManifest(config.worldBase);
  const tunings = VehicleTunings.parse(vehiclesJson);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xd9c7a8, 0.00012);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 20000);
  const night = createNightUniform();
  const { renderer, post } = await createRenderer(scene, camera, night, { quality: config.quality, taa: config.taa });
  document.body.appendChild(renderer.domElement);

  const sky = new Sky(scene, renderer, config.timeOfDay);
  const physics = await Physics.create();
  const clock = new Clock(config.timeOfDay, { frozen: config.freeze });
  night.value = nightAmount(clock.time);
  const wet = uniform(wetness(config.wet, night.value));
  const facade = createFacadeMaterial(night);
  const loader = new TileLoader(config.worldBase, manifest, facade, wet);
  const props = new PropsRenderer(scene, night);
  const streetLights = new StreetLights(scene, () => props.lamps());
  const streamer = new TileStreamer(scene, physics, props, loader);
  const heroes = new HeroLoader(scene, config.worldBase, manifest, (x, z) => streamer.heightAt(x, z));
  const target = config.hero ? manifest.heroes[config.hero] : undefined;
  if (config.hero && !target) console.warn(`hero ${config.hero}: not in manifest`);

  const o = tileOrigin(config.tile);
  const centre = new THREE.Vector3(o.x + TILE_SIZE_M / 2, 0, o.z + TILE_SIZE_M / 2);
  // A hero target overrides tile centre and spawn: start just south of its anchor, facing it.
  const spawn = target ? heroSpawn(target) : config.spawn;
  const start = new THREE.Vector3(spawn?.x ?? centre.x, 200, spawn?.z ?? centre.z);
  const player = new Character(scene, physics, start);
  const input = new Input(renderer.domElement);
  const follow = new FollowCamera(camera, config.view);
  const hud = new Hud(document.getElementById('hud')!);
  const debug: KtmDebug = { speed: 0, speedKmh: 0, driving: null, vehicles: 0, trafficCount: 0, temples: 0 };
  window.__ktmDebug = debug;
  // Sound stays silent until the first key or pointer press (browser autoplay rule).
  const audio = new GameAudio(camera, scene, `${import.meta.env.BASE_URL}audio/`);
  audio.armOnGesture();
  debug.audio = audio.state;
  const temples = new TempleSources();

  await streamer.update(start, true);
  // Without an explicit spawn, start on the street node nearest the tile centre rather than inside a block.
  // The street view then looks down the longest road leaving that node.
  const anchor = target ? lonLatToLocal(target.lon, target.lat) : undefined;
  const lookAt = anchor ? new THREE.Vector3(anchor.x, 0, anchor.z) : centre.clone();
  const nav = streamer.loaded().get(config.tile)?.nav;
  if (!spawn && nav) {
    let best = Infinity; let startId = '';
    for (const n of nav.nodes) {
      const d = (o.x + n.x - centre.x) ** 2 + (o.z + n.z - centre.z) ** 2;
      if (d < best) { best = d; startId = n.id; start.x = o.x + n.x; start.z = o.z + n.z; }
    }
    const byId = new Map(nav.nodes.map((n) => [n.id, n]));
    let longest = 0;
    for (const e of nav.edges) {
      const other = e.from === startId ? e.to : e.to === startId ? e.from : undefined;
      const n = other ? byId.get(other) : undefined;
      if (!n) continue;
      const d = (o.x + n.x - start.x) ** 2 + (o.z + n.z - start.z) ** 2;
      if (d > longest) { longest = d; lookAt.set(o.x + n.x, 0, o.z + n.z); }
    }
  }
  const groundY = (x: number, z: number) => (streamer.heightAt(x, z) ?? BASE_ELEVATION_M) - BASE_ELEVATION_M;

  // Ambient traffic drives the nav graph stitched from the lod-0 tiles; it is re-synced with the streamer every frame.
  const graph = new NavGraph();
  const navTiles = () => [...streamer.loaded().values()].filter((t) => t.lod === 0);
  graph.sync(navTiles());
  const traffic = config.traffic
    ? new Traffic(scene, physics, graph, tunings.vehicles, { groundY: (x, z) => { const h = streamer.heightAt(x, z); return h === undefined ? undefined : h - BASE_ELEVATION_M; } })
    : undefined;
  traffic?.update(0, start);

  // Parked vehicles at the taxi_spawn props of the loaded lod-0 tiles, else one of each type near the spawn.
  const vehicles: Vehicle[] = [];
  const spawnTiles = [...streamer.loaded().values()].flatMap((t) => (t.lod === 0 && t.props ? [{ origin: tileOrigin(t.id), props: t.props.props }] : []));
  const spawns = propSpawns(spawnTiles, start);
  for (const s of spawns.length > 0 ? spawns : fallbackSpawns(start, lookAt)) {
    vehicles.push(new Vehicle(scene, physics, s.type, tunings.vehicles[s.type], new THREE.Vector3(s.x, groundY(s.x, s.z), s.z), s.yaw));
  }

  let driving: Vehicle | null = null;
  const enter = (v: Vehicle) => {
    driving = v; v.occupied = true;
    player.setActive(false);
    follow.setMode('drive');
  };
  const exit = (v: Vehicle) => {
    const p = v.exitPoint();
    v.occupied = false; driving = null;
    player.teleport(p.x, p.y + CAPSULE_LIFT_M, p.z);
    player.heading = v.yaw;
    player.setActive(true);
    follow.setMode('foot', v.yaw);
  };
  if (config.vehicle) {
    const v = new Vehicle(scene, physics, config.vehicle, tunings.vehicles[config.vehicle], new THREE.Vector3(start.x, groundY(start.x, start.z), start.z), yawTowards(start, lookAt));
    vehicles.push(v);
    enter(v);
  }

  const zero = { throttle: 0, steer: 0, handbrake: false };
  for (const v of vehicles) v.controls(zero, STEP);
  physics.step(STEP); // registers the new colliders with scene queries
  player.teleport(start.x, groundY(start.x, start.z) + CAPSULE_LIFT_M, start.z);
  for (const v of vehicles) v.syncVisual(STEP);
  debug.vehicles = vehicles.length;
  debug.driving = config.vehicle ?? null;
  await heroes.update(streamer.loaded());
  debug.trafficCount = traffic?.count ?? 0;
  window.__ktm = { physics, streamer, heroes, player, sky, scene, camera, clock, night, vehicles, graph, traffic, audio, temples, streetLights, post };
  streetLights.update(1, start, night.value); // lamps on before the first render, so the lit pipelines are compiled in the warm-up
  // Warm-up: render until the frame time settles (pipeline compiles and temporal history allocation happen in
  // the first frames) before reporting ready, so the first driven frames are not one long stall.
  follow.update(0, config.vehicle ? vehicles[vehicles.length - 1]!.group.position : player.position, input, lookAt, yawTowards(start, lookAt));
  let prevFrame = performance.now();
  for (let i = 0; i < 12; i++) {
    post.render();
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now(); const took = now - prevFrame; prevFrame = now;
    if (i >= 2 && took < WARM_FRAME_MS) break;
  }
  post.warm(); // compile the depth-of-field and driving-blur variants now rather than mid-play
  window.__ktmReady = true;

  let autodriveLeft = config.autodrive ? AUTODRIVE_S : 0;
  input.autodrive = autodriveLeft > 0;
  let acc = 0;
  let last = performance.now();
  const focus = new THREE.Vector3();
  const idle = new IdleTracker();
  const prevFocus = new THREE.Vector3().copy(start);
  const prevCamQ = new THREE.Quaternion();
  const frame = (now: number) => {
    // Physics runs in fixed steps; the clock follows wall time so slow frames do not slow the day.
    const frameDt = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(frameDt, 0.05);
    let steps = 0;
    if (!config.freeze) {
      ({ steps, acc } = config.autodrive
        ? fixedSteps(acc, frameDt, STEP, Math.ceil(AUTODRIVE_MAX_FRAME_S / STEP), AUTODRIVE_MAX_FRAME_S)
        : fixedSteps(acc, frameDt, STEP, MAX_STEPS));
      if (steps > 0 && input.interactPressed) {
        if (driving) exit(driving);
        else { const v = nearestWithin(player.position, vehicles, ENTER_RADIUS_M); if (v) enter(v); }
      }
      for (let i = 0; i < steps; i++) {
        if (autodriveLeft > 0) { autodriveLeft -= STEP; input.autodrive = autodriveLeft > 0; }
        const axes = input.driveAxes();
        // Every vehicle needs its controller updated each step; unoccupied ones ignore the input and hold the handbrake.
        for (const v of vehicles) v.controls(axes, STEP);
        if (!driving) player.update(STEP, input, camera);
        physics.step(STEP);
      }
      for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i]!;
        v.syncVisual(dt);
        // A parked vehicle whose tile streamed out has nothing under it; drop it once it has fallen away.
        if (!v.occupied && v.group.position.y < LOST_BELOW_Y) { v.dispose(); vehicles.splice(i, 1); }
      }
      if (traffic) {
        // Kinematic targets set here are reached by the colliders during the next frame's physics steps.
        graph.sync(navTiles());
        const at: Vehicle | null = driving;
        traffic.update(steps * STEP, at ? at.group.position : player.position);
      }
    }
    const car: Vehicle | null = driving;
    if (car) focus.copy(car.group.position); else focus.copy(player.position);
    follow.update(dt, focus, input, lookAt, car ? car.yaw : 0);
    if (input.pausePressed) clock.togglePause();
    clock.advance(frameDt);
    sky.setTime(clock.time);
    night.value = nightAmount(clock.time);
    wet.value = wetness(config.wet, night.value);
    sky.update(focus);
    streetLights.update(frameDt, focus, night.value);
    void streamer.update(focus);
    void heroes.update(streamer.loaded());
    const speed = car ? Math.abs(car.speedMs) : 0;
    debug.speed = speed; debug.speedKmh = msToKmh(speed); debug.driving = car ? car.type : null; debug.vehicles = vehicles.length;
    debug.trafficCount = traffic?.count ?? 0;
    if (input.mutePressed) audio.toggleMute();
    temples.sync(streamer.loaded().values());
    const at = tileIndexAt(focus.x, focus.z);
    const zone = inGrid(at.i, at.j) ? manifest.tiles[tileId(at.i, at.j)]?.zone : undefined;
    audio.update(dt, { position: focus, zone, driving: car !== null, speedMs: speed, temples: temples.all, horn: input.hornPressed });
    debug.audio = audio.state; debug.temples = temples.all.length;
    hud.update(dt, focus, clock.time, clock.paused, car ? msToKmh(car.speedMs) : undefined, traffic?.count);
    // Idle = the player and the camera are both still (depth of field fades in after 3 s of that).
    const moving = focus.distanceTo(prevFocus) > 0.05 * Math.max(frameDt, 1e-3) || camera.quaternion.angleTo(prevCamQ) > 1e-4 || input.lookDelta.x !== 0 || input.lookDelta.y !== 0;
    idle.update(frameDt, moving);
    prevFocus.copy(focus); prevCamQ.copy(camera.quaternion);
    input.endFrame(!config.freeze && steps === 0);
    post.update({ focusDistance: camera.position.distanceTo(focus), idleSeconds: idle.seconds, driving: car !== null, speedKmh: car ? msToKmh(speed) : 0, followCamera: config.view === 'follow', night: night.value }, frameDt * 1000);
    post.render();
  };
  renderer.setAnimationLoop(frame);
}

main().catch((e: unknown) => {
  document.getElementById('hud')!.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  throw e;
});
