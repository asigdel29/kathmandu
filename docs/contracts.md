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
- `roads.glb`: primitives grouped by material `asphalt | unpaved | path`. `TEXCOORD_0` u = meters along road, v ∈ [0,1] across. Budget ≤ 120k triangles.
- `water.glb`: flat polygons at terrain min − 0.5 m.
- `props.json`: `{ "props": [{ "type": "streetlight|tree|water_tank|rebar|powerpole|shrine|sign|awning|billboard|taxi_spawn|ped_spawn", "x": 0, "y": 0, "z": 0, "rotY": 0, "scale": 1 }] }` — tile-local coords, Y absolute (elevation − 1300).
- `nav.json`: `{ "nodes": [{ "id": "n_<cmX>_<cmZ>", "x", "y", "z", "border": bool }], "edges": [{ "from", "to", "lanes", "oneway", "speed", "cls", "width" }] }`. Node ids are **world** coordinates quantised to 1 cm, so the same physical point has the same id in both tiles. Runtime stitches tiles by id.
- `meta.json`: validated by `TileMeta` schema.
- Hero: `hero.json` validated by `Hero` schema; model is authored in meters, +Y up, origin at ground level at the landmark's anchor lat/lon, facing +Z = south before `rotationDeg` is applied (rotation is about Y, degrees clockwise seen from above).

## 6. Ownership and merge rules

- A tile change may touch only `world/tiles/<its id>/**`. A landmark change may touch only `world/heroes/<its slug>/**`. CI fails any PR labelled `tile` or `hero` that touches other paths.
- Code changes (runtime, pipeline, art assets) are reviewed before merge and may touch any path.
- `main` is protected: required checks `ci / test` and `ci / tiles`; squash merge; linear history; no force-push. Branch names: `kathmandu/<change-id>`.
- One PR per tile or landmark. PR title names the tile or landmark. PR body: `## Why`, `## What`, `## How to Review`, `## Test Evidence`, last line `Human author: Anubhav Sigdel (anu@getlora.com)`.

## 7. Art direction — "GTA VI style" made concrete

Target: dense, lived-in, sun-drenched realism with a cinematic third-person camera. Kathmandu-specific identity comes from density and clutter, not from individual building quality.

- **Light:** physically based sun (`DirectionalLight`, intensity 3.0–4.5 at midday, color 0xfff2dc), hemisphere fill, ACES filmic tone mapping, exposure 1.0. Default demo time 16:30 local (long warm shadows). Shadow map 4096 following the player, 300 m radius.
- **Air:** exponential fog `FogExp2(0xd9c7a8, 0.00012)` (dust haze), sky via `SkyMesh` with turbidity 6, rayleigh 1.5, mie 0.02 (hazier than default).
- **Post:** GTAO (radius 1.2, 8 samples), bloom (threshold 1.0, strength 0.25), vignette 0.3, film grain 0.03, slight chromatic aberration (0.6 px). DoF off while driving.
- **Palette** (`world/style/palette.json`): Newari brick `#8b3a2a`, old wood `#4a2e1c`, plaster white `#e8e2d6`, pastels `#d9c8b4 #c6d3dc #e3cfc0 #cdd8c3`, unfinished RCC grey `#9a9790`, blue tin roof `#3b6ea5`, marigold `#f2a81d`, saffron `#e07a1f`, asphalt `#3b3b3b`, dust `#b89f7e`.
- **Density rules** (pipeline defaults, tuned per tile): water tanks on 60 % of flat RCC roofs; rebar stubs on 100 % of `rcc_unfinished`; streetlights every 30 m on tertiary and above; power poles every 40 m on residential roads; awnings/shutters on ground floors within 15 m of commercial roads; prayer flags within 150 m of a stupa hero; marigold garlands at shrines.
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
- World base URL: recorded when the public bucket exists.
