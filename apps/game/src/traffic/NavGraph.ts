import { tileOrigin, type TileId } from '@ktm/geo';
import type { Nav } from '@ktm/schema';

/** A nav node in world coordinates. */
export interface GraphNode { id: string; x: number; y: number; z: number }

export interface GraphEdge {
  /** Unique and never reused, so holders can tell a reloaded tile's edge from the old one. */
  id: number;
  /** Tile that contributed the edge. */
  tile: TileId;
  from: string; to: string;
  lanes: number; oneway: boolean;
  /** Speed limit, km/h. */
  speed: number;
  cls: string;
  /** Carriageway width, m. */
  width: number;
  /** Horizontal (XZ) distance between the end nodes, m. */
  length: number;
  /** Set once the edge's tile has been removed. */
  removed: boolean;
}

/** A way to leave a node: traverse `edge` from -> to (forward) or to -> from. */
export interface Exit { edge: GraphEdge; forward: boolean }

interface NodeEntry { node: GraphNode; tiles: Set<TileId>; edges: Set<GraphEdge> }

/**
 * Road graph of the loaded tiles. Node ids are world coordinates quantised to 1 cm, identical in every tile that
 * contains the point, so tiles stitch by id: a border node is one node with edges from both sides.
 */
export class NavGraph {
  private entries = new Map<string, NodeEntry>();
  private tiles = new Map<TileId, { nav: Nav; edges: GraphEdge[]; nodes: string[] }>();
  private nextEdgeId = 1;
  private edgeTotal = 0;
  private _version = 0;

  /** Bumped on every add or remove. */
  get version(): number { return this._version; }
  get nodeCount(): number { return this.entries.size; }
  get edgeCount(): number { return this.edgeTotal; }

  hasTile(id: TileId): boolean { return this.tiles.has(id); }

  addTile(id: TileId, nav: Nav): void {
    if (this.tiles.has(id)) return;
    const o = tileOrigin(id);
    const nodes: string[] = [];
    for (const n of nav.nodes) {
      let e = this.entries.get(n.id);
      if (!e) { e = { node: { id: n.id, x: o.x + n.x, y: n.y, z: o.z + n.z }, tiles: new Set(), edges: new Set() }; this.entries.set(n.id, e); }
      if (!e.tiles.has(id)) { e.tiles.add(id); nodes.push(n.id); }
    }
    const edges: GraphEdge[] = [];
    for (const r of nav.edges) {
      const a = this.entries.get(r.from); const b = this.entries.get(r.to);
      if (!a || !b) continue; // dangling reference; the validator should have caught it
      const edge: GraphEdge = {
        id: this.nextEdgeId++, tile: id, from: r.from, to: r.to, lanes: r.lanes, oneway: r.oneway, speed: r.speed, cls: r.cls, width: r.width,
        length: Math.hypot(b.node.x - a.node.x, b.node.z - a.node.z), removed: false,
      };
      a.edges.add(edge); b.edges.add(edge);
      edges.push(edge);
    }
    this.edgeTotal += edges.length;
    this.tiles.set(id, { nav, edges, nodes });
    this._version++;
  }

  /** Drops the tile's edges; a node survives while another loaded tile still references it. */
  removeTile(id: TileId): void {
    const t = this.tiles.get(id);
    if (!t) return;
    for (const edge of t.edges) {
      edge.removed = true;
      this.entries.get(edge.from)?.edges.delete(edge);
      this.entries.get(edge.to)?.edges.delete(edge);
    }
    for (const nid of t.nodes) {
      const e = this.entries.get(nid);
      if (!e) continue;
      e.tiles.delete(id);
      if (e.tiles.size === 0) this.entries.delete(nid);
    }
    this.edgeTotal -= t.edges.length;
    this.tiles.delete(id);
    this._version++;
  }

  /** Reconcile with the streamer's loaded tiles: entries without a nav are ignored, a changed nav object replaces the tile. */
  sync(tiles: Iterable<{ id: TileId; nav?: Nav }>): void {
    const want = new Map<TileId, Nav>();
    for (const t of tiles) if (t.nav) want.set(t.id, t.nav);
    for (const [id, t] of this.tiles) if (want.get(id) !== t.nav) this.removeTile(id);
    for (const [id, nav] of want) if (!this.tiles.has(id)) this.addTile(id, nav);
  }

  node(id: string): GraphNode | undefined { return this.entries.get(id)?.node; }
  *nodes(): IterableIterator<GraphNode> { for (const e of this.entries.values()) yield e.node; }
  *edges(): IterableIterator<GraphEdge> { for (const t of this.tiles.values()) yield* t.edges; }
  edgesAt(nodeId: string): GraphEdge[] { const e = this.entries.get(nodeId); return e ? [...e.edges] : []; }
  degree(nodeId: string): number { return this.entries.get(nodeId)?.edges.size ?? 0; }

  /** Edges that may be driven away from `nodeId`; oneway edges only from their `from` end. */
  exits(nodeId: string): Exit[] {
    const out: Exit[] = [];
    for (const edge of this.entries.get(nodeId)?.edges ?? []) {
      if (edge.from === nodeId) out.push({ edge, forward: true });
      if (edge.to === nodeId && !edge.oneway && edge.from !== nodeId) out.push({ edge, forward: false });
    }
    return out;
  }

  /** Connected components over the nodes, ignoring direction. */
  componentCount(): number {
    const seen = new Set<string>();
    let count = 0;
    for (const start of this.entries.keys()) {
      if (seen.has(start)) continue;
      count++;
      const stack = [start]; seen.add(start);
      while (stack.length > 0) {
        const id = stack.pop()!;
        for (const edge of this.entries.get(id)!.edges) {
          for (const n of [edge.from, edge.to]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
    }
    return count;
  }
}
