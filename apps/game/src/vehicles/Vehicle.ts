import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { VehicleTuning, VehicleType } from '@ktm/schema';
import type { Physics } from '../physics/Physics.ts';

const DEG = Math.PI / 180;

export function msToKmh(ms: number): number { return ms * 3.6; }
export function kmhToMs(kmh: number): number { return kmh / 3.6; }

/** Steering lock in radians at a given speed: full lock up to the fade start, smoothstep down to 0 at the fade end. */
export function steerLimit(kmh: number, tuning: Pick<VehicleTuning, 'maxSteerDeg' | 'steerFadeStartKmh' | 'steerFadeEndKmh'>): number {
  const max = tuning.maxSteerDeg * DEG;
  const s = Math.abs(kmh);
  const a = tuning.steerFadeStartKmh; const b = tuning.steerFadeEndKmh;
  if (s <= a) return max;
  if (s >= b) return 0;
  const t = (s - a) / (b - a);
  return max * (1 - t * t * (3 - 2 * t));
}

/** Move current toward target by at most rate * dt, never overshooting. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  const step = Math.abs(rate * dt);
  const d = target - current;
  return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
}

export interface DriveInput {
  /** -1..1; negative brakes, then reverses once nearly stopped. */
  throttle: number;
  /** -1..1; positive steers left. */
  steer: number;
  handbrake: boolean;
}

interface WheelSpec { x: number; z: number; steer: boolean; drive: boolean; }
interface VisualWheel { ray: number; x: number; pivot: THREE.Group; spin: THREE.Group; }

const COLORS: Record<VehicleType, number> = { taxi: 0xf2c14e, tempo: 0x3d7a4a, motorbike: 0x8b1e1e };
const STEER_RATE = 2.5; // rad/s toward the target angle
const STOP_MS = 1; // below this forward speed S reverses instead of braking
const BIKE_TRACK = 0.3;
const ROLL_STIFFNESS = 120; // 1/s^2
const ROLL_DAMPING = 20; // 1/s
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Chassis local frame: +Z forward, +Y up, X is the axle (+X is the left side).
 * Rapier's ray-cast controller drives a dynamic body; the meshes are a placeholder group synced after each physics step.
 */
export class Vehicle {
  readonly group = new THREE.Group();
  occupied = false;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private ctl: RAPIER.DynamicRayCastVehicleController;
  private specs: WheelSpec[];
  private visuals: VisualWheel[] = [];
  private leanPivot = new THREE.Group();
  private steerAngle = 0;
  private lean = 0;
  private connY: number;
  /** Height of the chassis centre above the ground at rest (before suspension sag). */
  private rideHeight: number;
  private disposables: { dispose(): void }[] = [];

  constructor(private scene: THREE.Scene, private physics: Physics, readonly type: VehicleType, readonly tuning: VehicleTuning, pos: THREE.Vector3, yaw: number) {
    const t = tuning;
    const w = physics.world;
    this.connY = -t.height / 2 + 0.1;
    this.rideHeight = t.suspensionRestLength + t.wheelRadius - this.connY;

    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    // Narrow vehicles carry their mass at axle height so cornering forces do not tip them over.
    const comY = t.wheels === 4 ? -0.3 * t.height : -(this.rideHeight - t.wheelRadius);
    const m = t.massKg;
    const inertia = {
      x: (m / 12) * (t.height ** 2 + t.length ** 2),
      y: (m / 12) * (t.width ** 2 + t.length ** 2),
      z: (m / 12) * (t.width ** 2 + t.height ** 2),
    };
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + this.rideHeight, pos.z)
        .setRotation(q)
        .setAdditionalMassProperties(m, { x: 0, y: comY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.05)
        .setAngularDamping(t.wheels === 4 ? 0.8 : 2)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.cuboid(t.width / 2, t.height / 2, t.length / 2).setDensity(0).setFriction(0.3),
      this.body,
    );

    this.ctl = w.createVehicleController(this.body);
    this.ctl.indexUpAxis = 1;
    this.ctl.setIndexForwardAxis = 2;
    this.specs = wheelLayout(type, t);
    this.specs.forEach((s, i) => {
      this.ctl.addWheel({ x: s.x, y: this.connY, z: s.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, t.suspensionRestLength, t.wheelRadius);
      this.ctl.setWheelSuspensionStiffness(i, t.suspensionStiffness);
      this.ctl.setWheelSuspensionCompression(i, t.suspensionCompression);
      this.ctl.setWheelSuspensionRelaxation(i, t.suspensionRelaxation);
      this.ctl.setWheelFrictionSlip(i, t.frictionSlip);
      this.ctl.setWheelMaxSuspensionForce(i, m * 9.81 * 4);
    });

    this.buildMeshes();
    this.group.position.set(pos.x, pos.y + this.rideHeight, pos.z);
    this.group.quaternion.set(q.x, q.y, q.z, q.w);
    scene.add(this.group);
  }

