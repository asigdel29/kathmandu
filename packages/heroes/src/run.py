"""Build one hero model inside Blender.

    Blender -b --factory-startup -P packages/heroes/src/run.py -- <slug>

Runs world/heroes/<slug>/build.py on an empty scene, exports every scene object to
dist/heroes/<slug>/model.glb and records triangles, bytes and sha256 in build.json next to it.
"""
import hashlib
import json
import os
import runpy
import sys

import bpy

ROOT = os.environ.get('KTM_ROOT') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def triangles():
    """Triangles of every mesh object after modifiers, the way the exporter sees them."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        ev = ob.evaluated_get(depsgraph)
        me = ev.to_mesh()
        try:
            total += sum(len(p.vertices) - 2 for p in me.polygons)
        finally:
            ev.to_mesh_clear()
    return total


def main():
    if '--' not in sys.argv or len(sys.argv) != sys.argv.index('--') + 2:
        raise SystemExit('usage: Blender -b --factory-startup -P run.py -- <slug>')
    slug = sys.argv[sys.argv.index('--') + 1]
    script = os.path.join(ROOT, 'world', 'heroes', slug, 'build.py')
    if not os.path.isfile(script):
        raise SystemExit(f'no {script}')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sys.argv = [script]
    runpy.run_path(script, run_name='__main__')

    out_dir = os.path.join(ROOT, 'dist', 'heroes', slug)
    os.makedirs(out_dir, exist_ok=True)
    glb = os.path.join(out_dir, 'model.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_yup=True, export_apply=True,
                              use_selection=False, export_extras=False, export_cameras=False, export_lights=False)
    with open(glb, 'rb') as f:
        data = f.read()
    result = {'triangles': triangles(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    with open(os.path.join(out_dir, 'build.json'), 'w') as f:
        json.dump(result, f)
    print(f'{slug}: wrote {glb}')


main()
