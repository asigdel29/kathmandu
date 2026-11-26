export type V3 = [number, number, number];
type F32 = Float32Array<ArrayBuffer>;
export interface MeshData { positions: F32; normals: F32; uvs: F32; styles: F32; colors?: F32; indices: Uint32Array<ArrayBuffer> }

/** Twice the signed area in the XZ plane. Negative => counter-clockwise when seen from +Y (three.js front face). */
export function shoelaceXZ(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i]!, q = pts[(i + 1) % pts.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return a;
}

export class MeshBuilder {
  private pos: number[] = []; private nrm: number[] = []; private uv: number[] = []; private sty: number[] = []; private idx: number[] = [];
  get vertexCount(): number { return this.pos.length / 3; }
  vertex(p: V3, n: V3, uv: [number, number], style: number): number {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.sty.push(style);
    return this.vertexCount - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  /** Triangle over existing vertices, reordered to face +Y. */
  triUp(a: number, b: number, c: number): void {
    const P = (i: number): [number, number] => [this.pos[i * 3]!, this.pos[i * 3 + 2]!];
    if (shoelaceXZ([P(a), P(b), P(c)]) > 0) [b, c] = [c, b];
    this.tri(a, b, c);
  }
  /** Horizontal triangle that must face up: reorders vertices if the XZ winding is wrong. */
  pushTriUp(a: V3, b: V3, c: V3, style: number): void {
    if (shoelaceXZ([[a[0], a[2]], [b[0], b[2]], [c[0], c[2]]]) > 0) [b, c] = [c, b];
    const n: V3 = [0, 1, 0];
    this.tri(this.vertex(a, n, [a[0], a[2]], style), this.vertex(b, n, [b[0], b[2]], style), this.vertex(c, n, [c[0], c[2]], style));
  }
  finish(): MeshData {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), uvs: new Float32Array(this.uv), styles: new Float32Array(this.sty), indices: new Uint32Array(this.idx) };
  }
}
