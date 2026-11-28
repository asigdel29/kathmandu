# World contracts

Every package, tile and landmark follows these rules. A change to a contract is its own reviewed change, never part of a tile or landmark change.

## 1. Coordinate frame

- WGS84 lon/lat in; local metric frame out. Projection: equirectangular tangent plane at `ORIGIN = (lon 85.37, lat 27.70)` with meters-per-degree evaluated once at the origin latitude (formulas in `packages/geo/src/projection.ts`). One function. Every package imports it. Nobody re-implements it.
- Three.js world axes: **X = east (m)**, **Y = up (m, elevation − 1300)**, **Z = −north (m)** (right-handed, Y-up).
- Elevation reference: `BASE_ELEVATION_M = 1300`. Valley floor is at Y ≈ −20…+100; Shivapuri peak ≈ +1430.
- Kathmandu drives on the **left**. Traffic lanes are offset to the left of the direction of travel.

## 2. Tile grid

- `TILE_SIZE_M = 800`. Grid anchored at the bbox SW corner. Column `i` counts east from 0, row `j` counts north from 0. Expected grid: **45 columns × 34 rows = 1,530 cells** (pinned by the grid tests).
- Tile id: `x{ii}_y{jj}` zero-padded, e.g. `x14_y17` (Kathmandu Durbar Square), `x12_y18` (Swayambhunath), `x21_y19` (Boudhanath).
- A cell is `content` if it has ≥ 5 buildings or ≥ 3 road segments, else `terrain` (built automatically, no curation). Expect ~900–1,100 content cells; the exact number comes from `data/partition-summary.json`.
- **Tile-local coordinates:** every tile artifact is authored relative to the tile's corner with minimum X and minimum Z (north-west corner in world space): `local = world − tileOrigin`, so local x and z are in `[0, 800)`. The runtime places each tile at `tileOrigin`.
- Features are assigned to the tile containing their centroid (buildings, POIs) or split at tile borders (roads, water, landuse). Border split points are computed by one shared function so both tiles get bit-identical coordinates.

## 3. Repository layout

```
kathmandu/
  package.json  bun.lock  tsconfig.base.json  vitest.workspace.ts
  .github/workflows/ci.yml       # PR gate: test + build/validate/shoot changed tiles
  .github/workflows/publish.yml  # main: build changed tiles → R2, regenerate manifest
  .github/workflows/app.yml      # main: build apps/game → Cloudflare Pages
  packages/geo/                  # @ktm/geo — constants, projection, grid (zero deps)
  packages/schema/               # @ktm/schema — zod schemas for every JSON contract
  packages/pipeline/             # @ktm/pipeline — bun CLI: ingest, partition, terrain, build, validate, shot, manifest, upload
  packages/heroes/               # @ktm/heroes — Blender runner + shared bpy helpers
  apps/game/                     # Vite + Three.js runtime
  world/                         # DATA IN GIT (small, reviewable)
    style/zones.geojson  style/building-styles.json  style/palette.json
    tiles/<id>/overrides.json  tiles/<id>/props.extra.json  tiles/<id>/tile.md
    heroes/<slug>/hero.json  heroes/<slug>/build.py  heroes/<slug>/README.md
    missions/<id>.json
  docs/contracts.md  docs/style-guide.md  docs/runbooks/{tile-worker,hero-worker,dot-review,gamedev}.md
  data/                          # gitignored caches: raw OSM, terrarium PNGs, per-tile features/terrain
  dist/                          # gitignored build outputs: tiles/, heroes/, shots/, manifest.json
```

## 4. Data vs artifacts

| Lives in git | Built by CI / workers, stored on R2 (`https://world.<r2-public-host>/`) |
|---|---|
| `world/**` JSON + Markdown, Blender `build.py` scripts, pipeline + runtime code | `tiles/<id>/<inputsHash>/{terrain.glb,buildings.glb,roads.glb,water.glb,height.f32,props.json,nav.json,meta.json}` |
| `world/heroes/<slug>/hero.json` (includes `model.sha256`) | `heroes/<slug>/<sha256>/model.glb` |
| nothing binary > 100 KB | `data/v1/features/<id>.geojsonl`, `data/v1/terrain/<id>.f32` (pipeline inputs so CI and workers never re-ingest the whole valley) |
| — | `manifest.json` (no-cache; points at hashed, immutable tile paths), `shots/<pr>/<id>-<view>.png` |

`inputsHash = sha256(features.geojsonl + terrain.f32 + overrides.json + props.extra.json + PIPELINE_VERSION)`.

## 5. Tile artifact formats

