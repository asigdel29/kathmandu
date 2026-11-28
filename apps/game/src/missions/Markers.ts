import * as THREE from 'three/webgpu';
import type { MarkerSink, MarkerTarget } from './MissionSystem.ts';

/** Marigold, the mission colour (HUD text, pins, rings). */
export const MARIGOLD = '#f2a81d';
/** Height of the pin above the ground at the target. */
const HOVER_M = 7;

/** A map-pin silhouette: marigold head with a white centre, dark outline, pointing down. */
function pinTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 96;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(32, 32, 26, Math.PI * 0.82, Math.PI * 2.18);
  g.lineTo(32, 92);
  g.closePath();
  g.fillStyle = MARIGOLD; g.fill();
  g.lineWidth = 4; g.strokeStyle = '#3a2405'; g.stroke();
  g.beginPath(); g.arc(32, 32, 10, 0, Math.PI * 2); g.fillStyle = '#fff8e6'; g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Pin { target: MarkerTarget; sprite: THREE.Sprite; ring: THREE.Mesh }

/**
 * Billboard pins over mission targets, with a ground ring the size of the step radius. Pins keep a constant
 * screen size and draw over buildings so the target stays findable from a distance; rings are depth-tested.
 */
export class Markers implements MarkerSink {
  readonly group = new THREE.Group();
  private pins: Pin[] = [];
  private tex = pinTexture();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'mission-markers';
    scene.add(this.group);
  }

  get count(): number { return this.pins.length; }

  set(targets: readonly MarkerTarget[]): void {
    for (const p of this.pins) {
      p.sprite.material.dispose();
      p.ring.geometry.dispose();
      (p.ring.material as THREE.Material).dispose();
      this.group.remove(p.sprite, p.ring);
    }
    this.pins = targets.map((target) => {
      const mat = new THREE.SpriteNodeMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
      mat.fog = false;
      mat.opacity = target.current ? 1 : 0.45;
      const sprite = new THREE.Sprite(mat);
      const s = target.current ? 1 : 0.7;
      sprite.scale.set(0.04 * s, 0.06 * s, 1);
      sprite.center.set(0.5, 0);
      sprite.renderOrder = 10;
      const ringMat = new THREE.MeshBasicNodeMaterial({ color: MARIGOLD, transparent: true, opacity: target.current ? 0.55 : 0.25, depthWrite: false, side: THREE.DoubleSide });
      ringMat.fog = false;
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.5, target.radius - 0.8), target.radius, 64), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 9;
      this.group.add(sprite, ring);
      return { target, sprite, ring };
    });
  }

  /** Places pins and rings on the ground (groundY in scene metres) and bobs the current pin. */
  update(dt: number, groundY: (x: number, z: number) => number): void {
    this.time += dt;
    for (const p of this.pins) {
      const { x, z, current } = p.target;
      const y = groundY(x, z);
      p.sprite.position.set(x, y + HOVER_M + (current ? Math.sin(this.time * 2.5) * 0.5 : 0), z);
      p.ring.position.set(x, y + 0.2, z);
    }
  }
}
