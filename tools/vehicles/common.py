"""Shared helpers for the vehicle model scripts (run inside Blender: `blender -b -P tools/vehicles/<type>.py`).

Model space (what the game sees after the glTF export): +Z forward, +Y up, +X to the vehicle's left, the origin on the
ground under the centre of the footprint. Scripts work in that "game space"; `gv` converts to Blender's Z-up space
(Blender -Y is the glTF +Z front axis).

Node contract (see docs/vehicles.md): a `body` node with every non-wheel mesh, wheel nodes whose origin is the hub
centre, an optional `rider` empty. Materials carry colour and roughness/metalness; those whose name starts with `light_`
are lamps that the game makes emissive at night.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

OUT_DIR = os.environ.get('VEHICLE_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'apps', 'game', 'public', 'models', 'vehicles'))

_mats = {}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcolor(h):
    return tuple(srgb_to_linear(((h >> s) & 255) / 255.0) for s in (16, 8, 0)) + (1.0,)


def material(name, hexrgb, rough=0.6, metal=0.0):
    """Principled material by name, created once. Colours are sRGB hex."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = hexcolor(hexrgb)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = hexcolor(hexrgb)
    m.use_backface_culling = True
    _mats[name] = m
    return m


def std_materials():
    """Materials shared by every vehicle."""
    material('tyre', 0x141414, 0.95)
    material('hub', 0xa8a8a8, 0.45, 0.6)
    material('glass', 0x1c2830, 0.12)
    material('dark', 0x202020, 0.8)
    material('black', 0x0c0c0c, 0.7)
    material('chrome', 0xc0c0c0, 0.3, 0.9)
    material('light_head', 0xfff1cc, 0.2)
    material('light_tail', 0xd01818, 0.3)
    material('light_amber', 0xff9a1a, 0.3)
    material('plate', 0xf0c010, 0.5)


def gv(x, y, z):
    """Game space (x left, y up, z forward) to Blender space."""
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


