import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { UniformNode } from 'three/webgpu';
import { createRoadMaterial } from '../materials/road.ts';
import { Nav, PropsFile, TileMeta, type Manifest } from '@ktm/schema';

export type Lod = 0 | 1 | 2; // 0 = everything + physics, 1 = terrain+buildings+roads, 2 = terrain only
export interface LoadedTile { id: TileId; lod: Lod; group: THREE.Group; meta: TileMeta; height: Float32Array; props?: PropsFile; nav?: Nav; buildings?: THREE.Mesh[] }

export class TileLoader {
  private gltf = new GLTFLoader();
  private terrainMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 });
  private roadMats = new Map<string, THREE.Material>();
  /** wet: 0..1 uniform that drives asphalt gloss (see materials/road.ts); roads stay dry when omitted. */
  constructor(private base: string, private manifest: Manifest, private facade: THREE.Material, private wet?: UniformNode<'float'>) {}

  private url(id: TileId, file: string): string { return `${this.base}tiles/${id}/${this.manifest.tiles[id]!.hash}/${file}`; }
  private async json<T>(id: TileId, file: string, schema: { parse(v: unknown): T }): Promise<T> { const r = await fetch(this.url(id, file)); if (!r.ok) throw new Error(`${file}: ${r.status}`); return schema.parse(await r.json()); }
  private async glb(id: TileId, file: string): Promise<THREE.Group | undefined> {
    const r = await fetch(this.url(id, file)); if (r.status === 404) return undefined; if (!r.ok) throw new Error(`${file}: ${r.status}`);
    return (await this.gltf.parseAsync(await r.arrayBuffer(), '')).scene;
  }

  private roadMaterial(src: THREE.Material, wet: UniformNode<'float'>): THREE.Material {
    let m = this.roadMats.get(src.name);
    if (!m) { m = createRoadMaterial(src, wet); this.roadMats.set(src.name, m); }
    return m;
  }

  async load(id: TileId, lod: Lod): Promise<LoadedTile | undefined> {
    if (!this.manifest.tiles[id]) return undefined;
    const o = tileOrigin(id);
    const group = new THREE.Group(); group.name = id; group.position.set(o.x, 0, o.z);
    const [meta, heightBuf, terrain] = await Promise.all([this.json(id, 'meta.json', TileMeta), fetch(this.url(id, 'height.f32')).then((r) => r.arrayBuffer()), this.glb(id, 'terrain.glb')]);
    const height = new Float32Array(heightBuf);
    if (terrain) { terrain.traverse((m) => { if (m instanceof THREE.Mesh) { m.material = this.terrainMat; m.receiveShadow = true; } }); group.add(terrain); }
    const tile: LoadedTile = { id, lod, group, meta, height };
    if (lod <= 1) {
      const [b, r, w] = await Promise.all([this.glb(id, 'buildings.glb'), this.glb(id, 'roads.glb'), this.glb(id, 'water.glb')]);
      tile.buildings = [];
      b?.traverse((m) => { if (m instanceof THREE.Mesh) { m.material = this.facade; m.castShadow = true; m.receiveShadow = true; tile.buildings!.push(m); } });
      r?.traverse((m) => { if (m instanceof THREE.Mesh) { m.receiveShadow = true; if (this.wet && m.material instanceof THREE.Material) m.material = this.roadMaterial(m.material, this.wet); } });
      for (const g of [b, r, w]) if (g) group.add(g);
    }
    if (lod === 0) { [tile.props, tile.nav] = await Promise.all([this.json(id, 'props.json', PropsFile), this.json(id, 'nav.json', Nav)]); }
    return tile;
  }
}
