import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tileOrigin, type TileId } from '@ktm/geo';
import type { UniformNode } from 'three/webgpu';
import { Nav, PropsFile, TileMeta, type Manifest } from '@ktm/schema';
import { createRoadMarkings, createRoadMaterials, loadRoadTextures, roadMaterialFor, type RoadMaterials } from '../materials/road.ts';
import { createTerrainMaterial, loadTerrainTextures } from '../materials/terrain.ts';
import { createWaterMaterial } from '../materials/water.ts';

export type Lod = 0 | 1 | 2; // 0 = everything + physics, 1 = terrain+buildings+roads, 2 = terrain only
export interface LoadedTile { id: TileId; lod: Lod; group: THREE.Group; meta: TileMeta; height: Float32Array; props?: PropsFile; nav?: Nav; buildings?: THREE.Mesh[] }

/** Ground, road and river materials shared by every tile. */
export interface SurfaceMaterials { terrain: THREE.Material; roads: RoadMaterials; water: THREE.Material }
/** wet: 0..1 uniform that drives asphalt gloss (see materials/road.ts); roads stay dry when omitted. */
export function createSurfaceMaterials(textureBase: string, wet?: UniformNode<'float'>): SurfaceMaterials {
  return {
    terrain: createTerrainMaterial(loadTerrainTextures(textureBase)),
    roads: createRoadMaterials(loadRoadTextures(textureBase), wet),
    water: createWaterMaterial(),
  };
}

export class TileLoader {
  private gltf = new GLTFLoader();
  constructor(
    private base: string, private manifest: Manifest, private facade: THREE.Material,
    private surfaces: SurfaceMaterials = createSurfaceMaterials(`${import.meta.env.BASE_URL}textures/`),
  ) {}

  private url(id: TileId, file: string): string { return `${this.base}tiles/${id}/${this.manifest.tiles[id]!.hash}/${file}`; }
  private async json<T>(id: TileId, file: string, schema: { parse(v: unknown): T }): Promise<T> { const r = await fetch(this.url(id, file)); if (!r.ok) throw new Error(`${file}: ${r.status}`); return schema.parse(await r.json()); }
  private async glb(id: TileId, file: string): Promise<THREE.Group | undefined> {
    const r = await fetch(this.url(id, file)); if (r.status === 404) return undefined; if (!r.ok) throw new Error(`${file}: ${r.status}`);
    return (await this.gltf.parseAsync(await r.arrayBuffer(), '')).scene;
  }

  async load(id: TileId, lod: Lod): Promise<LoadedTile | undefined> {
    if (!this.manifest.tiles[id]) return undefined;
    const o = tileOrigin(id);
    const group = new THREE.Group(); group.name = id; group.position.set(o.x, 0, o.z);
    const [meta, heightBuf, terrain] = await Promise.all([this.json(id, 'meta.json', TileMeta), fetch(this.url(id, 'height.f32')).then((r) => r.arrayBuffer()), this.glb(id, 'terrain.glb')]);
    const height = new Float32Array(heightBuf);
    if (terrain) { terrain.traverse((m) => { if (m instanceof THREE.Mesh) { m.material = this.surfaces.terrain; m.receiveShadow = true; } }); group.add(terrain); }
    const tile: LoadedTile = { id, lod, group, meta, height };
    if (lod <= 1) {
      const [b, r, w] = await Promise.all([this.glb(id, 'buildings.glb'), this.glb(id, 'roads.glb'), this.glb(id, 'water.glb')]);
      tile.buildings = [];
      b?.traverse((m) => { if (m instanceof THREE.Mesh) { m.material = this.facade; m.castShadow = true; m.receiveShadow = true; tile.buildings!.push(m); } });
      r?.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        m.receiveShadow = true;
        const mat = roadMaterialFor((m.material as THREE.Material).name, meta.zone, this.surfaces.roads);
        if (mat) m.material = mat;
      });
      w?.traverse((m) => { if (m instanceof THREE.Mesh) { m.material = this.surfaces.water; m.renderOrder = 2; } });
      for (const g of [b, r, w]) if (g) group.add(g);
    }
    if (lod === 0) {
      [tile.props, tile.nav] = await Promise.all([this.json(id, 'props.json', PropsFile), this.json(id, 'nav.json', Nav)]);
      // Lane dashes and zebra crossings come from the nav graph, so only the full-detail ring has them.
      group.add(createRoadMarkings(tile.nav, height, this.surfaces.roads));
    }
    return tile;
  }
}
