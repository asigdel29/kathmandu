import { Document, NodeIO, Primitive } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import type { MeshData } from './mesh.ts';

export interface PrimSpec { name: string; data: MeshData; baseColor: [number, number, number, number]; roughness?: number; metallic?: number; withStyle?: boolean; withColor?: boolean }

export async function writeGlb(path: string, prims: PrimSpec[]): Promise<{ bytes: number; triangles: number }> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const node = doc.createNode('tile');
  doc.createScene('scene').addChild(node);
  const mesh = doc.createMesh('mesh');
  node.setMesh(mesh);
  let triangles = 0;
  for (const p of prims) {
    if (p.data.indices.length === 0) continue;
    const acc = (arr: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, type: 'VEC3' | 'VEC2' | 'SCALAR') => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = doc.createPrimitive().setMode(Primitive.Mode.TRIANGLES!).setName(p.name)
      .setAttribute('POSITION', acc(p.data.positions, 'VEC3'))
      .setAttribute('NORMAL', acc(p.data.normals, 'VEC3'))
      .setAttribute('TEXCOORD_0', acc(p.data.uvs, 'VEC2'))
      .setIndices(acc(p.data.indices, 'SCALAR'));
    if (p.withStyle) prim.setAttribute('_STYLE', acc(p.data.styles, 'SCALAR'));
    if (p.withColor && p.data.colors) prim.setAttribute('COLOR_0', acc(p.data.colors, 'VEC3'));
    prim.setMaterial(doc.createMaterial(p.name).setBaseColorFactor(p.baseColor).setRoughnessFactor(p.roughness ?? 0.85).setMetallicFactor(p.metallic ?? 0));
    mesh.addPrimitive(prim);
    triangles += p.data.indices.length / 3;
  }
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, pattern: /^(POSITION|NORMAL|TEXCOORD_0)$/ }));
  // quantize() adds KHR_mesh_quantization to the document; the writer must know it or the extension is dropped.
  const glb = await new NodeIO().registerExtensions([KHRMeshQuantization]).writeBinary(doc);
  await Bun.write(path, glb);
  return { bytes: glb.byteLength, triangles };
}
