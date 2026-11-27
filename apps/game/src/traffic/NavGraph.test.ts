import { describe, expect, it } from 'vitest';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { Nav } from '@ktm/schema';
import { NavGraph } from './NavGraph.ts';

const A: TileId = 'x14_y17';
const B: TileId = 'x15_y17'; // east of A

const id = (wx: number, wz: number) => `n_${Math.round(wx * 100)}_${Math.round(wz * 100)}`;
const edge = (from: string, to: string, oneway = false) => ({ from, to, lanes: 2, oneway, speed: 25, cls: 'residential', width: 6 });

/** A straight road along local z = 400 from x0 to x2 through x1, as tile `tile` would export it. */
function road(tile: TileId, xs: number[], borderAt: number[] = []): Nav {
  const o = tileOrigin(tile);
  const nodes = xs.map((x) => ({ id: id(o.x + x, o.z + 400), x, y: 10, z: 400, border: borderAt.includes(x) }));
  const edges = nodes.slice(1).map((n, i) => edge(nodes[i]!.id, n.id));
  return { nodes, edges };
}

const navA = () => road(A, [600, 700, 800], [800]);
const navB = () => road(B, [0, 100, 200], [0]);
const shared = () => { const o = tileOrigin(B); return id(o.x, o.z + 400); };

describe('NavGraph', () => {
  it('stitches two tiles sharing a border node into one connected graph', () => {
    const a = navA(); const b = navB();
    expect(a.nodes[2]!.id).toBe(b.nodes[0]!.id);
    const g = new NavGraph();
    g.addTile(A, a); g.addTile(B, b);
    const union = new Set([...a.nodes, ...b.nodes].map((n) => n.id));
    expect(g.nodeCount).toBe(union.size);
    expect(g.nodeCount).toBe(5);
    expect(g.edgeCount).toBe(a.edges.length + b.edges.length);
    expect(g.componentCount()).toBe(1);
    expect(g.degree(shared())).toBe(2);
  });

  it('removing a tile drops its edges but keeps the shared node while the neighbour is loaded', () => {
    const a = navA(); const b = navB();
    const g = new NavGraph();
    g.addTile(A, a); g.addTile(B, b);
    const aEdges = [...g.edges()].filter((e) => e.tile === A);
    g.removeTile(A);
    expect(g.hasTile(A)).toBe(false);
    expect(g.edgeCount).toBe(2);
    expect(g.node(shared())).toBeDefined();
    expect(g.degree(shared())).toBe(1);
    expect(g.node(a.nodes[0]!.id)).toBeUndefined();
    expect(g.node(a.nodes[1]!.id)).toBeUndefined();
    expect(aEdges.every((e) => e.removed)).toBe(true);
    expect(g.nodeCount).toBe(3);
    g.removeTile(B);
    expect(g.nodeCount).toBe(0);
    expect(g.edgeCount).toBe(0);
    expect(g.componentCount()).toBe(0);
  });

  it('keeps two components apart when no node is shared', () => {
    const g = new NavGraph();
    g.addTile(A, road(A, [100, 200]));
    g.addTile(B, road(B, [100, 200]));
    expect(g.componentCount()).toBe(2);
  });

  it('honours oneway in exits()', () => {
    const o = tileOrigin(A);
    const n = [0, 1, 2].map((i) => ({ id: id(o.x + i * 10, o.z), x: i * 10, y: 0, z: 0, border: false }));
    const g = new NavGraph();
    g.addTile(A, { nodes: n, edges: [edge(n[0]!.id, n[1]!.id, true), edge(n[1]!.id, n[2]!.id)] });
    const at = (nid: string) => g.exits(nid).map((x) => [x.edge.from, x.edge.to, x.forward]);
    expect(at(n[0]!.id)).toEqual([[n[0]!.id, n[1]!.id, true]]);
    expect(at(n[1]!.id)).toEqual([[n[1]!.id, n[2]!.id, true]]);
    expect(at(n[2]!.id)).toEqual([[n[1]!.id, n[2]!.id, false]]);
    expect(g.degree(n[1]!.id)).toBe(2);
    expect(g.edgesAt(n[1]!.id)).toHaveLength(2);
  });

  it('stores world positions and XZ edge lengths', () => {
    const o = tileOrigin(A);
    const p = { id: id(o.x + 10, o.z + 20), x: 10, y: 5, z: 20, border: false };
    const q = { id: id(o.x + 13, o.z + 24), x: 13, y: 50, z: 24, border: false };
    const g = new NavGraph();
    g.addTile(A, { nodes: [p, q], edges: [edge(p.id, q.id)] });
    expect(g.node(p.id)).toEqual({ id: p.id, x: o.x + 10, y: 5, z: o.z + 20 });
    expect([...g.edges()][0]!.length).toBeCloseTo(5, 9);
  });

  it('sync() adds, removes and replaces tiles', () => {
    const g = new NavGraph();
    const a = navA(); const b = navB();
    const v0 = g.version;
    g.sync([{ id: A, nav: a }, { id: B }]);
    expect(g.hasTile(A)).toBe(true);
    expect(g.hasTile(B)).toBe(false);
    const v1 = g.version;
    expect(v1).toBeGreaterThan(v0);
    g.sync([{ id: A, nav: a }]);
    expect(g.version).toBe(v1);
    g.sync([{ id: A, nav: a }, { id: B, nav: b }]);
    expect(g.edgeCount).toBe(4);
    const before = [...g.edges()].filter((e) => e.tile === A);
    g.sync([{ id: A, nav: navA() }, { id: B, nav: b }]);
    expect(before.every((e) => e.removed)).toBe(true);
    expect(g.edgeCount).toBe(4);
    g.sync([{ id: B, nav: b }]);
    expect(g.hasTile(A)).toBe(false);
    expect(g.edgeCount).toBe(2);
    expect(g.version).toBeGreaterThan(v1);
  });
});