  private buildMeshes(): void {
    const t = this.tuning;
    // The lean pivot sits on the ground so the motorbike rolls about its contact line.
    this.leanPivot.position.y = -this.rideHeight;
    this.group.add(this.leanPivot);
    const content = new THREE.Group();
    content.position.y = this.rideHeight;
    this.leanPivot.add(content);

    const bodyMat = new THREE.MeshStandardNodeMaterial({ color: COLORS[this.type], roughness: 0.6, metalness: 0.1 });
    const wheelMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b1b1b, roughness: 0.9 });
    const hubMat = new THREE.MeshStandardNodeMaterial({ color: 0x9a9a9a, roughness: 0.5, metalness: 0.4 });
    const bodyGeo = new THREE.BoxGeometry(t.width, t.height, t.length);
    const wheelWidth = this.type === 'motorbike' ? 0.12 : 0.2;
    const wheelGeo = new THREE.CylinderGeometry(t.wheelRadius, t.wheelRadius, wheelWidth, 16).rotateZ(Math.PI / 2);
    const hubGeo = new THREE.BoxGeometry(wheelWidth * 1.1, t.wheelRadius * 1.4, 0.06);
    this.disposables.push(bodyMat, wheelMat, hubMat, bodyGeo, wheelGeo, hubGeo);

    const chassis = new THREE.Mesh(bodyGeo, bodyMat);
    chassis.castShadow = true; chassis.receiveShadow = true;
    content.add(chassis);

    const visualRays = this.type === 'motorbike' ? [{ ray: 0, x: 0 }, { ray: 2, x: 0 }] : this.specs.map((s, ray) => ({ ray, x: s.x }));
    for (const v of visualRays) {
      const pivot = new THREE.Group(); const spin = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, wheelMat); tyre.castShadow = true;
      spin.add(tyre, new THREE.Mesh(hubGeo, hubMat));
      pivot.add(spin);
      pivot.position.set(v.x, this.connY - this.tuning.suspensionRestLength, this.specs[v.ray]!.z);
      content.add(pivot);
      this.visuals.push({ ...v, pivot, spin });
    }
  }

  /** Signed forward speed in m/s (negative when reversing). */
  get speedMs(): number { return this.ctl.currentVehicleSpeed(); }

  get position(): THREE.Vector3 { const p = this.body.translation(); return new THREE.Vector3(p.x, p.y, p.z); }

  /** Heading about +Y, same convention as the character: forward = (sin yaw, 0, cos yaw). */
  get yaw(): number { const f = this.forward(); return Math.atan2(f.x, f.z); }

  /** A ground-level point 1.2 m beside the chassis on its right side. */
  exitPoint(): THREE.Vector3 {
    const p = this.position; const f = this.forward();
    const right = new THREE.Vector3(-f.z, 0, f.x).normalize(); // forward x up
    if (right.lengthSq() === 0) right.set(-1, 0, 0);
    const side = this.tuning.width / 2 + 1.2;
    return new THREE.Vector3(p.x + right.x * side, p.y - this.rideHeight, p.z + right.z * side);
  }

  /** Apply driver input; call once per physics step before Physics.step (zero input keeps a parked vehicle on its wheels). */
  controls(input: DriveInput, dt: number): void {
    const t = this.tuning;
    const h = Math.min(dt, 1 / 30);
    const throttle = this.occupied ? Math.max(-1, Math.min(1, input.throttle)) : 0;
    const steerIn = this.occupied ? Math.max(-1, Math.min(1, input.steer)) : 0;
    const handbrake = this.occupied ? input.handbrake : true;
    const v = this.speedMs;
    const kmh = msToKmh(v);

    this.steerAngle = approach(this.steerAngle, steerIn * steerLimit(kmh, t), STEER_RATE, h);

    let engine = 0; let brake = 0;
    if (throttle > 0) {
      if (v < -STOP_MS) brake = t.brakeForce * throttle;
      else if (kmh < t.maxSpeedKmh) engine = t.engineForce * throttle;
    } else if (throttle < 0) {
      if (v > STOP_MS) brake = t.brakeForce * -throttle;
      else if (-kmh < t.maxSpeedKmh * 0.3) engine = t.engineForce * 0.6 * throttle;
    } else {
      brake = t.brakeForce * 0.03; // rolling resistance so a released throttle coasts to a stop
    }

    const driven = this.specs.filter((s) => s.drive).length;
    this.specs.forEach((s, i) => {
      this.ctl.setWheelSteering(i, s.steer ? this.steerAngle : 0);
      this.ctl.setWheelEngineForce(i, s.drive ? engine / driven : 0);
      this.ctl.setWheelBrake(i, handbrake && s.drive ? Math.max(brake, t.handbrakeForce) : brake);
    });
    this.ctl.updateVehicle(h);
    if (t.wheels < 4) this.stabiliseRoll(h);
  }

  /** Rider balance for the narrow vehicles: a damped spring torque about the forward axis pulls the chassis upright (pitch and yaw stay free). */
  private stabiliseRoll(h: number): void {
    let grounded = false;
    for (let i = 0; i < this.specs.length; i++) if (this.ctl.wheelIsInContact(i)) grounded = true;
    if (!grounded) return;
    const r = this.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const err = up.clone().cross(WORLD_UP).dot(f); // signed roll error about the forward axis
    const av = this.body.angvel();
    const rate = av.x * f.x + av.y * f.y + av.z * f.z;
    const t = this.tuning;
    const inertia = (t.massKg / 12) * (t.width ** 2 + t.height ** 2);
    const k = (ROLL_STIFFNESS * err - ROLL_DAMPING * rate) * inertia * h;
    this.body.applyTorqueImpulse({ x: f.x * k, y: f.y * k, z: f.z * k }, true);
  }

  /** Copy the physics state to the meshes; call after Physics.step. */
  syncVisual(dt = 1 / 60): void {
    const p = this.body.translation(); const r = this.body.rotation();
    this.group.position.set(p.x, p.y, p.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
    for (const w of this.visuals) {
      const susp = this.ctl.wheelSuspensionLength(w.ray) ?? this.tuning.suspensionRestLength;
      w.pivot.position.y = this.connY - susp;
      w.pivot.rotation.y = this.ctl.wheelSteering(w.ray) ?? 0;
      w.spin.rotation.x = this.ctl.wheelRotation(w.ray) ?? 0;
    }
    if (this.tuning.leanMaxDeg > 0) {
      const max = this.tuning.leanMaxDeg * DEG;
      const speedFactor = Math.min(1, Math.abs(msToKmh(this.speedMs)) / 30);
      const steerFrac = this.steerAngle / (this.tuning.maxSteerDeg * DEG);
      const target = Math.max(-max, Math.min(max, steerFrac * speedFactor * max * 1.5));
      this.lean += (target - this.lean) * Math.min(1, dt * 8);
      this.leanPivot.rotation.z = -this.lean;
    }
  }

  dispose(): void {
    const w = this.physics.world;
    w.removeVehicleController(this.ctl);
    w.removeCollider(this.collider, false);
    w.removeRigidBody(this.body);
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
  }

  private forward(): THREE.Vector3 {
    const r = this.body.rotation();
    return new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  }
}

function wheelLayout(type: VehicleType, t: VehicleTuning): WheelSpec[] {
  const front = t.length / 2 - Math.max(0.35, t.wheelRadius * 1.6);
  const rear = -front;
  const side = (track: number) => track / 2;
  switch (type) {
    case 'tempo': {
      const x = side(t.width - 0.15);
      return [
        { x: 0, z: front, steer: true, drive: false },
        { x, z: rear, steer: false, drive: true },
        { x: -x, z: rear, steer: false, drive: true },
      ];
    }
    case 'motorbike': {
      const x = side(BIKE_TRACK);
      return [
        { x, z: front, steer: true, drive: false },
        { x: -x, z: front, steer: true, drive: false },
        { x, z: rear, steer: false, drive: true },
        { x: -x, z: rear, steer: false, drive: true },
      ];
    }
    case 'taxi': {
      const x = side(t.width - 0.25);
      return [
        { x, z: front, steer: true, drive: false },
        { x: -x, z: front, steer: true, drive: false },
        { x, z: rear, steer: false, drive: true },
        { x: -x, z: rear, steer: false, drive: true },
      ];
    }
  }
}
