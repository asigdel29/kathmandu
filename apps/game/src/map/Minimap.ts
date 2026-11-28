import type { NavGraph } from '../traffic/NavGraph.ts';
import { edgeStyle, type EdgeStyle } from './edgeStyle.ts';
import { MINIMAP_CSS_PX, MINIMAP_PX, MINIMAP_RADIUS_M, minimapView, worldToMap, type MapView, type XZ } from './projection.ts';

export interface MinimapState {
  x: number; z: number;
  /** Player facing, compass degrees (0 = north). */
  headingDeg: number;
  graph: NavGraph;
  traffic: Iterable<XZ>;
  markers: Iterable<XZ>;
  waypoint?: XZ;
}

export const MARIGOLD = '#f2a81d';
export const SAFFRON = '#e07a1f';
const BG = 'rgba(27,29,34,0.82)';
const OUTLINE = '#111214';
const R = MINIMAP_PX / 2;
/** Edges with both ends further than this from the player (per axis) are skipped. */
const CULL_M = MINIMAP_RADIUS_M * 1.5;

/** Player triangle (pointing up) centred on the origin. */
export function drawPlayer(ctx: CanvasRenderingContext2D, px: number, py: number, headingDeg: number, size: number): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.75); ctx.lineTo(0, size * 0.4); ctx.lineTo(-size * 0.7, size * 0.75); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1.5, size * 0.18);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

export function drawDiamond(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(px, py - size); ctx.lineTo(px + size, py); ctx.lineTo(px, py + size); ctx.lineTo(px - size, py); ctx.closePath();
  ctx.fillStyle = fill; ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1.5, size * 0.25);
  ctx.fill(); ctx.stroke();
}

export function drawMarker(ctx: CanvasRenderingContext2D, px: number, py: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = MARIGOLD; ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1.5, radius * 0.35);
  ctx.fill(); ctx.stroke();
}

/** Round, north-up minimap centred on the player, drawn on a 2D canvas fixed to the bottom-left corner. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private batches = new Map<EdgeStyle, number[]>();

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = MINIMAP_PX; this.canvas.height = MINIMAP_PX;
    this.canvas.style.width = `${MINIMAP_CSS_PX}px`; this.canvas.style.height = `${MINIMAP_CSS_PX}px`;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(s: MinimapState): void {
    const ctx = this.ctx;
    const v = minimapView(s.x, s.z);
    ctx.clearRect(0, 0, MINIMAP_PX, MINIMAP_PX);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = BG; ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);

    this.drawEdges(v, s);

    ctx.fillStyle = '#7cc4ff'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const c of s.traffic) {
      const p = worldToMap(v, c.x, c.z);
      if ((p.px - R) ** 2 + (p.py - R) ** 2 > R * R) continue;
      ctx.moveTo(p.px + 4.5, p.py); ctx.arc(p.px, p.py, 4.5, 0, Math.PI * 2);
    }
    ctx.fill(); ctx.stroke();

    for (const m of s.markers) { const p = this.clampToRim(v, m.x, m.z, 14); drawMarker(ctx, p.px, p.py, 10); }
    if (s.waypoint) { const p = this.clampToRim(v, s.waypoint.x, s.waypoint.z, 16); drawDiamond(ctx, p.px, p.py, 13, SAFFRON); }
    drawPlayer(ctx, R, R, s.headingDeg, 20);
    ctx.restore();

    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232,226,214,0.7)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(R, 26, 19, 0, Math.PI * 2); ctx.fillStyle = OUTLINE; ctx.fill();
    ctx.font = 'bold 26px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.fillText('N', R, 27);
  }

  private drawEdges(v: MapView, s: MinimapState): void {
    const ctx = this.ctx;
    for (const b of this.batches.values()) b.length = 0;
    for (const e of s.graph.edges()) {
      if (e.removed) continue;
      const a = s.graph.node(e.from); const b = s.graph.node(e.to);
      if (!a || !b) continue;
      if ((Math.abs(a.x - s.x) > CULL_M || Math.abs(a.z - s.z) > CULL_M) && (Math.abs(b.x - s.x) > CULL_M || Math.abs(b.z - s.z) > CULL_M)) continue;
      const st = edgeStyle(e.cls);
      let batch = this.batches.get(st);
      if (!batch) { batch = []; this.batches.set(st, batch); }
      const pa = worldToMap(v, a.x, a.z); const pb = worldToMap(v, b.x, b.z);
      batch.push(pa.px, pa.py, pb.px, pb.py);
    }
    ctx.lineCap = 'round';
    // Paths first so roads draw over them.
    const order = [...this.batches.keys()].sort((p, q) => (p.kind === q.kind ? p.width - q.width : p.kind === 'path' ? -1 : 1));
    for (const st of order) {
      const b = this.batches.get(st)!;
      if (b.length === 0) continue;
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 4) { ctx.moveTo(b[i]!, b[i + 1]!); ctx.lineTo(b[i + 2]!, b[i + 3]!); }
      ctx.setLineDash(st.dash); ctx.strokeStyle = st.color; ctx.lineWidth = st.width;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Map position of a world point, pulled in to the rim (inset px) when it lies outside the round map. */
  private clampToRim(v: MapView, x: number, z: number, inset: number): { px: number; py: number } {
    const p = worldToMap(v, x, z);
    const dx = p.px - R; const dy = p.py - R; const d = Math.hypot(dx, dy); const max = R - inset;
    return d <= max ? p : { px: R + (dx / d) * max, py: R + (dy / d) * max };
  }
}
