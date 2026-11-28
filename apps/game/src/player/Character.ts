import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VehicleType } from '@ktm/schema';
import type { Physics } from '../physics/Physics.ts';
import type { Input } from '../input/Input.ts';
import { CharacterAnimator } from './CharacterAnimator.ts';

/** Exponentially damp angle a toward b along the shorter arc. */
export function dampAngle(a: number, b: number, lambda: number, dt: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * (1 - Math.exp(-lambda * dt));
}

/** Feet sit this far below the body centre: capsule half-height 0.55 plus radius 0.35. */
const FEET_BELOW_CENTRE_M = 0.9;

/**
 * Driver's seat per vehicle type, in the vehicle group's local frame (+Z forward, +X left, +Y up). Feet sit on the
 * cabin floor, estimated from the chassis height. The driver is on the right-hand side (Nepal drives on the left),
 * which is -X in this frame.
 */
const SEAT_OFFSETS: Record<VehicleType, THREE.Vector3> = {
  tempo: new THREE.Vector3(-0.3, -0.75, 0.3),
  taxi: new THREE.Vector3(-0.3, -0.55, 0.2),
  motorbike: new THREE.Vector3(0, -0.35, 0),
};

/** A copy of the driver's seat offset for a vehicle type. */
export function seatOffset(type: VehicleType): THREE.Vector3 {
  return SEAT_OFFSETS[type].clone();
}

export class Character {
  readonly position = new THREE.Vector3();
  /** Root at the body centre. The figure hangs below it, or sits in the vehicle group while driving. */
  readonly mesh = new THREE.Group();
  /** Placeholder shown until the model loads, and if it fails to load. */
  private readonly fallback = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), new THREE.MeshStandardNodeMaterial({ color: 0xe07a1f }));
  private model: THREE.Object3D | null = null;
  private animator: CharacterAnimator | null = null;
  private vehicle: THREE.Object3D | null = null;
  private readonly seat = new THREE.Vector3();
  private active = true;
  private _heading = 0;
  speed = 0;
  /** Facing, radians about +Y (forward = (sin h, cos h)); setting it turns the figure at once. */
  get heading(): number { return this._heading; }
  set heading(h: number) { this._heading = h; if (!this.vehicle) this.mesh.rotation.y = h; }
  private velY = 0; private grounded = false;
  private body: RAPIER.RigidBody; private collider: RAPIER.Collider; private ctl: RAPIER.KinematicCharacterController;

  constructor(scene: THREE.Scene, physics: Physics, spawn: THREE.Vector3) {
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35), this.body);
    this.ctl = w.createCharacterController(0.05);
    this.ctl.enableAutostep(0.45, 0.2, true);
    this.ctl.enableSnapToGround(0.4);
    this.ctl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.position.copy(spawn);
    this.mesh.position.copy(spawn);
    this.fallback.castShadow = true;
    this.mesh.add(this.fallback);
    scene.add(this.mesh);
    this.loadModel();
  }

  get isGrounded(): boolean { return this.grounded; }

  /** Inactive while driving: no collider (the vehicle cannot hit its own driver). The figure stays visible. */
  setActive(active: boolean): void {
    this.active = active;
    this.collider.setEnabled(active);
    this.updateFallback();
    this.speed = 0; this.velY = 0;
  }

  /** Seats the figure in a vehicle group at `seat`, or with null returns it to the character and resumes locomotion. */
  setDriving(vehicle: THREE.Object3D | null, seat: THREE.Vector3 = SEAT_OFFSETS.taxi): void {
    this.vehicle = vehicle;
    this.seat.copy(seat);
    this.speed = 0;
    this.placeModel();
  }

  update(dt: number, input: Input, camera: THREE.Camera): void {
    if (this.vehicle) {
      this.animator?.update(dt, { speed: 0, grounded: true, jumpPressed: false, driving: true });
      return;
    }
    const dir = input.moveVector(camera);
    const target = dir.lengthSq() > 0 ? (input.run ? 5.5 : 2.2) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (dir.lengthSq() > 0) this.heading = dampAngle(this.heading, Math.atan2(dir.x, dir.z), 12, dt);
    const jump = this.grounded && input.jumpPressed;
    this.velY = jump ? 5.5 : this.velY - 9.81 * dt;
    const move = { x: Math.sin(this.heading) * this.speed * dt, y: this.velY * dt, z: Math.cos(this.heading) * this.speed * dt };
    this.ctl.computeColliderMovement(this.collider, move);
    const m = this.ctl.computedMovement(); const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    this.grounded = this.ctl.computedGrounded();
    if (this.grounded && this.velY < 0) this.velY = -0.5;
    this.position.set(p.x + m.x, p.y + m.y, p.z + m.z);
    this.mesh.position.copy(this.position); this.mesh.rotation.y = this.heading;
    this.animator?.update(dt, { speed: this.speed, grounded: this.grounded, jumpPressed: jump, driving: false });
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.velY = 0;
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
  }

  /** Loads the rigged model in the background; the placeholder stays until it arrives, and stays if the load fails. */
  private loadModel(): void {
    const url = `${import.meta.env.BASE_URL}models/characters/player.glb`;
    new GLTFLoader().loadAsync(url).then((gltf) => {
      const model = gltf.scene;
      model.traverse((o) => {
        const skinned = o as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) { skinned.castShadow = true; skinned.frustumCulled = false; }
      });
      const clips: Record<string, THREE.AnimationClip> = {};
      for (const clip of gltf.animations) clips[clip.name] = clip;
      this.animator = new CharacterAnimator(model, clips);
      this.model = model;
      this.placeModel();
      this.updateFallback();
    }).catch((err: unknown) => {
      console.warn('Character model failed to load; keeping the capsule placeholder.', err);
    });
  }

  /** On foot the model hangs below the body centre; in a vehicle it sits at the seat offset inside the vehicle group. */
  private placeModel(): void {
    if (!this.model) return;
    if (this.vehicle) {
      this.vehicle.add(this.model);
      this.model.position.copy(this.seat);
    } else {
      this.mesh.add(this.model);
      this.model.position.set(0, -FEET_BELOW_CENTRE_M, 0);
    }
    this.model.rotation.set(0, 0, 0);
  }

  private updateFallback(): void {
    this.fallback.visible = this.active && this.model === null;
  }
}
