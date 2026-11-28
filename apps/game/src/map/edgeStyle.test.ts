import { describe, expect, it } from 'vitest';
import { edgeStyle } from './edgeStyle.ts';

describe('edgeStyle', () => {
  it('draws foot classes as dotted paths', () => {
    for (const cls of ['footway', 'path', 'pedestrian', 'track', 'steps']) {
      const s = edgeStyle(cls);
      expect(s.kind).toBe('path');
      expect(s.dash.length).toBeGreaterThan(0);
    }
  });

  it('draws everything else as solid light grey roads, wider for major classes', () => {
    const p = edgeStyle('primary'); const t = edgeStyle('tertiary'); const r = edgeStyle('residential');
    for (const s of [p, t, r, edgeStyle('unknown_class')]) { expect(s.kind).toBe('road'); expect(s.dash).toEqual([]); expect(s.color).toBe('#d4d4d4'); }
    expect(p.width).toBeGreaterThan(t.width);
    expect(t.width).toBeGreaterThan(r.width);
  });
});
