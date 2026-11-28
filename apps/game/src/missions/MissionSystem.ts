import type { Mission } from '@ktm/schema';
import { formatClock } from '../ui/Hud.ts';
import { inWindow, MissionFsm, type MissionEvent, type MissionTick } from './fsm.ts';

/** Where a marker goes: the current step's target, and a dimmer preview of the next one. */
export interface MarkerTarget { x: number; z: number; radius: number; current: boolean }
/** Receives the marker targets whenever they change (Markers.ts in the browser, a stub in tests). */
export interface MarkerSink { set(targets: readonly MarkerTarget[]): void }

/** How long the "mission complete / failed" banner stays up before the mission is cleared. */
export const BANNER_S = 5;

export function formatDistance(m: number): string {
  return m < 999.5 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Countdown text: rounds up, so the display reaches 0:00 only when the time is gone. */
export function formatDuration(s: number): string {
  const total = Math.max(0, Math.ceil(s - 1e-9));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const FAIL_TEXT = { timeout: 'Out of time', abandoned: 'Abandoned' } as const;

/** Mission list, accept/abandon, marker targets and HUD text around one MissionFsm at a time. */
export class MissionSystem {
  listOpen = false;
  private fsm: MissionFsm | undefined;
  private banner: { text: string; left: number } | undefined;

  constructor(readonly missions: readonly Mission[], private markers?: MarkerSink) {}

  /** The accepted mission, until its end banner has been shown. */
  get active(): MissionFsm | undefined { return this.fsm; }

  toggleList(): void { this.listOpen = !this.listOpen; }

  /** Accept by id or by list index. Refused while another mission is running. Closes the list. */
  accept(which: string | number): boolean {
    if (this.fsm?.status === 'active') return false;
    const m = typeof which === 'number' ? this.missions[which] : this.missions.find((x) => x.id === which);
    if (!m) return false;
    this.fsm = new MissionFsm(m);
    this.banner = undefined;
    this.listOpen = false;
    this.handle(this.fsm.accept());
    return true;
  }

  abandon(): MissionEvent[] {
    return this.fsm ? this.handle(this.fsm.abandon()) : [];
  }

  tick(t: MissionTick): MissionEvent[] {
    if (this.banner) {
      this.banner.left -= t.dt;
      if (this.banner.left <= 0) { this.banner = undefined; this.fsm = undefined; }
      return [];
    }
    return this.fsm ? this.handle(this.fsm.tick(t)) : [];
  }

  /** Two lines (mission + step) while active, the end banner after, '' otherwise. */
  hudText(x: number, z: number, timeOfDay: number): string {
    if (this.banner) return this.banner.text;
    const f = this.fsm;
    const s = f?.step;
    if (!f || !s) return '';
    const remaining = f.remainingS;
    const head = `${f.mission.title}  ${f.stepIndex + 1}/${f.mission.steps.length}${remaining === undefined ? '' : `  ${formatDuration(remaining)}`}`;
    let line = `${s.text}  ${formatDistance(f.distanceTo(x, z) ?? 0)}`;
    if (s.kind === 'wait') line += `  hold ${Math.ceil((s.waitS ?? 0) - f.waitedS - 1e-9)} s`;
    if (s.kind === 'photo') line += '  [F] photo';
    if (s.window && !inWindow(timeOfDay, s.window)) line += `  (${formatClock(s.window.fromH)}-${formatClock(s.window.toH)})`;
    return `${head}\n${line}`;
  }

  listText(): string {
    const activeId = this.fsm?.status === 'active' ? this.fsm.mission.id : undefined;
    const rows = this.missions.slice(0, 10).map((m, i) => `${(i + 1) % 10}  ${m.title}  [${m.type}]${m.id === activeId ? '  < active' : ''}`);
    const foot = activeId ? 'Backspace abandons the active mission.' : 'Press a number to accept.';
    return ['Missions (J to close)', ...rows, '', foot].join('\n');
  }

  private handle(events: MissionEvent[]): MissionEvent[] {
    const f = this.fsm;
    if (!f) return events;
    for (const e of events) {
      if (e.kind === 'step') {
        const steps = f.mission.steps;
        const targets: MarkerTarget[] = [];
        for (let i = e.index; i < Math.min(e.index + 2, steps.length); i++) {
          const s = steps[i]!;
          targets.push({ x: s.x, z: s.z, radius: s.radius, current: i === e.index });
        }
        this.markers?.set(targets);
      } else if (e.kind === 'done') {
        this.markers?.set([]);
        this.banner = { text: `Mission complete: ${f.mission.title}\n${f.mission.rewardText}`, left: BANNER_S };
      } else if (e.kind === 'failed') {
        this.markers?.set([]);
        this.banner = { text: `Mission failed: ${f.mission.title}\n${FAIL_TEXT[e.reason]}`, left: BANNER_S };
      }
    }
    return events;
  }
}
