"""Contact sheet of the prop GLBs (review aid, not shipped).

    Blender -b -P tools/props/sheet.py -- <out.png> [name ...]

Models are normalised to the same size and laid out on a grid; open the PNG to judge the shapes.
True sizes come from tools/props/check.py.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, '..', '..', 'apps', 'game', 'public', 'models', 'props')
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = args[0] if args else '/tmp/props-sheet.png'
names = args[1:] or sorted(f[:-4] for f in os.listdir(DIR) if f.endswith('.glb'))

for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
COLS = min(4, len(names))
SPACING = 4.5
for i, name in enumerate(names):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(DIR, name + '.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == 'MESH' for c in o.bound_box]
    size = max(max(p[k] for p in pts) - min(p[k] for p in pts) for k in range(3))
    cx = (max(p[0] for p in pts) + min(p[0] for p in pts)) / 2
    cy = (max(p[1] for p in pts) + min(p[1] for p in pts)) / 2
    s = 3.2 / size
    gx, gy = (i % COLS) * SPACING, (i // COLS) * SPACING
    holder = bpy.data.objects.new('h_' + name, None)
    bpy.context.scene.collection.objects.link(holder)
    holder.scale = (s, s, s)
    holder.location = (gx - cx * s, gy - cy * s, 0)
    for o in new:
        if o.parent is None: o.parent = holder

rows = math.ceil(len(names) / COLS)
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = COLS * SPACING * 1.05
co = bpy.data.objects.new('cam', cam); bpy.context.scene.collection.objects.link(co)
cx, cy = (COLS - 1) * SPACING / 2, (rows - 1) * SPACING / 2
target = Vector((cx, cy, 1.4))
co.location = target + Vector((0.45, -1.0, 0.55)).normalized() * 40
co.rotation_euler = (target - co.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = co
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'VERTEX'
sc.display.shading.show_shadows = True
sc.render.resolution_x = 1600
sc.render.resolution_y = int(1600 * (rows * SPACING * 0.55 + 5) / (COLS * SPACING * 1.05))
sc.render.filepath = out
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.68)
sc.render.film_transparent = False
bpy.ops.render.render(write_still=True)
print('sheet:', ', '.join(names), '->', out)
