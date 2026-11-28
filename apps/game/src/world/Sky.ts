import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { cameraPosition, clamp, mix, normalize, positionWorld, pow, uniform, vec3, vec4 } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import {
  ENV_CUBE_SIZE, SHADOW_BIAS, SHADOW_FAR, SHADOW_MAP_SIZE, SHADOW_NEAR, SHADOW_NORMAL_BIAS, SHADOW_RADIUS_M, SKY_CLOUD_COVERAGE,
  SKY_LAYER_GRADIENT_POWER, SKY_MIE, SKY_MIE_G, SKY_RAYLEIGH, SKY_TURBIDITY, SUN_DISTANCE_M, lightingAt, needsEnvRefresh,
} from './lighting.ts';

interface SkyLayer { zenith: UniformNode<'color'>; horizon: UniformNode<'color'> }

/** A SkyMesh with the shared Preetham parameters and the twilight/night layer added on top of its output. */
function createSkyMesh(layer: SkyLayer): SkyMesh {
  const sky = new SkyMesh();
  sky.turbidity.value = SKY_TURBIDITY;
  sky.rayleigh.value = SKY_RAYLEIGH;
  sky.mieCoefficient.value = SKY_MIE;
  sky.mieDirectionalG.value = SKY_MIE_G;
  sky.cloudCoverage.value = SKY_CLOUD_COVERAGE;
  // SkyMesh turns black once the sun is below the horizon; add a blue gradient (and dusk glow) in that case.
  const material = sky.material as THREE.NodeMaterial;
  const base = material.colorNode as unknown as { rgb: ReturnType<typeof vec3> };
  const up = clamp(normalize(positionWorld.sub(cameraPosition)).y, 0, 1);
  const add = mix(layer.horizon, layer.zenith, pow(up, SKY_LAYER_GRADIENT_POWER));
  material.colorNode = vec4(base.rgb.add(add), 1);
  return sky;
}

export class Sky {
  readonly sun = new THREE.DirectionalLight(0xfff2dc, 1);
  readonly hemi = new THREE.HemisphereLight(0xbfd4ff, 0x8a7a66, 0.6);
  /** 0 by day, 1 at night; the streetlights read it. */
  night = 0;
  private layer: SkyLayer = { zenith: uniform(new THREE.Color()), horizon: uniform(new THREE.Color()) };
  private sky = createSkyMesh(this.layer);
  private envSky = createSkyMesh(this.layer);
  private envScene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator;
  private envTarget?: THREE.RenderTarget;
  private lastEnvT?: number;
  private dir = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGPURenderer, timeOfDay: number) {
    this.sky.scale.setScalar(50000);
    this.envSky.scale.setScalar(50);
    this.envSky.showSunDisc.value = 0; // the disc would be a single hot texel in the filtered map; the sun light covers it
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const c = this.sun.shadow.camera;
    c.left = -SHADOW_RADIUS_M; c.right = SHADOW_RADIUS_M; c.top = SHADOW_RADIUS_M; c.bottom = -SHADOW_RADIUS_M; c.near = SHADOW_NEAR; c.far = SHADOW_FAR;
    this.sun.shadow.bias = SHADOW_BIAS; this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    this.setTime(timeOfDay);
  }

  /** t in hours. Sun rises +x (east), stands south (+z) at noon, sets -x. */
  setTime(t: number): void {
    const s = lightingAt(t);
    this.night = s.night;
    this.dir.copy(s.lightDirection);
    for (const sky of [this.sky, this.envSky]) sky.sunPosition.value.copy(s.sunDirection);
    this.layer.zenith.value.copy(s.skyZenithAdd);
    this.layer.horizon.value.copy(s.skyHorizonAdd);
    this.sun.color.copy(s.lightColor);
    this.sun.intensity = s.lightIntensity;
    this.hemi.color.copy(s.hemiSky); this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
    this.scene.environmentIntensity = s.envIntensity;
    this.renderer.toneMappingExposure = s.exposure;
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) { fog.color.copy(s.fogColor); fog.density = s.fogDensity; }
    // Sky image-based light: rebuilt only when the clock has moved far enough, as the PMREM pass is not free.
    if (needsEnvRefresh(this.lastEnvT, t)) this.refreshEnvironment(t);
  }

  private refreshEnvironment(t: number): void {
    const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000, { size: ENV_CUBE_SIZE });
    this.envTarget?.dispose();
    this.envTarget = next;
    this.scene.environment = next.texture;
    this.lastEnvT = t;
  }

  /** Keep the shadow frustum centred on the player. */
  update(target: THREE.Vector3): void {
    this.sun.position.copy(target).addScaledVector(this.dir, SUN_DISTANCE_M);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }
}
