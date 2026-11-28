# Prop models

Low-poly GLBs for `apps/game/public/models/props/`, built headless in Blender from deterministic Python
scripts (no random numbers; jitter comes from a sine hash).

```
sh tools/props/build.sh                 # rebuild everything and run the budget check
sh tools/props/build.sh tree shutter    # selected scripts
python3 tools/props/check.py            # triangles, bounding boxes, attributes, bytes
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/props/sheet.py -- /tmp/sheet.png streetlight shrine   # contact sheet
```

## Conventions (what `PropsRenderer` expects)

- Metres, +Y up, origin on the ground under the prop. Wall-mounted `awning`, `sign` and `shutter` have the wall plane at
  `z = 0`.
- Local **+Z is the front / heading**. `rotY` in `props.json` turns +Z to `(sin rotY, cos rotY)` in world X/Z. Roads
  give each roadside prop the road heading, so the road runs along local ±X for streetlights and powerpoles.
  The streetlight arm and head point to local **-X** (lights stand on the left of the direction of travel).
  Shutters, shrines, awnings and signs face the street along +Z.
- One mesh, one material, vertex colours (`COLOR_0`, linear) and no textures. Budget: under 1,500 triangles
  (trees under 600), each file well under 1 MB.
- `_lamp` (float vertex attribute, 0..1) marks emissive vertices: the streetlight lens and the shrine candle flame.
  The renderer multiplies it by the `night` uniform.
- `awning`, `sign` and `shutter` are authored in near-white and mid-grey; the renderer multiplies a per-instance
  tint (palette colours) into them, so one draw call still serves every colour. Trees get a small tint too.
- `tree_peepal`, `tree_bottlebrush` and `tree_jacaranda` are the three `tree` variants, chosen per instance
  from the position (40 / 30 / 30 %).
- `wires.glb` is a bundle of nine cables over a 40 m span along +Z, origin at the upper crossarm insulators
  (`y = 7.8` above the pole's ground). The generator emits a `wires` prop per pair of consecutive powerpoles:
  `rotY` = heading to the next pole, `pitch` = slope, `scale` = 3-D span / 40. The renderer stretches only Z.
- Street density props (placeholder geometry, to be refined): `banner` spans local X across the street (6 m, cloth is near-white and
  tinted per instance, rotY is the road heading); `transformer` is a three-drum bank on the back (-Z) of a power pole and shares the
  pole's origin; `rooftop_clutter` and `parapet_pots` stand on a roof at their origin; `parked_bike` faces +Z; `vendor_cart` has its
  handles toward +Z; `rubbish_pile` is a half-buried mound; `puddle` is a flat glossy disc 2 cm above the ground.
