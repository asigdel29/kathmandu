"""Shared helpers for the prop modelling scripts (Blender headless).

Run a prop script with:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/props/<type>.py

Conventions (match apps/game/src/world/PropsRenderer.ts):
  * metres, +Y up, origin at ground level under the prop;
  * local +Z is the heading / front of the prop (what `rotY` turns);
  * one mesh, flat shaded, colours are vertex colours (COLOR_0, linear);
  * the optional `_lamp` vertex attribute (0..1) marks emissive vertices; the
    renderer multiplies it with the night uniform.

All geometry is written in glTF axes (x, y up, z) and converted to Blender's
Z-up frame on export, so the scripts never think about the swap.
Everything is deterministic: no random module, jitter comes from `hash01`.
"""
import json
import math
import os
import sys

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'apps', 'game', 'public', 'models', 'props')

with open(os.path.join(ROOT, 'world', 'style', 'palette.json')) as _f:
    PALETTE = json.load(_f)


def lin(c):
    """sRGB channel (0..1) to linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h, mul=1.0):
    """'#rrggbb' (or a palette key) to a linear RGB tuple, optionally scaled by `mul` for shading variety."""
    h = PALETTE.get(h, h).lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (min(1.0, lin(r) * mul), min(1.0, lin(g) * mul), min(1.0, lin(b) * mul))


def hash01(i):
    """Deterministic pseudo-random in [0, 1)."""
    x = math.sin(i * 12.9898 + 78.233) * 43758.5453
    return x - math.floor(x)


def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _len(a): return math.sqrt(_dot(a, a))
def _norm(a):
    l = _len(a)
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-9 else (0.0, 1.0, 0.0)


class Mesh:
    """Unshared-vertex triangle/quad soup with a colour and a lamp value per face."""

    def __init__(self):
        self.faces = []  # (verts [(x,y,z)...], color, lamp)

    # -- primitives -----------------------------------------------------------------------
    def face(self, pts, color, lamp=0.0, center=None):
        """Add a polygon. With `center`, flip it so its normal points away from that point."""
        pts = list(pts)
        if center is not None and len(pts) >= 3:
            n = _cross(_sub(pts[1], pts[0]), _sub(pts[2], pts[0]))
            mid = _mul(_add(_add(pts[0], pts[1]), pts[2]), 1 / 3.0)
            if _dot(n, _sub(mid, center)) < 0:
                pts.reverse()
        self.faces.append((pts, color, lamp))

    def box(self, x0, y0, z0, x1, y1, z1, color, lamp=0.0, bottom=True, top=True):
        c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]
        if not bottom: quads.remove((0, 1, 5, 4))
        if not top: quads.remove((3, 7, 6, 2))
        for q in quads:
            self.face([v[i] for i in q], color, lamp, c)

    def hexa(self, v, color, lamp=0.0):
        """Arbitrary convex 8-vertex hexahedron: v[0..3] bottom ring, v[4..7] top ring (same order)."""
        c = (sum(p[0] for p in v) / 8, sum(p[1] for p in v) / 8, sum(p[2] for p in v) / 8)
        for q in [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
            self.face([v[i] for i in q], color, lamp, c)

    def frustum(self, p, q, r0, r1, sides, color, lamp=0.0, caps=True, twist=0.0, up_hint=(0, 1, 0)):
        """Prism/frustum from point p (radius r0) to point q (radius r1)."""
        axis = _norm(_sub(q, p))
        hint = up_hint if abs(_dot(axis, up_hint)) < 0.95 else (1, 0, 0)
        u = _norm(_cross(axis, hint)); w = _cross(axis, u)
        ring = lambda c, r: [_add(c, _add(_mul(u, r * math.cos(twist + 2 * math.pi * i / sides)), _mul(w, r * math.sin(twist + 2 * math.pi * i / sides)))) for i in range(sides)]
        a, b = ring(p, r0), ring(q, r1)
        mid = _mul(_add(p, q), 0.5)
        for i in range(sides):
            j = (i + 1) % sides
            self.face([a[i], a[j], b[j], b[i]], color, lamp, mid)
        if caps:
            if r0 > 0: self.face(a, color, lamp, mid)
            if r1 > 0: self.face(b, color, lamp, mid)

    def cyl(self, x, z, y0, y1, r0, r1, sides, color, lamp=0.0, caps=True):
        self.frustum((x, y0, z), (x, y1, z), r0, r1, sides, color, lamp, caps)

    def path(self, pts, radius, sides, color, lamp=0.0, caps=False):
        """Prism tube through a polyline (constant radius, simple segment joints)."""
        for i in range(len(pts) - 1):
            r = radius(i) if callable(radius) else radius
            self.frustum(pts[i], pts[i + 1], r, r, sides, color, lamp, caps)

    def blob(self, cx, cy, cz, rx, ry, rz, color, detail=1, jitter=0.0, seed=0, lamp=0.0, shade=0.0):
        """Low-poly ellipsoid (subdivided icosahedron) with optional deterministic vertex jitter.
        `shade` darkens the underside and lightens the top for cheap form without lighting."""
        t = (1 + 5 ** 0.5) / 2
        verts = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
        verts = [_norm(v) for v in verts]
        tris = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
                (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        for _ in range(detail):
            cache = {}
            def mid(a, b):
                k = (min(a, b), max(a, b))
                if k not in cache:
                    verts.append(_norm(_mul(_add(verts[a], verts[b]), 0.5)))
                    cache[k] = len(verts) - 1
                return cache[k]
            nt = []
            for a, b, c in tris:
                ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
                nt += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
            tris = nt
        pos = []
        for i, v in enumerate(verts):
            j = 1.0 + (hash01(seed * 131 + i) - 0.5) * 2 * jitter
            pos.append((cx + v[0] * rx * j, cy + v[1] * ry * j, cz + v[2] * rz * j))
        ctr = (cx, cy, cz)
        for a, b, c in tris:
            pts = [pos[a], pos[b], pos[c]]
            col = color
            if shade:
                ny = (pts[0][1] + pts[1][1] + pts[2][1]) / 3 - cy
                f = 1.0 + shade * max(-1.0, min(1.0, ny / max(ry, 1e-6)))
                col = tuple(min(1.0, c_ * f) for c_ in color)
            self.face(pts, col, lamp, ctr)

    def quad(self, a, b, c, d, color, lamp=0.0, double=False):
        self.faces.append(([a, b, c, d], color, lamp))
        if double: self.faces.append(([d, c, b, a], color, lamp))

    def merge(self, other, dx=0.0, dy=0.0, dz=0.0, rot_y=0.0, scale=1.0):
        cs, sn = math.cos(rot_y), math.sin(rot_y)
        for pts, col, lamp in other.faces:
            self.faces.append(([((p[0] * cs + p[2] * sn) * scale + dx, p[1] * scale + dy, (-p[0] * sn + p[2] * cs) * scale + dz) for p in pts], col, lamp))

    def tri_count(self):
        return sum(len(p) - 2 for p, _, _ in self.faces)


def export(mesh, name, roughness=0.85, metallic=0.0, lamp=False, extras=None):
    """Write apps/game/public/models/props/<name>.glb from `mesh`."""
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)
    verts, polys, cols, lamps = [], [], [], []
    for pts, col, lp in mesh.faces:
        base = len(verts)
        for p in pts:
            verts.append((p[0], -p[2], p[1]))  # glTF (x, y up, z) -> Blender (x, -z, y)
        polys.append(tuple(range(base, base + len(pts))))
        cols.extend([col] * len(pts))
        lamps.extend([lp] * len(pts))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], polys)
    me.update()
    ca = me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for i, c in enumerate(cols):
        ca.data[i].color = (c[0], c[1], c[2], 1.0)
    if lamp:
        la = me.attributes.new(name='_lamp', type='FLOAT', domain='POINT')
        for i, v in enumerate(lamps):
            la.data[i].value = v
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Color'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_attributes=True, export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True,
        export_cameras=False, export_lights=False, export_materials='EXPORT', export_image_format='NONE',
    )
    print(f'prop {name}: {mesh.tri_count()} tris -> {path} ({os.path.getsize(path)} B)')
    return path
