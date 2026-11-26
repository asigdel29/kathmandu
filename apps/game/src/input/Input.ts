import * as THREE from 'three/webgpu';

const TRACKED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'Space', 'KeyE', 'KeyP']);

export class Input {
  readonly lookDelta = { x: 0, y: 0 };
  private down = new Set<string>();
  private pressed = new Set<string>();
  private locked = false;
  private fwd = new THREE.Vector3();
  private out = new THREE.Vector3();

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!TRACKED.has(e.code)) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat && !this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); });
    canvas.addEventListener('click', () => { if (!this.locked) void canvas.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.canvas; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDelta.x += e.movementX;
      this.lookDelta.y += e.movementY;
    });
  }

  get run(): boolean { return this.down.has('ShiftLeft'); }
  get jumpPressed(): boolean { return this.pressed.has('Space'); }
  get interactPressed(): boolean { return this.pressed.has('KeyE'); }
  get pausePressed(): boolean { return this.pressed.has('KeyP'); }
  get pointerLocked(): boolean { return this.locked; }

  /** Camera-relative unit vector on the XZ plane; zero when no movement key is held. */
  moveVector(camera: THREE.Camera): THREE.Vector3 {
    const f = (this.down.has('KeyW') || this.down.has('ArrowUp') ? 1 : 0) - (this.down.has('KeyS') || this.down.has('ArrowDown') ? 1 : 0);
    const s = (this.down.has('KeyD') || this.down.has('ArrowRight') ? 1 : 0) - (this.down.has('KeyA') || this.down.has('ArrowLeft') ? 1 : 0);
    this.out.set(0, 0, 0);
    if (f === 0 && s === 0) return this.out;
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-8) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    // right = forward x up = (-fz, 0, fx)
    this.out.set(this.fwd.x * f - this.fwd.z * s, 0, this.fwd.z * f + this.fwd.x * s);
    return this.out.lengthSq() > 0 ? this.out.normalize() : this.out;
  }

  /** Clear per-frame state: look deltas and one-shot presses. */
  endFrame(): void {
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.pressed.clear();
  }
}
