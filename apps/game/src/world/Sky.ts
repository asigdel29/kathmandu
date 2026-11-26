import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { nightAmount, sunElevation } from './Clock.ts';

const NIGHT_FOG = new THREE.Color(0x0b0f18);

export class Sky {
  readonly sun = new THREE.DirectionalLight(0xfff2dc, 3.5);
  readonly hemi = new THREE.HemisphereLight(0xbfd4ff, 0x8a7a66, 0.6);
  private sky = new SkyMesh();
  private dir = new THREE.Vector3();
  private dayFog = new THREE.Color();

  constructor(private scene: THREE.Scene, timeOfDay: number) {
    if (scene.fog) this.dayFog.copy(scene.fog.color);
    this.sky.scale.setScalar(50000);
    this.sky.turbidity.value = 6; this.sky.rayleigh.value = 1.5; this.sky.mieCoefficient.value = 0.02; this.sky.mieDirectionalG.value = 0.8;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const c = this.sun.shadow.camera; c.left = -300; c.right = 300; c.top = 300; c.bottom = -300; c.near = 1; c.far = 2500;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.5;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    this.setTime(timeOfDay);
  }

  /** t in hours. Sun rises +x (east), stands south (+z) at noon, sets -x. Elevation ~57° at noon: good enough for v1. */
  setTime(t: number): void {
    const h = ((t - 12) / 12) * Math.PI;
    const elev = sunElevation(t);
    const az = -h;
    this.dir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
    this.sky.sunPosition.value.copy(this.dir);
    const day = Math.min(1, Math.max(0, elev / 0.4));
    this.sun.intensity = 3.5 * day;
    this.hemi.intensity = 0.3 + 0.3 * day; // a moonlit floor keeps streets readable at night
    const fog = this.scene.fog;
    if (fog) fog.color.copy(this.dayFog).lerp(NIGHT_FOG, nightAmount(t));
  }

  /** Keep the shadow frustum centred on the player. */
  update(target: THREE.Vector3): void {
    this.sun.position.copy(target).addScaledVector(this.dir, 800);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }
}
