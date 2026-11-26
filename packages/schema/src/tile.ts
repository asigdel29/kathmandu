import { z } from 'zod';

export const TileIdSchema = z.string().regex(/^x\d{2}_y\d{2}$/, 'tile id like x14_y17');
export const TileKind = z.enum(['content', 'terrain']);
export const ZoneId = z.enum(['old-core', 'patan-core', 'bhaktapur-core', 'kirtipur-core', 'commercial', 'suburb', 'hills', 'industrial', 'airport']);
export const StyleId = z.enum(['newari_brick', 'rcc_plaster_white', 'rcc_plaster_pastel', 'rcc_unfinished', 'commercial_glass', 'tin_shed', 'temple_brick', 'institutional']);
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const TileMeta = z.object({
  id: TileIdSchema,
  version: z.literal(1),
  kind: TileKind,
  origin: z.object({ x: z.number(), z: z.number() }),
  baseY: z.number(),
  zone: ZoneId,
  counts: z.object({
    buildings: z.number().int().nonnegative(),
    roadSegments: z.number().int().nonnegative(),
    props: z.number().int().nonnegative(),
    navNodes: z.number().int().nonnegative(),
  }),
  triangles: z.object({ terrain: z.number().int(), buildings: z.number().int(), roads: z.number().int(), water: z.number().int() }),
  bytes: z.record(z.string(), z.number().int()),
  inputsHash: Sha256,
  builtAt: z.iso.datetime(),
});
export type TileMeta = z.infer<typeof TileMeta>;

export const Manifest = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  tileSize: z.literal(800),
  baseUrl: z.url(),
  grid: z.object({ cols: z.number().int(), rows: z.number().int(), xMin: z.number(), zMax: z.number() }),
  tiles: z.record(TileIdSchema, z.object({ hash: Sha256, kind: TileKind, zone: ZoneId, buildings: z.number().int() })),
  heroes: z.record(z.string(), z.object({ tile: TileIdSchema, url: z.url(), sha256: Sha256 })),
});
export type Manifest = z.infer<typeof Manifest>;
