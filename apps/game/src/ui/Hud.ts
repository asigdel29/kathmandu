import type * as THREE from 'three/webgpu';
import { localToLonLat, tileId, tileIndexAt } from '@ktm/geo';
import { formatDistance } from '../map/waypoint.ts';

const UPDATE_INTERVAL_S = 0.25;

export function formatClock(timeOfDay: number): string {
  const mins = Math.round((((timeOfDay % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export function formatSpeed(kmh: number): string { return `${Math.round(Math.abs(kmh))} km/h`; }

export function formatTraffic(n: number): string { return `${n} ${n === 1 ? 'vehicle' : 'vehicles'}`; }

/** Waypoint arrow rotation: the target's bearing relative to where the camera looks, degrees in [-180, 180). */
export function relativeBearing(bearingDeg: number, cameraHeadingDeg: number): number {
  return ((((bearingDeg - cameraHeadingDeg + 180) % 360) + 360) % 360) - 180;
}

export class Hud {
  private fps = 60;
  private acc = UPDATE_INTERVAL_S;
  private wp?: { el: HTMLElement; arrow: HTMLElement; text: HTMLElement };

  constructor(private el: HTMLElement) {}

  /** Waypoint distance and arrow (relDeg: 0 = straight ahead, 90 = right); hidden when info is undefined. */
  setWaypoint(info?: { distance: number; relDeg: number }): void {
    if (!info) { if (this.wp) this.wp.el.style.display = 'none'; return; }
    if (!this.wp) {
      const el = document.createElement('div'); el.id = 'waypoint';
      const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '▲';
      const text = document.createElement('span'); text.className = 'dist';
      el.append(arrow, text);
      document.body.appendChild(el);
      this.wp = { el, arrow, text };
    }
    this.wp.el.style.display = 'flex';
    this.wp.arrow.style.transform = `rotate(${info.relDeg.toFixed(1)}deg)`;
    this.wp.text.textContent = `waypoint ${formatDistance(info.distance)}`;
  }

  /** speedKmh is shown while driving; leave it undefined on foot. trafficCount is shown while traffic is on. */
  update(dt: number, pos: THREE.Vector3, timeOfDay: number, paused = false, speedKmh?: number, trafficCount?: number): void {
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    this.acc += dt;
    if (this.acc < UPDATE_INTERVAL_S) return;
    this.acc = 0;
    let tile = '-';
    try { const { i, j } = tileIndexAt(pos.x, pos.z); tile = tileId(i, j); } catch { /* outside the grid */ }
    const { lon, lat } = localToLonLat(pos.x, pos.z);
    const info = `${tile}  ${pos.x.toFixed(1)},${pos.z.toFixed(1)}  ${lon.toFixed(5)},${lat.toFixed(5)}  ${Math.round(this.fps)} fps  t=${formatClock(timeOfDay)}${paused ? ' (paused)' : ''}${trafficCount === undefined ? '' : `  ${formatTraffic(trafficCount)}`}`;
    this.el.textContent = speedKmh === undefined ? info : `${formatSpeed(speedKmh)}  ${info}`;
  }
}
