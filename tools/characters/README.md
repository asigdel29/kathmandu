# Character models

`build.py` turns two CC0 Quaternius packs into the five game characters in `apps/game/public/models/characters/`:
`player.glb` (about 15k triangles, 10 clips) and `ped_0`..`ped_3.glb` (about 7k triangles, `idle` and `walk`).
`characters.json` records each model's size and the clip root speeds measured on the exported rig.

| Model | Body | Outfit |
|---|---|---|
| `player` | male | olive jacket over a white tee, indigo jeans, white sneakers, parted hair and beard |
| `ped_0` | male | daura-suruwal in cream with a black waistcoat, Dhaka topi, brown shoes |
| `ped_1` | female | green kurta with marigold trim, cream churidar, long hair |
| `ped_2` | male | charcoal jacket over a brick-red tee, light jeans, buzz cut and beard |
| `ped_3` | female | school uniform: sky-blue blouse, navy tie and skirt, white socks, hair buns |

No logos anywhere: the colours come from the outfit definitions in `outfits.py`.

## Rebuild

```sh
sh tools/characters/fetch.sh /tmp/ktm-characters           # Universal Base Characters + Universal Animation Library (CC0)
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/characters/build.py -- \
  --src /tmp/ktm-characters --out apps/game/public/models/characters [--only player,ped_0] [--preview /tmp/prev]
```

`--preview <dir>` also renders four views of each variant (front, back, side mid-stride, three-quarter).

## How it works

- Both packs use the same 65-bone skeleton (`root`, `pelvis`, `spine_01`..), so the clips from the animation library's
  Unreal FBX bind to the bodies by bone name; the clips go on NLA tracks and export as named glTF animations.
- `outfits.py` describes each outfit as a stack of colour layers over the rest-pose body. A layer is a mask built from
  small expressions over the vertex position (`gt('z', 0.9) & lt('x', 0.7)` ...). The same masks drive the inflation of
  the body mesh under jackets and trousers and, as shader nodes, a Cycles bake of the colour texture (1024², JPEG in the
  GLB), so edges stay crisp at texture resolution.
- `dress.py` slims the bodies (the base meshes are muscular), decimates the pedestrian bodies, bakes the texture, and
  builds the vertex-coloured `Outfit` mesh: hair meshes from the pack, a Dhaka topi (patterned faces), and flared
  tunics for the daura, kurta, school skirt and jacket hems, skinned to the pelvis and thighs so they follow the legs.
- Export scales the character by 0.93 (the bodies are 1.77-1.81 m; the crowd is shorter) under a `Character` node.
- `build.py` also measures each walk, run and sprint clip's planted-foot ground speed: the least-squares slope of the
  ball of the foot over each contact run.
