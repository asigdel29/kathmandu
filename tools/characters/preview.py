"""Shared helpers for rendering previews in Blender (background mode)."""
import bpy, math
from mathutils import Vector


def setup_world(strength=1.0):
    w = bpy.context.scene.world or bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.75, 0.78, 0.85, 1)
    bg.inputs[1].default_value = strength


def add_sun():
    d = bpy.data.lights.new("sun", 'SUN'); d.energy = 3.0
    o = bpy.data.objects.new("sun", d); bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (math.radians(50), 0, math.radians(30))


def render(path, cam_loc, target, res=(640, 900), lens=60, engine='BLENDER_EEVEE'):
    sc = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = lens
    sc.collection.objects.link(cam)
    cam.location = Vector(cam_loc)
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
