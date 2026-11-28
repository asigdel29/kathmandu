# Vehicle models

The six vehicle types (`tempo`, `taxi`, `motorbike`, `micro`, `bus`, `truck`) are low-poly GLBs in `apps/game/public/models/vehicles/<type>.glb`, built by deterministic Blender scripts in `tools/vehicles/`. Both the drivable vehicle (`apps/game/src/vehicles/Vehicle.ts`) and ambient traffic (`apps/game/src/traffic/Traffic.ts`) load them; a type whose GLB is missing or malformed keeps its box placeholder.

## Rebuilding

```
tools/vehicles/build.sh                              # all six, writes the GLBs
VEHICLE_PREVIEW=/some/dir tools/vehicles/build.sh    # also writes <type>-front34/rear34/side.png renders
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/vehicles/taxi.py   # one type
```

`tools/vehicles/common.py` holds the helpers (lofted bodies, boxes, rods, wheels, export); each `<type>.py` only describes the shape. Nothing is random, so a rebuild reproduces the committed files.

## GLB contract

- Space: +Z forward, +Y up, +X the vehicle's left (it drives on the left of the road). The origin is on the ground under the centre of the footprint.
- Nodes: `body` (every non-wheel mesh) and the wheel nodes below, whose origin is the hub centre and whose axle is the X axis. The motorbike also has an empty `rider` at the seat.

| Type | Wheel nodes (physics wheel order) |
|---|---|
| `taxi`, `micro`, `bus`, `truck` | `wheel_fl wheel_fr wheel_rl wheel_rr` |
| `tempo` | `wheel_f wheel_rl wheel_rr` |
| `motorbike` | `wheel_f wheel_r` |

- Wheel node positions match `wheelLayout()` in `Vehicle.ts` (axles come from `frontAxle` / `rearAxle` in `world/vehicles.json`, else the symmetric default) and the wheel radius matches `wheelRadius`; `models.test.ts` checks both, plus the size, triangle and byte budgets.
- Materials carry colour, roughness and metalness only (no textures). A material whose name starts with `light_` is a lamp: it glows at night, driven by the `night` uniform.
- Budgets: < 15,000 triangles and < 8 MB per file. Current: 1.3k to 2.9k triangles, 70 to 150 kB.

## Runtime

`apps/game/src/vehicles/models.ts` turns a loaded GLB into one merged body geometry with per-vertex `color` and `surf` (roughness, metalness, lamp) attributes, plus one hub-centred geometry per wheel. All vehicles share a single material, so each traffic type is two instanced draws (body, wheels). The drivable vehicle puts a wheel pivot at each model wheel: the physics suspension sets its height, the steering angle its yaw and the wheel rotation its spin. Traffic derives the same from speed (spin) and heading change (steer, bicycle model).

## Traffic mix

30 % motorbike, 25 % taxi, 15 % micro, 10 % tempo, 10 % truck, 10 % bus (`apps/game/src/traffic/mix.ts`). Buses and trucks need a carriageway of 8 m or more, micros 6 m, tempos 4.5 m; narrower roads renormalise the mix, and routes avoid roads too narrow for the vehicle while another way out exists.
