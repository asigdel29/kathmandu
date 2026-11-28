import * as THREE from 'three/webgpu';
import { BASE_ELEVATION_M, inGrid, lonLatToLocal, TILE_SIZE_M, tileId, tileIndexAt, tileOrigin } from '@ktm/geo';
import { VehicleTunings, type VehicleType } from '@ktm/schema';
import vehiclesJson from '../../../world/vehicles.json';
import heroesJson from '../../../world/heroes/heroes.json';
import { GameAudio, TempleSources, type AudioState } from './audio/Audio.ts';
import { FollowCamera } from './camera/FollowCamera.ts';
import { readConfig } from './config.ts';
import { Input } from './input/Input.ts';
import { MapScreen } from './map/MapScreen.ts';
import { Minimap } from './map/Minimap.ts';
import { headingFromDirection, type XZ } from './map/projection.ts';
import { Waypoint } from './map/waypoint.ts';
import { MISSIONS } from './missions/catalog.ts';
import { resolveDebugMission } from './missions/debug.ts';
import { Markers } from './missions/Markers.ts';
import { MissionSystem } from './missions/MissionSystem.ts';
import { createFacadeMaterial, createNightUniform } from './materials/facade.ts';
import { uniform } from 'three/tsl';
import { Physics } from './physics/Physics.ts';
import { Character, seatOffset } from './player/Character.ts';
import { IdleTracker, wetness } from './post/quality.ts';
import { createRenderer } from './renderer.ts';
import { loadResume, type SaveData, type SaveStorage, startAutosave } from './state/Save.ts';
import { Hud, relativeBearing } from './ui/Hud.ts';
import { fallbackSpawns, fixedSteps, nearestWithin, propSpawns, yawTowards } from './vehicles/Garage.ts';
import { msToKmh, Vehicle } from './vehicles/Vehicle.ts';
import { createVehicleMaterial, loadVehicleModels, type VehicleSkins } from './vehicles/models.ts';
import { Clock, nightAmount } from './world/Clock.ts';
import { HeroLoader, heroSpawn } from './world/HeroLoader.ts';
import { loadManifest } from './world/manifest.ts';
import { PropsRenderer } from './world/PropsRenderer.ts';
import { Sky } from './world/Sky.ts';
import { StreetLights } from './world/StreetLights.ts';
import { TileLoader, createSurfaceMaterials } from './world/TileLoader.ts';
import { TileStreamer } from './world/TileStreamer.ts';
import { NavGraph } from './traffic/NavGraph.ts';
import { Traffic } from './traffic/Traffic.ts';
import { Pedestrians, type PedCar } from './people/Pedestrians.ts';

interface KtmDebug {
  speed: number; speedKmh: number; driving: VehicleType | null; vehicles: number; trafficCount: number; audio?: AudioState; temples: number; pedCount: number;
  /** The accepted mission (null when none): status and current step index (steps.length once done). */
  mission: { id: string; status: string; step: number; markers: number } | null;
   mapOpen: boolean; waypoint: XZ | null;
}
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
const MINIMAP_INTERVAL_S = 1 / 15;
const RESUME_LOOK_M = 20;

/** localStorage, or an inert stand-in where the browser denies access to it. */
function saveStorage(): SaveStorage {
  try { return window.localStorage; } catch { return { getItem: () => null, setItem: () => {}, removeItem: () => {} }; }
}

