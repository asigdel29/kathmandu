# Swayambhunath Mahachaitya + hilltop

Tier A landmark on tile `x12_y18`. `build.py` models the summit of Swayambhu hill:

- **Great stupa**: stone plinth, whitewashed anda (22 m across, 8.6 m high) with saffron lotus petals at the crown, gilded harmika with the Buddha eyes, urna and nose sign on all four faces, red and green drapery, four pentagonal toranas, thirteen gilded rings, chattra and gajur finial (about 28 m above the terrace).
- **Shrines on the dome base**: five Dhyani Buddha shrines and five Tara shrines at their OpenStreetMap positions, with a ring of prayer wheels under a narrow metal canopy between them.
- **Pratappur and Anantapur shikharas**: white curvilinear towers (17 m) on square pavilions with a red band, amalaka and gilt finial.
- **Vajra** (dorje) on its bronze drum at the head of the eastern stair, and the top flight of the eastern stair with stone parapets and small chaityas.
- **Harati temple**: two-tier brick pagoda with gilded roofs, north-west of the stupa.
- Fourteen votive chaityas around the terrace and sixteen lines of prayer flags from the spire to poles at the edge.

Layout comes from the OSM features of `x12_y18` (stupa footprint `a402447414`, shikharas, Dorje, Harati, shrine nodes), measured from the stupa footprint centroid, which is the anchor (`lat`/`lon` in `hero.json`).

## Frame

Built in Blender's frame (X east, Y north, Z up, metres); the glTF export (`export_yup=True`) turns that into the world frame (X east, Y up, Z south), so `rotationDeg` is 0. The model origin is the terrain height at the anchor; the paved terrace top sits 2 m above it and its retaining walls reach 14 m below, because the 12.5 m heightmap rounds the summit off (up to 6 m lower than the anchor on the south side, 3 m higher on the north).

## Build

```
bun run heroes build swayambhunath
# or directly
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P world/heroes/swayambhunath/build.py -- --out dist/heroes/swayambhunath/model.glb
```

The output is byte-for-byte reproducible: every mesh is triangulated in the script and spheres are built from lathed profiles, because `bmesh.ops.create_uvsphere` and the exporter's n-gon split order faces differently from run to run.

About 40,000 triangles, about 2.2 MB, 18 materials (palette colours, flags double-sided), one mesh per material.
