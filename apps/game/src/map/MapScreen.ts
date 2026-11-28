import { lonLatToLocal, TILE_SIZE_M, tileBounds, tileOrigin, type TileId } from '@ktm/geo';
import type { Manifest } from '@ktm/schema';
import type { NavGraph } from '../traffic/NavGraph.ts';
import { edgeStyle, type EdgeStyle } from './edgeStyle.ts';
import { drawDiamond, drawMarker, drawPlayer, MARIGOLD, SAFFRON } from './Minimap.ts';
import { mapToWorld, panView, worldToMap, zoomViewAt, type MapView, type XZ } from './projection.ts';

export interface HeroInfo { slug: string; name: string; lat: number; lon: number }
export interface MapScreenState { x: number; z: number; headingDeg: number; graph: NavGraph; markers: Iterable<XZ>; waypoint?: XZ }
interface Landmark { name: string; x: number; z: number }

/** Default and limit scales, CSS pixels per metre. */
export const MAP_DEFAULT_PX_PER_M = 0.12;
export const MAP_MIN_PX_PER_M = 0.01;
export const MAP_MAX_PX_PER_M = 4;
/** A press that moves less than this (CSS px) is a click, not a drag. */
const CLICK_SLOP_PX = 4;
/** Clicking this close (CSS px) to the waypoint removes it. */
const WAYPOINT_HIT_PX = 12;

/** Landmarks listed in the manifest, placed at their catalog lon/lat, else at the centre of their tile. */
export function resolveLandmarks(manifest: Manifest, heroes: readonly HeroInfo[]): Landmark[] {
  const bySlug = new Map(heroes.map((h) => [h.slug, h]));
  return Object.entries(manifest.heroes).map(([slug, m]) => {
    const h = bySlug.get(slug);
    if (h) { const p = lonLatToLocal(h.lon, h.lat); return { name: h.name, x: p.x, z: p.z }; }
    const o = tileOrigin(m.tile);
    return { name: slug, x: o.x + TILE_SIZE_M / 2, z: o.z + TILE_SIZE_M / 2 };
  });
}

/** Full-screen north-up map: the manifest grid with content tiles shaded, loaded nav edges, landmarks, markers and a waypoint. */
export class MapScreen {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private landmarks: Landmark[];
  private tiles: { id: TileId; content: boolean }[];
  private view: MapView = { cx: 0, cz: 0, pxPerM: MAP_DEFAULT_PX_PER_M, width: 1, height: 1 };
  private dpr = 1;
  private open_ = false;
  private drag?: { id: number; x: number; y: number; moved: number };
  private waypoint?: XZ;
  private batches = new Map<EdgeStyle, number[]>();

