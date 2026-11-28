import { describe, expect, it } from 'vitest';
import { generateLut, gradeColor, LUT_SIZE, sampleLut, type GradeKind, type RGB } from './luts.ts';

const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe('LUT generator', () => {
  for (const kind of ['day', 'night'] as const) {
    it(`${kind}: luminance is monotonic along the neutral ramp`, () => {
      let prev = -1;
      for (let i = 0; i <= 1024; i++) {
        const x = i / 1024;
        const l = luma(gradeColor(kind, [x, x, x]));
        expect(l, `x=${x}`).toBeGreaterThanOrEqual(prev);
        prev = l;
      }
    });

    it(`${kind}: monotonic through the sampled 32^3 table too`, () => {
      const data = generateLut(kind);
      let prev = -1;
      for (let i = 0; i < LUT_SIZE; i++) {
        const x = i / (LUT_SIZE - 1);
        const l = luma(sampleLut(data, LUT_SIZE, [x, x, x]));
        expect(l).toBeGreaterThanOrEqual(prev);
        prev = l;
      }
    });
  }

  it('identity LUT round-trips colours within 1/255', () => {
    const data = generateLut('identity');
    const rand = lcg(7);
    const colours: RGB[] = [];
    for (let i = 0; i < 300; i++) colours.push([rand(), rand(), rand()]);
    for (let i = 0; i < 8; i++) colours.push([i & 1, (i >> 1) & 1, (i >> 2) & 1]);
    for (const c of colours) {
      const out = sampleLut(data, LUT_SIZE, c);
      for (let k = 0; k < 3; k++) expect(Math.abs(out[k]! - c[k]!)).toBeLessThanOrEqual(1 / 255);
    }
  });

  it('day grade: warm highlights, teal shadows, lifted blacks, more saturation', () => {
    const hi = gradeColor('day', [0.9, 0.9, 0.9]);
    expect(hi[0] - hi[2]).toBeGreaterThan(0);
    const lo = gradeColor('day', [0.1, 0.1, 0.1]);
    expect(lo[1]).toBeGreaterThan(lo[0]);
    expect(lo[2]).toBeGreaterThan(lo[0]);
    const black = gradeColor('day', [0, 0, 0]);
    for (const v of black) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(0.06); }
    const spread = (c: RGB) => Math.max(...c) - Math.min(...c);
    expect(spread(gradeColor('day', [0.8, 0.3, 0.2]))).toBeGreaterThan(spread([0.8, 0.3, 0.2]));
    const mid = gradeColor('day', [0.5, 0.5, 0.5]);
    for (const v of mid) expect(Math.abs(v - 0.5)).toBeLessThan(0.08);
  });

  it('night grade: blue shadows, orange mids', () => {
    const lo = gradeColor('night', [0.1, 0.1, 0.1]);
    expect(lo[2]).toBeGreaterThan(lo[0]);
    const mid = gradeColor('night', [0.5, 0.5, 0.5]);
    expect(mid[0]).toBeGreaterThan(mid[2]);
  });

  it('table shape and range', () => {
    for (const kind of ['day', 'night', 'identity'] as GradeKind[]) {
      const data = generateLut(kind);
      expect(data.length).toBe(32 * 32 * 32 * 4);
      for (const v of data) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    const day = generateLut('day');
    const last = (32 * 32 * 32 - 1) * 4;
    const white = gradeColor('day', [1, 1, 1]);
    for (let k = 0; k < 3; k++) expect(day[last + k]!).toBeCloseTo(white[k]!, 6);
  }, 30_000); // builds three 32^3 tables; takes about 5 s on a loaded CI runner
});
