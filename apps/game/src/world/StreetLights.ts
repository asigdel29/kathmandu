import * as THREE from 'three/webgpu';
import { LAMP_COLOR, LAMP_DECAY, LAMP_DISTANCE_M, LAMP_INTENSITY, LAMP_MAX_LIGHTS, LAMP_ON_NIGHT, LAMP_RADIUS_M, LAMP_REFRESH_S } from './lighting.ts';

export interface Lamp { key: string; x: number; y: number; z: number }

/** Nearest `max` lamps within `radius` metres (horizontal distance) of (fx, fz), nearest first. */
export function selectLamps(lamps: Iterable<Lamp>, fx: number, fz: number, radius = LAMP_RADIUS_M, max = LAMP_MAX_LIGHTS): Lamp[] {
  const r2 = radius * radius;
  const hit: { lamp: Lamp; d2: number }[] = [];
  for (const lamp of lamps) {
    const d2 = (lamp.x - fx) ** 2 + (lamp.z - fz) ** 2;
    if (d2 <= r2) hit.push({ lamp, d2 });
  }
  hit.sort((a, b) => a.d2 - b.d2);
  return hit.slice(0, max).map((h) => h.lamp);
}

/**
 * Light slots for the selected lamps. A lamp that already owns a slot keeps it (so a light never jumps from one
 * lamp to another while the player walks); the others take free slots. Returns the lamp key per slot, undefined = unused.
 */
export function assignSlots(prev: readonly (string | undefined)[], selected: readonly Lamp[]): (string | undefined)[] {
  const want = new Set(selected.map((l) => l.key));
  const next = prev.map((k) => (k !== undefined && want.has(k) ? k : undefined));
  const have = new Set(next.filter((k): k is string => k !== undefined));
  let slot = 0;
  for (const l of selected) {
    if (have.has(l.key)) continue;
    while (slot < next.length && next[slot] !== undefined) slot++;
    if (slot >= next.length) break;
    next[slot] = l.key; have.add(l.key);
  }
  return next;
}

/** A fixed pool of warm PointLights placed on the streetlights nearest the player at night. No shadows. */
export class StreetLights {
  private lights: THREE.PointLight[] = [];
  private slots: (string | undefined)[] = [];
  private since = Infinity;
  private on = false;

  constructor(scene: THREE.Scene, private lamps: () => Iterable<Lamp>) {
    for (let i = 0; i < LAMP_MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(LAMP_COLOR, 0, LAMP_DISTANCE_M, LAMP_DECAY);
      l.castShadow = false; l.visible = false;
      this.lights.push(l); this.slots.push(undefined);
      scene.add(l);
    }
  }

  /** Visible lights, for tests and the HUD. */
  get active(): number { return this.lights.filter((l) => l.visible && l.intensity > 0).length; }

  /** night in 0..1; focus is the player (or driven vehicle) position. */
  update(dt: number, focus: THREE.Vector3, night: number): void {
    const on = night > LAMP_ON_NIGHT;
    // Hidden lights leave the shader's light list entirely, so daytime frames pay nothing for them.
    if (on !== this.on) { this.on = on; for (const l of this.lights) l.visible = on; this.since = Infinity; }
    if (!on) return;
    const k = Math.min(1, (night - LAMP_ON_NIGHT) / 0.4);
    for (const l of this.lights) if (l.intensity > 0) l.intensity = LAMP_INTENSITY * k;
    this.since += dt;
    if (this.since < LAMP_REFRESH_S) return;
    this.since = 0;
    const selected = selectLamps(this.lamps(), focus.x, focus.z);
    this.slots = assignSlots(this.slots, selected);
    const byKey = new Map(selected.map((l) => [l.key, l]));
    this.slots.forEach((key, i) => {
      const light = this.lights[i]!;
      const lamp = key === undefined ? undefined : byKey.get(key);
      if (!lamp) { light.intensity = 0; return; }
      light.position.set(lamp.x, lamp.y, lamp.z);
      light.intensity = LAMP_INTENSITY * k;
    });
  }
}