- `terrain.glb`: 65×65 vertex grid (12.5 m spacing), indexed triangles, `COLOR_0` landcover tint. ≤ 8,192 triangles.
- `height.f32`: 65×65 little-endian Float32, row-major, rows from **north to south** (local z increasing), columns west→east, meters above sea level. 16,900 bytes.
- `buildings.glb`: one mesh, primitive 0 = walls, primitive 1 = roofs. Attributes `POSITION`, `NORMAL`, `TEXCOORD_0` (u = meters along facade, v = meters up), `_STYLE` (float32 scalar, style index from `world/style/building-styles.json`). Buildings' base Y is baked in (no runtime terrain sampling). Budget ≤ 600k triangles, ≤ 8 MB before compression.
- `_STYLE` index 8 is `tile_roof` (`#6b3b2e`), used only on the roof slopes of gabled buildings: `overrides.buildings[id].roof === 'pitched'`, or a `*-core` zone with ≤ 6 footprint vertices and footprint/OBB fill > 0.8 (`roof: 'flat'` forces flat). Ridge along the OBB long axis, 0.35 × short side above the wall top; gable walls keep the facade style.
- `roads.glb`: primitives grouped by material `asphalt | unpaved | path`. `TEXCOORD_0` u = meters along road, v ∈ [0,1] across. Budget ≤ 120k triangles.
- `water.glb`: flat polygons at terrain min − 0.5 m.
- `props.json`: `{ "props": [{ "type": "streetlight|tree|water_tank|rebar|powerpole|wires|shrine|sign|awning|billboard|prayer_flags|shutter|banner|transformer|rooftop_clutter|parapet_pots|parked_bike|vendor_cart|rubbish_pile|puddle|taxi_spawn|ped_spawn", "x": 0, "y": 0, "z": 0, "rotY": 0, "scale": 1 }] }` — tile-local coords, Y absolute (elevation − 1300). `rotY` is a heading: the prop's local +Z points along `(sin rotY, cos rotY)`. `wires` also carries an optional `pitch` (radians, slope about local X) and a `scale` that stretches only along Z (span length / 40 m). Models: `apps/game/public/models/props/<type>.glb` (trees: `tree_peepal|tree_bottlebrush|tree_jacaranda`), built by `tools/props/`.
- `nav.json`: `{ "nodes": [{ "id": "n_<cmX>_<cmZ>", "x", "y", "z", "border": bool }], "edges": [{ "from", "to", "lanes", "oneway", "speed", "cls", "width" }] }`. Node ids are **world** coordinates quantised to 1 cm, so the same physical point has the same id in both tiles. Runtime stitches tiles by id.
- `meta.json`: validated by `TileMeta` schema.
- Hero: `hero.json` validated by `Hero` schema; model is authored in meters, +Y up, origin at ground level at the landmark's anchor lat/lon, facing +Z = south before `rotationDeg` is applied (rotation is about Y, degrees clockwise seen from above).
- Hero placement at runtime: `manifest.heroes[<slug>]` = `{ tile, url, sha256, lat, lon, rotationDeg, scale }` (copied from `hero.json`). Once `tile` is loaded, the runtime fetches `<world base>heroes/<slug>/<sha256>/model.glb` and places it at `lonLatToLocal(lon, lat)`, Y = terrain height there − `BASE_ELEVATION_M`, `rotation.y = −rotationDeg·π/180`, uniform `scale`. A missing model logs one warning and is skipped. `?hero=<slug>` starts the player 60 m south of the anchor.

## 6. Ownership and merge rules

- A tile change may touch only `world/tiles/<its id>/**`. A landmark change may touch only `world/heroes/<its slug>/**`. CI fails any PR labelled `tile` or `hero` that touches other paths.
- Code changes (runtime, pipeline, art assets) are reviewed before merge and may touch any path.
- `main` is protected: required checks `ci / test` and `ci / tiles`; squash merge; linear history; no force-push. Branch names: `kathmandu/<change-id>`.
- One PR per tile or landmark. PR title names the tile or landmark. PR body: `## Why`, `## What`, `## How to Review`, `## Test Evidence`, last line `Human author: Anubhav Sigdel (anu@getlora.com)`.

## 7. Art direction — "GTA VI style" made concrete

Target: dense, lived-in, sun-drenched realism with a cinematic third-person camera. Kathmandu-specific identity comes from density and clutter, not from individual building quality.

