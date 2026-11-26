import * as THREE from 'three/webgpu';
import { BASE_ELEVATION_M, lonLatToLocal, TILE_SIZE_M, tileOrigin } from '@ktm/geo';
import { FollowCamera } from './camera/FollowCamera.ts';
import { readConfig } from './config.ts';
import { Input } from './input/Input.ts';
import { createFacadeMaterial, createNightUniform } from './materials/facade.ts';
import { Physics } from './physics/Physics.ts';
import { Character } from './player/Character.ts';
import { createRenderer } from './renderer.ts';
import { Hud } from './ui/Hud.ts';
import { HeroLoader, heroSpawn } from './world/HeroLoader.ts';
import { loadManifest } from './world/manifest.ts';
import { PropsRenderer } from './world/PropsRenderer.ts';
import { Sky } from './world/Sky.ts';
import { TileLoader } from './world/TileLoader.ts';
import { TileStreamer } from './world/TileStreamer.ts';

declare global { interface Window { __ktmReady?: boolean; __ktm?: unknown } }

async function main(): Promise<void> {
  const config = readConfig(location.search, import.meta.env.VITE_WORLD_BASE_URL ?? '/world/');
  const manifest = await loadManifest(config.worldBase);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xd9c7a8, 0.00012);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 20000);
  const { renderer, post } = await createRenderer(scene, camera);
  document.body.appendChild(renderer.domElement);

  const sky = new Sky(scene, config.timeOfDay);
  const physics = await Physics.create();
  const night = createNightUniform();
  night.value = sky.night();
  const facade = createFacadeMaterial(night);
  const loader = new TileLoader(config.worldBase, manifest, facade);
  const props = new PropsRenderer(scene, night);
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
  const ground = streamer.heightAt(start.x, start.z);
  physics.step(1 / 60); // registers the new colliders with scene queries
  player.teleport(start.x, (ground ?? BASE_ELEVATION_M) - BASE_ELEVATION_M + 1.2, start.z);
  await heroes.update(streamer.loaded());
  window.__ktm = { physics, streamer, heroes, player, sky, scene };
  window.__ktmReady = true;

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!config.freeze) { player.update(dt, input, camera); physics.step(dt); }
    follow.update(dt, player.position, input, lookAt);
    sky.update(player.position);
    void streamer.update(player.position);
    void heroes.update(streamer.loaded());
    hud.update(dt, player.position, config.timeOfDay);
    input.endFrame();
    post.render();
  };
  renderer.setAnimationLoop(frame);
}

main().catch((e: unknown) => {
  document.getElementById('hud')!.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  throw e;
});
