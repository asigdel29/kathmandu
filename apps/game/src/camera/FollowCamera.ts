import * as THREE from 'three/webgpu';
import type { View } from '../config.ts';
import type { Input } from '../input/Input.ts';

const FOLLOW_DISTANCE = 2.4;
const EYE_HEIGHT = 1.6;
const LOOK_RAD_PER_PX = 0.0025;
const PITCH_MIN = -0.3;
const PITCH_MAX = 1.1;
const TAU = 0.12;
const ISO_OFFSET = new THREE.Vector3(350, 300, 350);

export class FollowCamera {
  yaw = 0;
  pitch = 0.25;
  private vel = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private d = new THREE.Vector3();
  private temp = new THREE.Vector3();
  private first = true;

  constructor(readonly camera: THREE.PerspectiveCamera, public view: View) {
    camera.far = Math.max(camera.far, 20000);
    camera.updateProjectionMatrix();
    this.applyFov();
  }

  private applyFov(): void {
    const fov = this.view === 'iso' ? 35 : 50;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  setView(view: View): void { this.view = view; this.first = true; this.applyFov(); }

  update(dt: number, target: THREE.Vector3, input: Input, tileCentre?: THREE.Vector3): void {
    this.applyFov();
    const cam = this.camera;
    if (this.view === 'iso') {
      cam.position.copy(target).add(ISO_OFFSET);
      cam.lookAt(target);
      this.first = false;
      return;
    }
    if (this.view === 'street') {
      cam.position.set(target.x, target.y + EYE_HEIGHT, target.z);
      const dx = (tileCentre?.x ?? target.x) - target.x;
      const dz = (tileCentre?.z ?? target.z) - target.z;
      if (dx * dx + dz * dz < 1) this.look.set(cam.position.x + 1, cam.position.y, cam.position.z);
      else this.look.set(target.x + dx, cam.position.y, target.z + dz);
      cam.lookAt(this.look);
      this.first = false;
      return;
    }
    this.yaw -= input.lookDelta.x * LOOK_RAD_PER_PX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookDelta.y * LOOK_RAD_PER_PX, PITCH_MIN, PITCH_MAX);
    this.look.set(target.x, target.y + EYE_HEIGHT, target.z);
    const cp = Math.cos(this.pitch);
    this.desired.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(FOLLOW_DISTANCE).add(this.look);
    if (this.first || dt <= 0) {
      cam.position.copy(this.desired);
      this.vel.set(0, 0, 0);
      this.first = false;
    } else {
      // Critically damped spring toward the desired position, integrated exactly (omega = 1 / tau).
      const omega = 1 / TAU;
      const decay = Math.exp(-omega * dt);
      this.d.copy(cam.position).sub(this.desired);
      this.temp.copy(this.vel).addScaledVector(this.d, omega).multiplyScalar(dt);
      this.vel.addScaledVector(this.temp, -omega).multiplyScalar(decay);
      cam.position.copy(this.desired).add(this.d.add(this.temp).multiplyScalar(decay));
    }
    cam.lookAt(this.look);
  }
}