  constructor(parent: HTMLElement, manifest: Manifest, heroes: readonly HeroInfo[], private onWaypoint: (p: XZ | undefined) => void) {
    this.landmarks = resolveLandmarks(manifest, heroes);
    this.tiles = Object.entries(manifest.tiles).map(([id, t]) => ({ id: id as TileId, content: t.kind === 'content' }));
    this.el = document.createElement('div');
    this.el.id = 'map-screen';
    this.canvas = document.createElement('canvas');
    const help = document.createElement('div');
    help.className = 'map-help';
    help.textContent = 'drag to pan · wheel to zoom · click to set waypoint · M to close';
    this.el.append(this.canvas, help);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d')!;

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => { this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x; const dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY; d.moved += Math.hypot(dx, dy);
      if (d.moved >= CLICK_SLOP_PX) this.view = panView(this.view, dx * this.dpr, dy * this.dpr);
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = undefined;
      if (d.moved < CLICK_SLOP_PX) this.click(e.offsetX * this.dpr, e.offsetY * this.dpr);
    });
    c.addEventListener('pointercancel', () => { this.drag = undefined; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view = zoomViewAt(this.view, e.offsetX * this.dpr, e.offsetY * this.dpr, Math.pow(1.0015, -e.deltaY), MAP_MIN_PX_PER_M * this.dpr, MAP_MAX_PX_PER_M * this.dpr);
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.open_) this.resize(); });
  }

  get isOpen(): boolean { return this.open_; }

  /** Show the map centred on (x, z) at the default scale. */
  open(x: number, z: number): void {
    this.open_ = true;
    this.el.style.display = 'block';
    this.resize();
    this.view = { ...this.view, cx: x, cz: z, pxPerM: MAP_DEFAULT_PX_PER_M * this.dpr };
  }

  close(): void { this.open_ = false; this.el.style.display = 'none'; this.drag = undefined; }

  /** Returns true when the map is now open. */
  toggle(x: number, z: number): boolean { if (this.open_) this.close(); else this.open(x, z); return this.open_; }

  private resize(): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(window.innerWidth * this.dpr)); const h = Math.max(1, Math.round(window.innerHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.view = { ...this.view, width: w, height: h };
  }

  private click(px: number, py: number): void {
    if (this.waypoint) {
      const p = worldToMap(this.view, this.waypoint.x, this.waypoint.z);
      if (Math.hypot(p.px - px, p.py - py) <= WAYPOINT_HIT_PX * this.dpr) { this.waypoint = undefined; this.onWaypoint(undefined); return; }
    }
    const w = mapToWorld(this.view, px, py);
    this.waypoint = w;
    this.onWaypoint(w);
  }

  draw(s: MapScreenState): void {
    if (!this.open_) return;
    this.waypoint = s.waypoint;
    const ctx = this.ctx; const v = this.view; const k = this.dpr;
    ctx.fillStyle = '#121418';
    ctx.fillRect(0, 0, v.width, v.height);

    // Manifest grid: content tiles shaded, terrain tiles dark, faint cell outlines.
    const side = TILE_SIZE_M * v.pxPerM;
    for (const content of [false, true]) {
      ctx.beginPath();
      for (const t of this.tiles) {
        if (t.content !== content) continue;
        const b = tileBounds(t.id);
        const p = worldToMap(v, b.minX, b.minZ);
        if (p.px > v.width || p.py > v.height || p.px + side < 0 || p.py + side < 0) continue;
        ctx.rect(p.px, p.py, side, side);
      }
      ctx.fillStyle = content ? '#3b4049' : '#1f2226';
      ctx.fill();
      if (side > 12) { ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke(); }
    }

    // Loaded nav edges, at the minimap's CSS widths for its scale (1/3 CSS px per metre), growing and shrinking with the zoom.
    const scale = (k / 2) * Math.min(3, Math.max(0.5, (v.pxPerM / k) * 3));
    for (const b of this.batches.values()) b.length = 0;
    for (const e of s.graph.edges()) {
      if (e.removed) continue;
      const a = s.graph.node(e.from); const b = s.graph.node(e.to);
      if (!a || !b) continue;
      const pa = worldToMap(v, a.x, a.z); const pb = worldToMap(v, b.x, b.z);
      if ((pa.px < 0 && pb.px < 0) || (pa.py < 0 && pb.py < 0) || (pa.px > v.width && pb.px > v.width) || (pa.py > v.height && pb.py > v.height)) continue;
      const st = edgeStyle(e.cls);
      let batch = this.batches.get(st);
      if (!batch) { batch = []; this.batches.set(st, batch); }
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
      ctx.setLineDash(st.dash.map((d) => d * k)); ctx.strokeStyle = st.color; ctx.lineWidth = Math.max(k, st.width * scale);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Landmarks: white dot with a marigold ring and a label.
    ctx.font = `${12 * k}px ui-monospace, monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const l of this.landmarks) {
      const p = worldToMap(v, l.x, l.z);
      if (p.px < -200 * k || p.py < -20 * k || p.px > v.width + 20 * k || p.py > v.height + 20 * k) continue;
      ctx.beginPath(); ctx.arc(p.px, p.py, 5 * k, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = MARIGOLD; ctx.lineWidth = 2.5 * k; ctx.stroke();
      ctx.lineWidth = 3 * k; ctx.strokeStyle = '#000000'; ctx.strokeText(l.name, p.px + 9 * k, p.py);
      ctx.fillStyle = '#f4efe6'; ctx.fillText(l.name, p.px + 9 * k, p.py);
    }

    for (const m of s.markers) { const p = worldToMap(v, m.x, m.z); drawMarker(ctx, p.px, p.py, 6 * k); }
    if (s.waypoint) { const p = worldToMap(v, s.waypoint.x, s.waypoint.z); drawDiamond(ctx, p.px, p.py, 8 * k, SAFFRON); }
    const me = worldToMap(v, s.x, s.z);
    drawPlayer(ctx, me.px, me.py, s.headingDeg, 10 * k);
  }
}
