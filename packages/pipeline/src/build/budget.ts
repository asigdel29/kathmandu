import type { Prop } from '@ktm/schema';
import type { Hash } from './props.ts';

/**
 * Types that may be thinned when a tile is over budget, with a weight: a type keeps min(1, f * weight) of its props,
 * with one common f. Poles, wires, lights, trees, roof tanks, banners and curated props are never thinned.
 */
const ELASTIC: Partial<Record<Prop['type'], number>> = {
  sign: 1, awning: 1.3, shutter: 0.8, parked_bike: 1, rooftop_clutter: 1, parapet_pots: 0.7, rubbish_pile: 1, puddle: 1, vendor_cart: 2,
};

const posKey = (p: Prop): string => `${p.type}:${p.x.toFixed(2)}:${p.z.toFixed(2)}`;

/**
 * Keep at most `limit` props. The elastic types are thinned by a common fraction so every kind stays represented;
 * within a type the props with the smallest hash of their position survive, so the result is deterministic and
 * evenly spread. If the fixed props alone exceed the limit, trees are dropped last.
 * Returns the kept props (input order) and how many were dropped per type.
 */
export function capProps(props: Prop[], limit: number, hash: Hash): { props: Prop[]; dropped: Record<string, number> } {
  const dropped: Record<string, number> = {};
  if (props.length <= limit) return { props, dropped };
  const counts = new Map<Prop['type'], number>();
  for (const p of props) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  let fixed = 0; for (const [t, n] of counts) if (!(t in ELASTIC)) fixed += n;
  const keepOf = (f: number): Map<Prop['type'], number> => {
    const m = new Map<Prop['type'], number>();
    for (const [t, w] of Object.entries(ELASTIC) as [Prop['type'], number][]) m.set(t, Math.floor((counts.get(t) ?? 0) * Math.min(1, f * w)));
    return m;
  };
  const total = (m: Map<Prop['type'], number>): number => { let s = fixed; for (const v of m.values()) s += v; return s; };
  let lo = 0, hi = 1;
  for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (total(keepOf(mid)) <= limit) lo = mid; else hi = mid; }
  const keep = keepOf(lo);
  const drop = new Set<number>();
  for (const [type, k] of keep) {
    const idx: { i: number; h: number }[] = [];
    props.forEach((p, i) => { if (p.type === type) idx.push({ i, h: hash(posKey(p)) }); });
    idx.sort((a, b) => a.h - b.h || a.i - b.i);
    for (let j = k; j < idx.length; j++) drop.add(idx[j]!.i);
    if (idx.length > k) dropped[type] = idx.length - k;
  }
  let kept = props.filter((_, i) => !drop.has(i));
  if (kept.length > limit) {
    // The fixed props alone are over the limit: drop trees with the highest hash first.
    const trees = kept.map((p, i) => ({ i, h: p.type === 'tree' ? hash(posKey(p)) : -1 })).filter((t) => t.h >= 0).sort((a, b) => b.h - a.h);
    const cut = new Set(trees.slice(0, kept.length - limit).map((t) => t.i));
    dropped.tree = cut.size;
    kept = kept.filter((_, i) => !cut.has(i));
  }
  return { props: kept, dropped };
}