async function main(): Promise<void> {
  const debugMission = resolveDebugMission(readConfig(location.search, import.meta.env.VITE_WORLD_BASE_URL ?? '/world/'), MISSIONS);
  if (debugMission.warning) console.warn(debugMission.warning);
  const config = debugMission.config;
  // The last session's position, time and vehicle, except where the URL names them explicitly.
  const storage = saveStorage();
  const resume = loadResume(storage, location.search);
  const timeOfDay = resume.timeOfDay ?? config.timeOfDay;
  const startVehicle = config.vehicle ?? resume.vehicle;
  const manifest = await loadManifest(config.worldBase);
  const tunings = VehicleTunings.parse(vehiclesJson);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xd9c7a8, 0.00012);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 20000);
  const night = createNightUniform();
  const { renderer, post } = await createRenderer(scene, camera, night, { quality: config.quality, taa: config.taa });
  document.body.appendChild(renderer.domElement);

  const sky = new Sky(scene, renderer, timeOfDay);
  const physics = await Physics.create();
  const clock = new Clock(timeOfDay, { frozen: config.freeze });
  night.value = nightAmount(clock.time);
  const wet = uniform(wetness(config.wet, night.value));
  const facade = createFacadeMaterial(night);
  // Baked vehicle models (public/models/vehicles/<type>.glb); a type without one keeps its box.
  const skins: VehicleSkins = { models: await loadVehicleModels(`${import.meta.env.BASE_URL}models/vehicles/`), material: createVehicleMaterial(night) };
  const loader = new TileLoader(config.worldBase, manifest, facade, createSurfaceMaterials(`${import.meta.env.BASE_URL}textures/`, wet));
  const props = new PropsRenderer(scene, night);
  const streetLights = new StreetLights(scene, () => props.lamps());
  const streamer = new TileStreamer(scene, physics, props, loader);
  const heroes = new HeroLoader(scene, config.worldBase, manifest, (x, z) => streamer.heightAt(x, z));
  const target = config.hero ? manifest.heroes[config.hero] : undefined;
  if (config.hero && !target) console.warn(`hero ${config.hero}: not in manifest`);

  const o = tileOrigin(config.tile);
  const centre = new THREE.Vector3(o.x + TILE_SIZE_M / 2, 0, o.z + TILE_SIZE_M / 2);
  // A hero target overrides tile centre and spawn: start just south of its anchor, facing it.
  const spawn = target ? heroSpawn(target) : config.spawn ?? resume.position;
  const start = new THREE.Vector3(spawn?.x ?? centre.x, 200, spawn?.z ?? centre.z);
  const player = new Character(scene, physics, start);
  const input = new Input(renderer.domElement);
  const follow = new FollowCamera(camera, config.view);
  const hud = new Hud(document.getElementById('hud')!);
  const missionEl = document.getElementById('mission')!;
  const missionListEl = document.getElementById('missions')!;
  const markers = new Markers(scene);
  // The minimap and full map show the same mission targets as the in-world markers.
  const missionMarkers: XZ[] = [];
  const missions = new MissionSystem(MISSIONS, {
    set(targets) { markers.set(targets); missionMarkers.length = 0; for (const t of targets) missionMarkers.push({ x: t.x, z: t.z }); },
  });
  const debug: KtmDebug = { speed: 0, speedKmh: 0, driving: null, vehicles: 0, trafficCount: 0, temples: 0, pedCount: 0, mission: null, mapOpen: false, waypoint: null };
  window.__ktmDebug = debug;
  // Sound stays silent until the first key or pointer press (browser autoplay rule).
  const audio = new GameAudio(camera, scene, `${import.meta.env.BASE_URL}audio/`);
  audio.armOnGesture();
  debug.audio = audio.state;
  const temples = new TempleSources();
  // Minimap and full map.
  const waypoint = new Waypoint();
  const minimap = new Minimap(document.body);
  const mapScreen = new MapScreen(document.body, manifest, heroesJson, (p) => { if (p) waypoint.set(p.x, p.z); else waypoint.clear(); });

  await streamer.update(start, true);
  // Without an explicit spawn, start on the street node nearest the tile centre rather than inside a block.
  // The street view then looks down the longest road leaving that node.
  const anchor = target ? lonLatToLocal(target.lon, target.lat) : undefined;
  const lookAt = anchor ? new THREE.Vector3(anchor.x, 0, anchor.z) : centre.clone();
  // A resumed session faces the way it was facing when saved.
  if (!target && !config.spawn && resume.position) {
    const h = resume.position.heading;
    lookAt.set(start.x + Math.sin(h) * RESUME_LOOK_M, 0, start.z + Math.cos(h) * RESUME_LOOK_M);
    player.heading = h;
    follow.yaw = h + Math.PI; // on foot the orbit camera starts behind the player
  }
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
  // A fresh start on foot faces down the street, with the orbit camera behind the character.
  if (!target && !resume.position && !debugMission.lookAt && !config.vehicle) {
    player.heading = yawTowards(start, lookAt);
    follow.yaw = player.heading + Math.PI;
  }
  if (debugMission.lookAt && !target) lookAt.set(debugMission.lookAt.x, 0, debugMission.lookAt.z);
  if (debugMission.lookAt && !target && !config.vehicle) {
    // On foot, face the first mission target so its marker is in view.
    player.heading = yawTowards(start, lookAt);
    follow.yaw = player.heading + Math.PI;
  }

  // Ambient traffic drives the nav graph stitched from the lod-0 tiles; it is re-synced with the streamer every frame.
  const graph = new NavGraph();
  const navTiles = () => [...streamer.loaded().values()].filter((t) => t.lod === 0);
  graph.sync(navTiles());
  const traffic = config.traffic
    ? new Traffic(scene, physics, graph, tunings.vehicles, { skins, groundY: (x, z) => { const h = streamer.heightAt(x, z); return h === undefined ? undefined : h - BASE_ELEVATION_M; } })
    : undefined;
  traffic?.update(0, start);

  // Pedestrians walk the same graph (road edges and foot-class edges), denser in `*-core` zones, and start at ped_spawn props.
  const terrainY = (x: number, z: number) => { const h = streamer.heightAt(x, z); return h === undefined ? undefined : h - BASE_ELEVATION_M; };
  const peds = config.peds
    ? new Pedestrians(scene, graph, { groundY: terrainY, zoneOf: (id) => streamer.loaded().get(id)?.meta.zone })
    : undefined;
  let pedSpawnVersion = -1;
  const syncPedSpawns = () => {
    if (!peds || pedSpawnVersion === graph.version) return;
    pedSpawnVersion = graph.version;
    peds.setSpawnPoints(navTiles().flatMap((t) => {
      const to = tileOrigin(t.id);
      return (t.props?.props ?? []).filter((p) => p.type === 'ped_spawn').map((p) => ({ x: to.x + p.x, z: to.z + p.z }));
    }));
  };
  syncPedSpawns();
  peds?.update(0, start);

  // Parked vehicles at the taxi_spawn props of the loaded lod-0 tiles, else one of each type near the spawn.
  const vehicles: Vehicle[] = [];
  const spawnTiles = [...streamer.loaded().values()].flatMap((t) => (t.lod === 0 && t.props ? [{ origin: tileOrigin(t.id), props: t.props.props }] : []));
  const spawns = propSpawns(spawnTiles, start);
  for (const s of spawns.length > 0 ? spawns : fallbackSpawns(start, lookAt)) {
    vehicles.push(new Vehicle(scene, physics, s.type, tunings.vehicles[s.type], new THREE.Vector3(s.x, groundY(s.x, s.z), s.z), s.yaw, skins));
  }

  let driving: Vehicle | null = null;
  const enter = (v: Vehicle) => {
    driving = v; v.occupied = true;
    player.setActive(false);
    player.setDriving(v.group, seatOffset(v.type));
    follow.setMode('drive');
  };
  const exit = (v: Vehicle) => {
    const p = v.exitPoint();
    v.occupied = false; driving = null;
    player.setDriving(null);
    player.teleport(p.x, p.y + CAPSULE_LIFT_M, p.z);
    player.heading = v.yaw;
    player.setActive(true);
    follow.setMode('foot', v.yaw);
  };
  if (startVehicle) {
    const v = new Vehicle(scene, physics, startVehicle, tunings.vehicles[startVehicle], new THREE.Vector3(start.x, groundY(start.x, start.z), start.z), yawTowards(start, lookAt), skins);
    vehicles.push(v);
    enter(v);
  }

  const zero = { throttle: 0, steer: 0, handbrake: false };
  for (const v of vehicles) v.controls(zero, STEP);
  physics.step(STEP); // registers the new colliders with scene queries
  player.teleport(start.x, groundY(start.x, start.z) + CAPSULE_LIFT_M, start.z);
  for (const v of vehicles) v.syncVisual(STEP);
  debug.vehicles = vehicles.length;
  debug.driving = startVehicle ?? null;
  await heroes.update(streamer.loaded());
  debug.trafficCount = traffic?.count ?? 0;
  debug.pedCount = peds?.count ?? 0;
  window.__ktm = { follow, lookAt, physics, streamer, heroes, player, sky, scene, camera, clock, night, vehicles, graph, traffic, audio, temples, streetLights, post, peds, missions, markers, minimap, mapScreen, waypoint, missionMarkers };
  streetLights.update(1, start, night.value); // lamps on before the first render, so the lit pipelines are compiled in the warm-up
  await facade.userData.texturesReady;
  // Warm-up: render until the frame time settles (pipeline compiles and temporal history allocation happen in
  // the first frames) before reporting ready, so the first driven frames are not one long stall.
  follow.update(0, startVehicle ? vehicles[vehicles.length - 1]!.group.position : player.position, input, lookAt, yawTowards(start, lookAt));
  let prevFrame = performance.now();
  for (let i = 0; i < 12; i++) {
    post.render();
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now(); const took = now - prevFrame; prevFrame = now;
    if (i >= 2 && took < WARM_FRAME_MS) break;
  }
  post.warm(); // compile the depth-of-field and driving-blur variants now rather than mid-play
  if (debugMission.mission) missions.accept(debugMission.mission.id);
  window.__ktmReady = true;

  // Autosave every few seconds and whenever the tab is hidden or shown again.
  const snapshot = (): SaveData => {
    const car: Vehicle | null = driving;
    const p = car ? car.group.position : player.position;
    return { version: 1, x: p.x, y: p.y, z: p.z, heading: car ? car.yaw : player.heading, timeOfDay: clock.time, vehicle: car ? car.type : null, savedAt: Date.now() };
  };
  startAutosave({ storage, snapshot, target: document });

  let autodriveLeft = config.autodrive ? AUTODRIVE_S : 0;
  input.autodrive = autodriveLeft > 0;
  let acc = 0;
  let last = performance.now();
  const focus = new THREE.Vector3();
  const look = new THREE.Vector3();
  let minimapAcc = MINIMAP_INTERVAL_S;
  const idle = new IdleTracker();
  const prevFocus = new THREE.Vector3().copy(start);
  const prevCamQ = new THREE.Quaternion();
  const frame = (now: number) => {
    // Physics runs in fixed steps; the clock follows wall time so slow frames do not slow the day.
    const frameDt = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(frameDt, 0.05);
    // The nav graph follows the streamer; traffic and the maps read it.
    graph.sync(navTiles());
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
        player.update(STEP, input, camera); // while driving this only ticks the seated pose
        physics.step(STEP);
      }
      for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i]!;
        v.syncVisual(dt);
        // A parked vehicle whose tile streamed out has nothing under it; drop it once it has fallen away.
        if (!v.occupied && v.group.position.y < LOST_BELOW_Y) { v.dispose(); vehicles.splice(i, 1); }
      }
      if (traffic || peds) graph.sync(navTiles());
      const at: Vehicle | null = driving;
      const focusPos = at ? at.group.position : player.position;
      if (traffic) {
        // Kinematic targets set here are reached by the colliders during the next frame's physics steps.
        traffic.update(steps * STEP, focusPos);
      }
      if (peds) {
        syncPedSpawns();
        // People wait for ambient traffic and for any drivable vehicle that is moving.
        const cars: PedCar[] = traffic ? traffic.sim.cars.map((c) => ({ x: c.x, z: c.z, yaw: c.yaw, length: c.length, width: c.width, v: c.v })) : [];
        for (const v of vehicles) {
          const sp = Math.abs(v.speedMs);
          if (sp < 0.5) continue;
          const p = v.group.position;
          cars.push({ x: p.x, z: p.z, yaw: v.speedMs >= 0 ? v.yaw : v.yaw + Math.PI, length: v.tuning.length, width: v.tuning.width, v: sp });
        }
        peds.update(steps * STEP, focusPos, cars);
      }
    } else if (peds) {
      // A frozen scene still hands the people their figures once the models have loaded.
      peds.update(0, player.position);
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
    debug.pedCount = peds?.count ?? 0;
    if (input.mutePressed) audio.toggleMute();
    temples.sync(streamer.loaded().values());
    const at = tileIndexAt(focus.x, focus.z);
    const zone = inGrid(at.i, at.j) ? manifest.tiles[tileId(at.i, at.j)]?.zone : undefined;
    audio.update(dt, { position: focus, zone, driving: car !== null, speedMs: speed, temples: temples.all, horn: input.hornPressed });
    debug.audio = audio.state; debug.temples = temples.all.length;
    hud.update(dt, focus, clock.time, clock.paused, car ? msToKmh(car.speedMs) : undefined, traffic?.count);
    if (input.mapPressed && mapScreen.toggle(focus.x, focus.z)) input.releasePointer();
    const yaw = car ? car.yaw : player.heading;
    const headingDeg = headingFromDirection(Math.sin(yaw), Math.cos(yaw));
    const info = waypoint.update(focus.x, focus.z);
    camera.getWorldDirection(look);
    hud.setWaypoint(info && { distance: info.distance, relDeg: relativeBearing(info.bearing, headingFromDirection(look.x, look.z)) });
    minimapAcc += frameDt;
    if (minimapAcc >= MINIMAP_INTERVAL_S) {
      minimapAcc = 0;
      minimap.draw({ x: focus.x, z: focus.z, headingDeg, graph, traffic: traffic?.sim.cars ?? [], markers: missionMarkers, waypoint: waypoint.target });
    }
    if (mapScreen.isOpen) mapScreen.draw({ x: focus.x, z: focus.z, headingDeg, graph, markers: missionMarkers, waypoint: waypoint.target });
    debug.mapOpen = mapScreen.isOpen;
    debug.waypoint = waypoint.target ?? null;
    // Idle = the player and the camera are both still (depth of field fades in after 3 s of that).
    const moving = focus.distanceTo(prevFocus) > 0.05 * Math.max(frameDt, 1e-3) || camera.quaternion.angleTo(prevCamQ) > 1e-4 || input.lookDelta.x !== 0 || input.lookDelta.y !== 0;
    idle.update(frameDt, moving);
    prevFocus.copy(focus); prevCamQ.copy(camera.quaternion);
    // Missions tick once per frame on simulated time (zero while frozen); the clock window uses the game clock.
    if (input.journalPressed) missions.toggleList();
    if (missions.listOpen) {
      const d = input.digitPressed();
      if (d !== undefined) missions.accept(d === 0 ? 9 : d - 1);
      if (input.abandonPressed) missions.abandon();
    }
    missions.tick({ dt: steps * STEP, x: focus.x, z: focus.z, speed: car ? Math.abs(car.speedMs) : player.speed, photo: input.photoPressed, timeOfDay: clock.time });
    markers.update(dt, groundY);
    const m = missions.active;
    missionEl.textContent = missions.hudText(focus.x, focus.z, clock.time) || (missions.listOpen ? '' : 'J  missions');
    missionEl.classList.toggle('idle', !m);
    missionListEl.hidden = !missions.listOpen;
    if (missions.listOpen) missionListEl.textContent = missions.listText();
    debug.mission = m ? { id: m.mission.id, status: m.status, step: m.stepIndex, markers: markers.count } : null;
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
