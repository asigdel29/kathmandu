import type * as THREE from 'three/webgpu';
import { localToLonLat, tileId, tileIndexAt } from '@ktm/geo';

const UPDATE_INTERVAL_S = 0.25;

export function formatClock(timeOfDay: number): string {
  const mins = Math.round((((timeOfDay % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export class Hud {
  private fps = 60;
  private acc = UPDATE_INTERVAL_S;

  constructor(private el: HTMLElement) {}

  update(dt: number, pos: THREE.Vector3, timeOfDay: number, paused = false): void {
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    this.acc += dt;
    if (this.acc < UPDATE_INTERVAL_S) return;
    this.acc = 0;
    let tile = '-';
    try { const { i, j } = tileIndexAt(pos.x, pos.z); tile = tileId(i, j); } catch { /* outside the grid */ }
    const { lon, lat } = localToLonLat(pos.x, pos.z);
    this.el.textContent = `${tile}  ${pos.x.toFixed(1)},${pos.z.toFixed(1)}  ${lon.toFixed(5)},${lat.toFixed(5)}  ${Math.round(this.fps)} fps  t=${formatClock(timeOfDay)}${paused ? ' (paused)' : ''}`;
  }
}