- **Light:** physically based sun (`DirectionalLight`, intensity 2.0–3.0 at midday scaling with elevation, colour 0xfff2dc warming towards the horizon), hemisphere fill 0.5–0.8 by day (sky `#bfd4ff`, ground `#8a7a66`) plus a sky environment map (PMREM of the `SkyMesh`, rebuilt every 30 game minutes), ACES filmic tone mapping, exposure 0.55–0.75. Night: moon 0.15, ambient 0.08–0.12, up to 24 warm streetlight `PointLight`s (18 m, decay 2) within 60 m of the player. Default demo time 16:30 local (long warm shadows). Shadow map 4096 following the player, 300 m radius. Every constant lives in `apps/game/src/world/lighting.ts`.
- **Air:** exponential fog `FogExp2` with density 0.0001 whose colour follows the sampled sky horizon colour for the time of day (dust haze), sky via `SkyMesh` with turbidity 5, rayleigh 1.6, mie 0.012 plus a blue twilight/night layer (the Preetham sky is black below the horizon).
- **Post** (`apps/game/src/post/Pipeline.ts`, in this order): temporal AA (MSAA 4x with `?taa=0`), GTAO (radius 1.2) with denoise, screen-space reflections at half resolution on surfaces with roughness < 0.35 (wet asphalt with `?wet=1` or at night, glass, water), bloom (threshold 1.0 in display-white units, strength 0.18, radius 0.6), 3D LUT grade (two procedural 32³ tables, day and night, blended by the `night` uniform), depth of field (50 mm f/2.8 on the player, after 3 s idle on the follow camera, never while driving), vignette 0.25, film grain 0.03, chromatic aberration 0.6 px at the frame edge, and a camera-rotation radial blur while driving above 40 km/h. `?quality=low|med|high` (default: chosen from the first 2 s of frame time; `freeze=1` and `autodrive=1` runs are pinned to `high`): `low` = temporal AA + grade, `med` adds GTAO, bloom, vignette, grain, aberration, `high` adds denoise, reflections, depth of field and the driving blur.
- **Palette** (`world/style/palette.json`): Newari brick `#8b3a2a`, old wood `#4a2e1c`, plaster white `#e8e2d6`, pastels `#d9c8b4 #c6d3dc #e3cfc0 #cdd8c3`, unfinished RCC grey `#9a9790`, blue tin roof `#3b6ea5`, marigold `#f2a81d`, saffron `#e07a1f`, asphalt `#3b3b3b`, dust `#b89f7e`.
- **Density rules** (pipeline defaults, deterministic from `hash01(feature id + role)`; `packages/pipeline/src/build/props.ts`): on commercial roads (within 15 m of trunk/primary/secondary/tertiary, and every road of a `*-core` zone) a `sign` every 4–6 m along the ground floor, alternating 0.1 / 0.6 m from the wall, an `awning` on 60 % and a `shutter` on 40 % of ground-floor units, clusters of 3–8 `parked_bike` every 25 m at the kerb; in `*-core` zones a `banner` across the street every 40 m and a `vendor_cart` every 60 m; a `powerpole` every 35 m on every vehicle road with a `wires` bundle between neighbours and a `transformer` on every 6th pole; on flat roofs a water tank on 70 % of RCC roofs (second tank on 20 %), `rebar` on 100 % of `rcc_unfinished`, `rooftop_clutter` on 50 %, `parapet_pots` on 25 %; a `rubbish_pile` every 80 m on residential roads, a `tree` every 30 m on residential roads 6 m wide or more, 2 `puddle` per 100 m on unpaved roads; streetlights every 30 m on tertiary and above; prayer flags within 150 m of a stupa hero; marigold garlands at shrines. A tile carries fewer than 6,000 props: over the limit the builder thins signs, awnings, shutters, bikes, roof clutter, pots, rubbish and carts by a common fraction, and `validate` rejects 6,000 or more.
- **Camera:** over-the-shoulder, 2.4 m back, 1.6 m up, 50° FOV on foot; 6.5 m back, 2.4 m up, 60° FOV driving; soft lag (critically damped spring, 0.12 s).
- **What we do not copy:** any Rockstar logo, font, HUD layout, radio station names, mission names, or character likeness.

## 8. Budgets

| Metric | Budget |
|---|---|
| Frame time | ≤ 16.6 ms on M-series Mac at 1440p; ≤ 33 ms on a 2020 Intel laptop at 1080p |
| Loaded tiles | 3×3 full (buildings+roads+props+physics), 7×7 terrain+buildings, 11×11 terrain only |
| Per-tile download | ≤ 3 MB buildings after quantisation (meshopt compression comes later), ≤ 1 MB roads |
| Draw calls | ≤ 400 per frame (one mesh per tile per layer; props instanced) |
| Hero models | Tier A ≤ 150k tris, Tier B ≤ 60k, Tier C ≤ 25k, textures ≤ 2048² KTX2 |
| Time to first frame | ≤ 6 s on 50 Mbit/s |