class Mesh:
    """A bmesh being filled in game space; faces take a material by name."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []

    def _slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def face(self, pts, mat):
        """Add a polygon given game-space points (counter-clockwise seen from outside)."""
        vs = [self.bm.verts.new(gv(*p)) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self._slot(mat)
        f.smooth = False
        return f

    def box(self, cx, cy, cz, sx, sy, sz, mat, top_scale=1.0, front_scale=1.0):
        """Axis-aligned box centred at (cx, cy, cz). top_scale narrows the top face in x and z, front_scale narrows the +z face in x."""
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        tx, tz = hx * top_scale, hz * top_scale
        fx = hx * front_scale
        p = {
            'bln': (cx + hx, cy - hy, cz - hz), 'brn': (cx - hx, cy - hy, cz - hz),
            'blf': (cx + fx, cy - hy, cz + hz), 'brf': (cx - fx, cy - hy, cz + hz),
            'tln': (cx + tx, cy + hy, cz - tz), 'trn': (cx - tx, cy + hy, cz - tz),
            'tlf': (cx + tx * front_scale, cy + hy, cz + tz), 'trf': (cx - tx * front_scale, cy + hy, cz + tz),
        }
        # +x (left), -x (right), +z (front), -z (rear), +y (top), -y (bottom)
        self.face([p['bln'], p['tln'], p['tlf'], p['blf']], mat)
        self.face([p['brf'], p['trf'], p['trn'], p['brn']], mat)
        self.face([p['blf'], p['tlf'], p['trf'], p['brf']], mat)
        self.face([p['brn'], p['trn'], p['tln'], p['bln']], mat)
        self.face([p['tln'], p['trn'], p['trf'], p['tlf']], mat)
        self.face([p['brn'], p['bln'], p['blf'], p['brf']], mat)

    def poly(self, pts, mat, hint):
        """A polygon wound so that its normal points along `hint` (any vector roughly facing outward)."""
        nx = ny = nz = 0.0
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            nx += (a[1] - b[1]) * (a[2] + b[2])
            ny += (a[2] - b[2]) * (a[0] + b[0])
            nz += (a[0] - b[0]) * (a[1] + b[1])
        if nx * hint[0] + ny * hint[1] + nz * hint[2] < 0:
            pts = list(reversed(pts))
        return self.face(pts, mat)

    def loft(self, stations, mat, mat_fn=None, cap=True, cap_mat=None):
        """Join cross-sections along z. Each station is (z, [(x, y), ...]) with the same point count, ordered
        counter-clockwise seen from +z (x to the viewer's right, y up). mat_fn(i, k, normal, size) may return another
        material for the quad between stations i and i+1 on section edge k; size is the quad's (width, height) extent
        in its section plane (edge length, z span)."""
        n = len(stations[0][1])
        for i in range(len(stations) - 1):
            z0, a = stations[i]
            z1, b = stations[i + 1]
            for k in range(n):
                k2 = (k + 1) % n
                quad = [(a[k][0], a[k][1], z0), (b[k][0], b[k][1], z1), (b[k2][0], b[k2][1], z1), (a[k2][0], a[k2][1], z0)]
                m = mat
                if mat_fn:
                    ex, ey = a[k2][0] - a[k][0], a[k2][1] - a[k][1]
                    dz = z1 - z0
                    # outward normal: section edge (ex, ey, 0) x forward-ish direction
                    mx, my, mz = (b[k][0] - a[k][0]) + (b[k2][0] - a[k2][0]), (b[k][1] - a[k][1]) + (b[k2][1] - a[k2][1]), 2 * dz
                    normal = (ey * mz - 0 * my, 0 * mx - ex * mz, ex * my - ey * mx)
                    ln = math.sqrt(sum(c * c for c in normal)) or 1.0
                    normal = tuple(c / ln for c in normal)
                    m = mat_fn(i, k, normal, (math.hypot(ex, ey), dz)) or mat
                self.face(list(reversed(quad)), m)
        if cap:
            z0, a = stations[0]
            z1, b = stations[-1]
            self.face([(p[0], p[1], z0) for p in reversed(a)], cap_mat or mat)
            self.face([(p[0], p[1], z1) for p in b], cap_mat or mat)

    def rod(self, a, b, radius, mat, segs=6, radius_b=None):
        """A prism between two game-space points (a tube along any direction); radius_b tapers toward b."""
        rb = radius if radius_b is None else radius_b
        ax = Vector(a)
        d = Vector(b) - ax
        if d.length < 1e-6:
            return
        w = d.normalized()
        ref = Vector((0, 1, 0)) if abs(w.y) < 0.9 else Vector((1, 0, 0))
        u = w.cross(ref).normalized()
        v = w.cross(u)
        ring_a, ring_b = [], []
        for i in range(segs):
            t = 2 * math.pi * i / segs
            o = u * math.cos(t) + v * math.sin(t)
            ring_a.append(tuple(ax + o * radius))
            ring_b.append(tuple(ax + d + o * rb))
        for i in range(segs):
            j = (i + 1) % segs
            t = 2 * math.pi * (i + 0.5) / segs
            o = u * math.cos(t) + v * math.sin(t)
            self.poly([ring_a[i], ring_a[j], ring_b[j], ring_b[i]], mat, tuple(o))
        self.poly(ring_a, mat, tuple(-w))
        self.poly(ring_b, mat, tuple(w))

    def cylinder(self, cx, cy, cz, radius, length, mat, axis='x', segs=14, cap_mat=None, radius2=None):
        """Cylinder along an axis (x, y or z) centred at the point; radius2 gives a cone frustum (at +axis end)."""
        r2 = radius if radius2 is None else radius2
        cap_mat = cap_mat or mat
        ring0, ring1 = [], []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            c, s = math.cos(a), math.sin(a)
            if axis == 'x':
                ring0.append((cx - length / 2, cy + radius * c, cz + radius * s))
                ring1.append((cx + length / 2, cy + r2 * c, cz + r2 * s))
            elif axis == 'y':
                ring0.append((cx + radius * c, cy - length / 2, cz + radius * s))
                ring1.append((cx + r2 * c, cy + length / 2, cz + r2 * s))
            else:
                ring0.append((cx + radius * c, cy + radius * s, cz - length / 2))
                ring1.append((cx + r2 * c, cy + r2 * s, cz + length / 2))
        flip = axis == 'y'  # the ring runs clockwise about +y
        for i in range(segs):
            j = (i + 1) % segs
            quad = [ring0[i], ring0[j], ring1[j], ring1[i]]
            self.face(list(reversed(quad)) if flip else quad, mat)
        self.face(ring0 if flip else list(reversed(ring0)), cap_mat)
        self.face(list(reversed(ring1)) if flip else ring1, cap_mat)

    def to_object(self, parent=None, location=(0, 0, 0)):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        # Faces were built wound for outward normals in game space; mirroring y into Blender space keeps the winding.
        for slot in self.slots:
            me.materials.append(material_by_name(slot))
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = gv(*location)
        if parent:
            obj.parent = parent
        return obj


def material_by_name(name):
    return _mats[name]


def empty(name, location, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = gv(*location)
    if parent:
        e.parent = parent
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    return e


def fix_normals(obj):
    """Make face normals consistent and pointing out (guards against a mis-wound face in a script)."""
    bpy.context.view_layer.objects.active = obj
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


def wheel(name, location, radius, width, tyre_mat='tyre', hub_mat='hub', spokes=False, segs=16):
    """A wheel object whose origin is the hub centre and whose axle is the x axis."""
    m = Mesh(name)
    # tyre: a barrel with a rounded shoulder
    hw = width / 2
    m.cylinder(0, 0, 0, radius, width * 0.82, tyre_mat, 'x', segs)
    m.cylinder(hw * 0.82, 0, 0, radius * 0.94, width * 0.18, tyre_mat, 'x', segs, radius2=radius * 0.82)
    m.cylinder(-hw * 0.82, 0, 0, radius * 0.94, width * 0.18, tyre_mat, 'x', segs, radius2=radius * 0.82)
    m.cylinder(0, 0, 0, radius * 0.62, width * 1.04, hub_mat, 'x', segs)
    # a bar across the hub so the spin is readable from afar
    m.box(0, 0, 0, width * 1.08, radius * 1.1, radius * 0.16, hub_mat)
    m.box(0, 0, 0, width * 1.08, radius * 0.16, radius * 1.1, hub_mat)
    return m.to_object(location=location)


def parent_all(objs, parent):
    for o in objs:
        o.parent = parent


def finish(name, body_meshes, wheels, extra=(), preview=True):
    """Join the body meshes under a `body` object, add a root, export `<name>.glb` and a quick preview render."""
    body = None
    bpy.ops.object.select_all(action='DESELECT')
    for o in body_meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body_meshes[0]
    if len(body_meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = 'body'
    fix_normals(body)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    body.parent = root
    for w in list(wheels) + list(extra):
        w.parent = root
    # Stats
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f'[{name}] triangles: {tris}')
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT_DIR, f'{name}.glb'))
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False, export_extras=False,
        export_image_format='NONE', export_texcoords=False, export_normals=True, export_tangents=False,
    )
    print(f'[{name}] wrote {path} ({os.path.getsize(path)} bytes)')
    prev = os.environ.get('VEHICLE_PREVIEW')
    if preview and prev:
        render_preview(os.path.join(prev, f'{name}.png'), root)
    return path


def render_preview(path, root, views=(('front34', 35, 28), ('rear34', 215, 22), ('side', 90, 5))):
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'
    sh = scn.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    scn.render.resolution_x, scn.render.resolution_y = 640, 420
    scn.render.film_transparent = False
    scn.world = bpy.data.worlds.new('w')
    scn.world.color = (0.55, 0.62, 0.72)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    # a ground plane
    gm = Mesh('ground')
    material('ground', 0x7a756a, 0.9)
    gm.face([(-12, 0, -12), (-12, 0, 12), (12, 0, 12), (12, 0, -12)], 'ground')
    gm.face([(12, 0, -12), (12, 0, 12), (-12, 0, 12), (-12, 0, -12)], 'ground')
    gm.to_object()
    # size from the bounds of the mesh objects
    pts = []
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name != 'ground':
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    size = max((hi - lo).length, 1.0)
    base, ext = os.path.splitext(path)
    for vname, az, el in views:
        # azimuth measured from the vehicle's front (Blender -Y), counter-clockwise seen from above
        a = math.radians(az)
        e = math.radians(el)
        d = size * 1.35
        # front of the vehicle is Blender -Y; azimuth 0 looks at the front
        pos = centre + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * d
        cam.location = pos
        direction = centre - pos
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        cam_data.lens = 40
        scn.render.filepath = f'{base}-{vname}{ext}'
        bpy.ops.render.render(write_still=True)
    print(f'preview: {base}-*.png')
