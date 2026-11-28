import * as THREE from 'three/webgpu';
import type { View } from '../config.ts';
import type { Input } from '../input/Input.ts';

export type CameraMode = 'foot' | 'drive';

const FOLLOW_DISTANCE = 2.4;
const EYE_HEIGHT = 1.6;
/**
 * On foot the orbit centre sits this far above the capsule centre (the feet are 0.9 m below it), so the camera, which
 * rises by sin(pitch) x FOLLOW_DISTANCE above that point, is 1.6 m over the ground and the whole figure is in frame.
 */
const FOOT_LOOK_HEIGHT = 0.1;
const DRIVE_DISTANCE = 6.5;
const DRIVE_HEIGHT = 2.4;
const DRIVE_LOOK_HEIGHT = 1.0;
const LOOK_RAD_PER_PX = 0.0025;
const PITCH_MIN = -0.3;
const PITCH_MAX = 1.1;
const TAU = 0.12;
const ISO_OFFSET = new THREE.Vector3(350, 300, 350);

export class FollowCamera {
  yaw = 0;
  pitch = 0.25;
  /** foot: orbit the character with the mouse; drive: sit behind the vehicle heading. */
  mode: CameraMode = 'foot';
  private vel = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private d = new THREE.Vector3();
  private temp = new THREE.Vector3();
  private lastTarget = new THREE.Vector3();
  private first = true;

  constructor(readonly camera: THREE.PerspectiveCamera, public view: View) {
    camera.far = Math.max(camera.far, 20000);
    camera.updateProjectionMatrix();
    this.applyFov();
  }

  private applyFov(): void {
    const fov = this.view === 'iso' ? 35 : this.view === 'follow' && this.mode === 'drive' ? 60 : 50;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  setView(view: View): void { this.view = view; this.first = true; this.applyFov(); }

  /** Switch rigs; the camera springs from where it is to the new rig. Back on foot the orbit starts behind headingYaw (forward = (sin, cos)). */
  setMode(mode: CameraMode, headingYaw?: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'foot' && headingYaw !== undefined) { this.yaw = headingYaw + Math.PI; this.pitch = 0.25; }
    this.applyFov();
  }

  /** targetYaw is the heading of the driven vehicle (used in drive mode only). */
  update(dt: number, target: THREE.Vector3, input: Input, tileCentre?: THREE.Vector3, targetYaw = 0): void {
    this.applyFov();
    const cam = this.camera;
    if (this.view === 'iso') {
      cam.position.copy(target).add(ISO_OFFSET);
      cam.lookAt(target);
      this.first = false;
      this.lastTarget.copy(target);
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
      this.lastTarget.copy(target);
      return;
    }
    if (this.mode === 'drive') {
      this.look.set(target.x, target.y + DRIVE_LOOK_HEIGHT, target.z);
      this.desired.set(-Math.sin(targetYaw) * DRIVE_DISTANCE, DRIVE_HEIGHT, -Math.cos(targetYaw) * DRIVE_DISTANCE).add(target);
      // Run the spring in the vehicle's frame: carry the camera with the target's motion first, so at speed it
      // does not trail a speed-dependent distance behind; only heading changes and bumps are smoothed.
      if (!this.first) cam.position.add(this.temp.copy(target).sub(this.lastTarget));
    } else {
      this.yaw -= input.lookDelta.x * LOOK_RAD_PER_PX;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookDelta.y * LOOK_RAD_PER_PX, PITCH_MIN, PITCH_MAX);
      this.look.set(target.x, target.y + FOOT_LOOK_HEIGHT, target.z);
      const cp = Math.cos(this.pitch);
      this.desired.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(FOLLOW_DISTANCE).add(this.look);
    }
    this.lastTarget.copy(target);
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
