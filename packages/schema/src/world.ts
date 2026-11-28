import { z } from 'zod';
import { Sha256, StyleId, ZoneId, TileIdSchema } from './tile.ts';

export const BuildingOverride = z.object({
  levels: z.number().int().min(1).max(40).optional(),
  height: z.number().positive().optional(),
  style: StyleId.optional(),
  roof: z.enum(['flat', 'pitched']).optional(),
  remove: z.boolean().optional(),
  name: z.string().optional(),
}).strict();

export const RoadOverride = z.object({
  remove: z.boolean().optional(),
  lanes: z.number().int().min(1).max(8).optional(),
  width: z.number().positive().optional(),
  surface: z.enum(['asphalt', 'unpaved']).optional(),
}).strict();

/** world/tiles/<id>/overrides.json — the only file a tile worker edits besides props.extra.json and tile.md. */
export const Overrides = z.object({
  zone: ZoneId.optional(),
  defaultLevels: z.number().int().min(1).max(12).optional(),
  buildings: z.record(z.string(), BuildingOverride).default({}),
  roads: z.record(z.string(), RoadOverride).default({}),
  notes: z.string().optional(),
}).strict();
export type Overrides = z.infer<typeof Overrides>;

export const PropType = z.enum([
  'streetlight', 'tree', 'water_tank', 'rebar', 'powerpole', 'shrine', 'sign', 'awning', 'billboard', 'prayer_flags', 'shutter', 'wires', 'taxi_spawn', 'ped_spawn',
  // Street density pass.
  'banner', 'transformer', 'rooftop_clutter', 'parapet_pots', 'parked_bike', 'vendor_cart', 'rubbish_pile', 'puddle',
]);
export const Prop = z.object({
  type: PropType,
  x: z.number(), y: z.number(), z: z.number(),
  rotY: z.number().default(0),
  scale: z.number().positive().default(1),
  /** Slope in radians about the prop's local X axis (positive rises along +Z). Only `wires` uses it. */
  pitch: z.number().optional(),
});
export const PropsFile = z.object({ props: z.array(Prop) });
export type PropsFile = z.infer<typeof PropsFile>;
export type Prop = z.infer<typeof Prop>;

export const NavNode = z.object({ id: z.string().regex(/^n_-?\d+_-?\d+$/), x: z.number(), y: z.number(), z: z.number(), border: z.boolean() });
export const NavEdge = z.object({
  from: z.string(), to: z.string(),
  /** 0 for pedestrian-only edges (footway, path, pedestrian, steps). */
  lanes: z.number().int().min(0), oneway: z.boolean(), speed: z.number().positive(), cls: z.string(), width: z.number().positive(),
});
export const Nav = z.object({ nodes: z.array(NavNode), edges: z.array(NavEdge) });
export type Nav = z.infer<typeof Nav>;

export const Hero = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  nameNe: z.string().optional(),
  tier: z.enum(['A', 'B', 'C']),
  lat: z.number(), lon: z.number(),
  rotationDeg: z.number().default(0),
  scale: z.number().positive().default(1),
  /** lon/lat ring. OSM buildings whose centroid falls inside are removed from the tile. */
  footprint: z.array(z.tuple([z.number(), z.number()])).min(3),
  tile: TileIdSchema.optional(),
  model: z.object({ sha256: Sha256, triangles: z.number().int().positive() }).optional(),
  references: z.array(z.url()).default([]),
}).strict();
export type Hero = z.infer<typeof Hero>;

/** Game-clock hours; the window wraps past midnight when fromH > toH. */
export const ClockWindow = z.object({ fromH: z.number().min(0).max(24), toH: z.number().min(0).max(24) }).strict();
export const MissionStep = z.object({
  kind: z.enum(['goto', 'pickup', 'dropoff', 'photo', 'wait']),
  /** World coordinates (section 1), not tile-local. */
  x: z.number(), z: z.number(),
  radius: z.number().positive().default(8),
  text: z.string(),
  /** `wait` steps: seconds to stay inside the radius without leaving it. */
  waitS: z.number().positive().optional(),
  /** The step only completes while the game clock is inside this window. */
  window: ClockWindow.optional(),
}).strict().refine((s) => s.kind !== 'wait' || s.waitS !== undefined, { message: 'wait steps need waitS', path: ['waitS'] });
export type MissionStep = z.infer<typeof MissionStep>;
export const Mission = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  type: z.enum(['taxi', 'delivery', 'race', 'photo', 'collect']),
  start: z.object({ x: z.number(), z: z.number() }),
  steps: z.array(MissionStep).min(1),
  timeLimitS: z.number().positive().optional(),
  rewardText: z.string(),
}).strict();
export type Mission = z.infer<typeof Mission>;