## 9. Commit and PR rules

- `git config user.name "Anubhav Sigdel"`, `git config user.email "64096825+asigdel29@users.noreply.github.com"` in every worktree.
- Commit messages and PR bodies describe the change itself. No trailers or footers other than the human-author line.
- Conventional Commits: `feat(tile x14_y17): curate Basantapur`, `feat(hero swayambhunath): model stupa`, `fix(pipeline): ...`.
- Never rebase or force-push a pushed branch; merge `main` into the branch instead.
- Commit only inside the allowed paths of the change.

---

## 10. Data snapshot

- OpenStreetMap extract: Geofabrik `asia/nepal-latest.osm.pbf`, `Last-Modified: Tue, 24 Nov 2026 23:41:27 GMT` (415,185,155 bytes), downloaded 2026-11-26.
- Ingest (`bun run pipeline ingest`, osmium 1.19.1): `features: 1149194` in `data/raw/valley.geojsonl`.
- Partition (`bun run pipeline partition`): `tiles with features: 1530 / 1530`, `content tiles: 1419` (111 terrain tiles).
- World base URL: `WORLD_BASE_URL=https://pub-df2d6eb6805a419e86048072c49bc1c8.r2.dev/` (bucket `kathmandu-world`; tiles under `tiles/<id>/<inputsHash>/`, inputs under `data/v1/`, manifest at `manifest.json`).
- App: Cloudflare Pages project `kathmandu`, https://kathmandu-9av.pages.dev (custom domain later).

## 11. Verified orientations

- **Rapier heightfield** (`apps/game/src/physics/Physics.ts`): Rapier's heightfield matrix is column-major with rows along local Z and columns along local X, so `heights[c * 65 + r] = height[r * 65 + c]` (r = `height.f32` row, north→south / local z increasing; c = column, west→east), scale `(800, 1, 800)`, collider translated to the tile centre. Verified 2026-11-26 in the browser on `x12_y18` (Swayambhu hill): downward ray casts match `height.f32` to 0.000 m at six asymmetric points (the swapped layout would be off by up to 33.1 m), and the character walked 173 m uphill toward the summit (north-west), climbing 75.7 m with its centre 0.87–1.05 m above the sampled ground (capsule half-height 0.9 m): it neither floats nor sinks.

## 12. Missions

- **Files.** One mission per file, `world/missions/<id>.json`, schema `Mission` in `packages/schema/src/world.ts`. The file name must equal the `id`. Coordinates are world x,z (section 1), not tile-local; write them with `bun run pipeline latlon <lat> <lon>` or `bun run pipeline latlon --tile <id> <localX> <localZ>`, which print world x,z, the tile id and the tile-local position.
- **Delivery to the runtime.** The app bundles every `world/missions/*.json` at build time (`import.meta.glob` in `apps/game/src/missions/catalog.ts`), as it does `world/vehicles.json`. There is no `missions` entry in `manifest.json` and nothing to fetch; a mission change ships with the next app deploy, not with a tile publish. The catalog throws at startup on a file that fails the schema or whose name does not match its id; `apps/game/src/missions/missions.test.ts` runs the same checks in CI.
- **State machine** (`apps/game/src/missions/fsm.ts`): `idle -> active(step i) -> done | failed`. `failed` is `timeout` (elapsed time over `timeLimitS`) or `abandoned`. Step completion, all inside `radius` of the step's x,z on the XZ plane: `goto` on entry; `pickup` and `dropoff` at or below 2 m/s; `photo` on an `F` press; `wait` after `waitS` seconds inside without leaving. A step with a `window` (game clock hours, `fromH` inclusive, `toH` exclusive, wraps past midnight) completes only inside it.
- **Controls.** `J` opens and closes the mission list; a number key accepts (1-9, 0 for the tenth); `Backspace` in the list abandons the active mission; `F` takes a photo.
- **Markers.** Marigold `#f2a81d` billboard pins (constant screen size, drawn over buildings) above the current step and, dimmer, the next one, with a ground ring the size of the step radius. The HUD shows the mission title, step number, time left, the step text and the distance to the target.
- **Debug.** `?mission=<id>` spawns at the mission start (on its tile, in a taxi for `taxi` missions and a motorbike for `delivery` and `race`, on foot otherwise) and accepts the mission once the world is ready; `tile=`, `x=`/`z=` and `vehicle=` still override. `window.__ktmDebug.mission` reports `{ id, status, step, markers }`.
