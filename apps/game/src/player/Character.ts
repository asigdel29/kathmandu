import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { Physics } from '../physics/Physics.ts';
import type { Input } from '../input/Input.ts';

/** Exponentially damp angle a toward b along the shorter arc. */
export function dampAngle(a: number, b: number, lambda: number, dt: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * (1 - Math.exp(-lambda * dt));
}

export class Character {
  readonly position = new THREE.Vector3();
  readonly mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), new THREE.MeshStandardNodeMaterial({ color: 0xe07a1f }));
  heading = 0; speed = 0;
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
    this.mesh.castShadow = true; scene.add(this.mesh);
  }

  get isGrounded(): boolean { return this.grounded; }

  update(dt: number, input: Input, camera: THREE.Camera): void {
    const dir = input.moveVector(camera);
    const target = dir.lengthSq() > 0 ? (input.run ? 5.5 : 2.2) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (dir.lengthSq() > 0) this.heading = dampAngle(this.heading, Math.atan2(dir.x, dir.z), 12, dt);
    this.velY = this.grounded && input.jumpPressed ? 5.5 : this.velY - 9.81 * dt;
    const move = { x: Math.sin(this.heading) * this.speed * dt, y: this.velY * dt, z: Math.cos(this.heading) * this.speed * dt };
    this.ctl.computeColliderMovement(this.collider, move);
    const m = this.ctl.computedMovement(); const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    this.grounded = this.ctl.computedGrounded();
    if (this.grounded && this.velY < 0) this.velY = -0.5;
    this.position.set(p.x + m.x, p.y + m.y, p.z + m.z);
    this.mesh.position.copy(this.position); this.mesh.rotation.y = this.heading;
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.velY = 0;
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
  }
}
