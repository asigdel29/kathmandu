import styles from '../../../../world/style/building-styles.json';

/** Style names in StyleId order (the `_style` vertex attribute indexes this list). */
export const FACADE_STYLES: readonly string[] = styles.styles;
export const STYLE_COUNT = FACADE_STYLES.length;
/** Pitched roof slopes use the clay tile set. */
export const TILE_ROOF_INDEX = FACADE_STYLES.indexOf('tile_roof');
/** Flat roofs of every style use the rough concrete set. */
export const FLAT_ROOF_INDEX = FACADE_STYLES.indexOf('rcc_unfinished');

export type TextureKind = 'diff' | 'nor' | 'rough';
/** Texture edge in pixels per kind inside the GPU arrays. Files are 1024 px; normals and roughness are halved on load. */
export const KIND_SIZE: Record<TextureKind, number> = { diff: 1024, nor: 512, rough: 512 };

const at = (name: string): number => { const i = FACADE_STYLES.indexOf(name); if (i < 0) throw new Error(`unknown style ${name}`); return i; };
const perStyle = <T>(byName: Record<string, T>): T[] => FACADE_STYLES.map((s) => { const v = byName[s]; if (v === undefined) throw new Error(`missing entry for ${s}`); return v; });

/** Metres of wall per texture repeat. */
export const STYLE_TILING_M: number[] = perStyle({
  newari_brick: 2.4, rcc_plaster_white: 3, rcc_plaster_pastel: 3, rcc_unfinished: 2, commercial_glass: 3,
  tin_shed: 1.2, temple_brick: 2.4, institutional: 3, tile_roof: 2,
});

/** Linear RGB multiplier on the diffuse map (plaster tints; values above 1 brighten dull sets). */
export const STYLE_TINT: [number, number, number][] = perStyle<[number, number, number]>({
  newari_brick: [0.9, 0.78, 0.76],
  rcc_plaster_white: [1.15, 1.15, 1.05],
  rcc_plaster_pastel: [1.74, 1.61, 1.32],
  rcc_unfinished: [1.6, 1.63, 1.62],
  commercial_glass: [1.0, 1.8, 2.8],
  tin_shed: [0.11, 0.35, 0.9],
  temple_brick: [0.95, 0.72, 0.68],
  institutional: [2.05, 2.3, 2.5],
  tile_roof: [1.0, 0.88, 0.8],
});

export const STYLE_IS_BRICK = [at('newari_brick'), at('temple_brick')];

export const FACADE_TEXTURE_FILES: string[] = FACADE_STYLES.flatMap((s) => (['diff', 'nor', 'rough'] as const).map((k) => `${s}_${k}.jpg`));

export function facadeTextureUrl(base: string, style: string, kind: TextureKind): string {
  return `${base}textures/facades/${style}_${kind}.jpg`;
}
