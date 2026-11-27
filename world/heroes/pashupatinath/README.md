# Pashupatinath: main temple and ghats

Tier A landmark on tile `x19_y18`. `build.py` models the temple, its courtyard and the river front of the Bagmati:

- **Main temple**: a two-tier pagoda on a three-step stone plinth, 18.6 m square, with the gajur finial about 23 m above the courtyard. It has a dark carved timber body, gilded roofs with ribs, hip rolls and corner finials, a hanging bell fringe, gilt roof struts on all four faces, gilt doors under toranas, and a banner pole with a saffron pennant on the upper roof.
- **Courtyard**: paving at one level around the temple, with the upper western terrace and its steps. The gilded Nandi bull sits on its plinth facing the west door, and there is a trishul, six small shrines north of the temple at their OSM positions, and the roofed pavilion with its white and red parapet south of the east gate.
- **East gate and ghat stair**: the white gatehouse with its painted torana, and the flight down to the river with side walls and a centre rail. Small shikhara shrines stand at the foot of the stair, and the white three-storey building (OSM 1826434832) stands north of the stair.
- **Ghats (Arya Ghat, Bhasmeshvar Ghat)**: the stone promenade along the west bank steps down between levels. Six cremation platforms project into the river, two with stacked pyres and four under sheet-metal canopies on posts.
- **Bagmati**: three pools held by two low weirs between the OSM banks, with stepped embankments on both sides.
- **East bank**: the row of eleven Shiva shrines (OSM 2065096706–726) on stone slabs that climb the slope of Mrigasthali, with steps between them. The footbridge (OSM way 37707651) has brick parapets.

## Layout

The anchor (`lat`/`lon` in `hero.json`) is the centroid of the temple footprint (OSM way 1826340630). Everything is laid out square to the temple, which OSM shows turned 37.2° clockwise from north. The script authors in that temple frame (u toward the river, v upstream) and turns the meshes into the Blender frame at the end. Positions come from the OSM features of `x19_y18` and `x19_y17`: river banks, shrines, buildings and the bridge.

The footprint covers the temple compound, the ghats from the white building south past the bridge, and the shrine terrace on the east bank. The next tile build removes the OSM buildings whose centroids fall inside it: the temple, the pavilion, the white building, the six courtyard shrines and the eleven east-bank shrines. The model rebuilds all of them.

## Frame and levels

The model is built in Blender's frame (X east, Y north, Z up, metres). The glTF export (`export_yup=True`) turns that into the world frame (X east, Y up, Z south), so `rotationDeg` is 0. The model origin is the terrain height at the anchor.

The 12.5 m heightmap does not resolve the river trench, so levels were chosen against the rendered terrain:

- The courtyard is 3 m above the anchor.
- The promenade levels are −2.3, −1.2, −0.1 and +1.8 m.
- The pools are −3.6, −2.5 and −1.4 m.

Every terrace sits on or above the ground, and every wall reaches 9 m below the anchor. The only exception is a short stretch of the east embankment where it meets the hill slope.

## Build

```
bun run heroes build pashupatinath
# or directly
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P world/heroes/pashupatinath/build.py -- --out dist/heroes/pashupatinath/model.glb
```

The output is byte-for-byte reproducible. Every mesh is triangulated in the script, and the ellipsoids and lathed parts are built vertex by vertex rather than with `bmesh.ops.create_uvsphere`.

The model is about 22,000 triangles and 1.3 MB, with 17 materials (palette colours) and one mesh per material.
