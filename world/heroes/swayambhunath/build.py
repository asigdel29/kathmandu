"""Swayambhunath Mahachaitya and the hilltop around it.

Pure bpy, deterministic, no external assets. Blender frame while building:
X = east, Y = north, Z = up, meters. Origin = ground level at the anchor
(centre of the great stupa). The glTF export (+Y up) maps Blender +Y (north)
to -Z, which matches the world frame (Z = -north), so rotationDeg stays 0.

Positions come from the OpenStreetMap features of tile x12_y18, taken
relative to the stupa footprint centroid (lon 85.290386, lat 27.714931).

Usage:
  Blender -b -P build.py                       # build the scene only
  Blender -b -P build.py -- --out model.glb    # build and export
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
T = 2.0  # top of the paved summit terrace above the anchor ground height

# --------------------------------------------------------------------------
# palette and materials
# --------------------------------------------------------------------------


def _palette():
    p = os.path.join(HERE, '..', '..', 'style', 'palette.json')
    try:
        with open(p) as f:
            return json.load(f)
    except OSError:  # running outside the repository
        return {}


PAL = {
    'newari_brick': '#8b3a2a', 'old_wood': '#4a2e1c', 'tile_roof': '#6b3b2e',
    'plaster_white': '#e8e2d6', 'pastel_1': '#d9c8b4', 'pastel_4': '#cdd8c3',
    'rcc_grey': '#9a9790', 'tin_blue': '#3b6ea5', 'marigold': '#f2a81d',
    'saffron': '#e07a1f', 'asphalt': '#3b3b3b', 'dust': '#b89f7e',
}
PAL.update(_palette())


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


# name: (palette key, metallic, roughness, double sided)
MATS = {
    'whitewash': ('plaster_white', 0.0, 0.85, False),
    'saffron': ('saffron', 0.0, 0.8, False),
    'gilt': ('marigold', 0.35, 0.45, False),
    'bronze': ('old_wood', 0.6, 0.55, False),
    'dark': ('asphalt', 0.0, 0.7, False),
    'canopy': ('asphalt', 0.3, 0.6, True),
    'stone': ('rcc_grey', 0.0, 0.9, False),
    'paving': ('dust', 0.0, 0.95, False),
    'brick': ('newari_brick', 0.0, 0.85, False),
    'wood': ('old_wood', 0.0, 0.75, False),
    'cloth_red': ('newari_brick', 0.0, 0.9, True),
    'cloth_green': ('pastel_4', 0.0, 0.9, True),
    'eye_blue': ('tin_blue', 0.0, 0.6, False),
    'flag_blue': ('tin_blue', 0.0, 0.9, True),
    'flag_white': ('plaster_white', 0.0, 0.9, True),
    'flag_red': ('saffron', 0.0, 0.9, True),
    'flag_green': ('pastel_4', 0.0, 0.9, True),
    'flag_yellow': ('marigold', 0.0, 0.9, True),
}


def make_materials():
    out = {}
    for name, (key, metal, rough, double) in MATS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = srgb(PAL[key])
        b.inputs['Metallic'].default_value = metal
        b.inputs['Roughness'].default_value = rough
        m.use_backface_culling = not double
        out[name] = m
    return out


# --------------------------------------------------------------------------
# geometry buckets: one bmesh per material, joined into one mesh at the end
# --------------------------------------------------------------------------

B = {}


def bm(mat):
    if mat not in B:
        B[mat] = bmesh.new()
    return B[mat]


def M(x=0.0, y=0.0, z=0.0, rz=0.0, sx=1.0, sy=1.0, sz=1.0):
    return Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((sx, sy, sz, 1.0))


def box(mat, cx, cy, z0, w, d, h, rz=0.0):
    """Axis box w (local x) by d (local y), from z0 to z0+h, rotated rz about its centre."""
    bmesh.ops.create_cube(bm(mat), size=1.0, matrix=M(cx, cy, z0 + h / 2, rz, w, d, h))


def cyl(mat, cx, cy, z0, r0, r1, h, segs=16, cap=True):
    bmesh.ops.create_cone(bm(mat), cap_ends=cap, cap_tris=False, segments=segs,
                          radius1=r0, radius2=r1, depth=h, matrix=M(cx, cy, z0 + h / 2))


def sphere(mat, cx, cy, cz, r, segs=12, rings=8, sz=1.0):
    """UV sphere built with lathe (bmesh's create_uvsphere face order varies between runs)."""
    prof = [(r * math.sin(math.pi * i / rings) if 0 < i < rings else 0.0, cz - r * sz * math.cos(math.pi * i / rings))
            for i in range(rings + 1)]
    lathe(mat, prof, segs, cx, cy)


def lathe(mat, prof, segs, cx=0.0, cy=0.0, cap_bottom=False, face_mat=None):
    """Surface of revolution of prof [(r, z), ...] bottom to top. A last r of 0 closes to a point.
    face_mat(i_ring, j_seg) may return another material name for a face (quads only)."""
    rings = []
    for (r, z) in prof:
        if r <= 1e-6:
            rings.append(None)
            continue
        rings.append([(cx + r * math.cos(2 * math.pi * j / segs), cy + r * math.sin(2 * math.pi * j / segs), z)
                      for j in range(segs)])
    for i in range(len(prof) - 1):
        a, b_ = rings[i], rings[i + 1]
        for j in range(segs):
            k = (j + 1) % segs
            name = face_mat(i, j) if face_mat else mat
            g = bm(name)
            if b_ is None:
                tip = (cx, cy, prof[i + 1][1])
                vs = [g.verts.new(a[j]), g.verts.new(a[k]), g.verts.new(tip)]
            elif a is None:
                tip = (cx, cy, prof[i][1])
                vs = [g.verts.new(tip), g.verts.new(b_[k]), g.verts.new(b_[j])]
            else:
                vs = [g.verts.new(a[j]), g.verts.new(a[k]), g.verts.new(b_[k]), g.verts.new(b_[j])]
            g.faces.new(vs)
    if cap_bottom and rings[0] is not None:
        g = bm(mat)
        g.faces.new([g.verts.new(v) for v in reversed(rings[0])])
    top = rings[-1]
    if top is not None:
        g = bm(mat)
        g.faces.new([g.verts.new(v) for v in top])


def prism(mat, poly, z0, z1, rz=0.0, ox=0.0, oy=0.0):
    """Extrude a CCW polygon [(x, y)] from z0 to z1, rotated rz about the origin then moved to (ox, oy)."""
    c, s = math.cos(rz), math.sin(rz)
    pts = [(ox + x * c - y * s, oy + x * s + y * c) for (x, y) in poly]
    g = bm(mat)
    lo = [g.verts.new((x, y, z0)) for (x, y) in pts]
    hi = [g.verts.new((x, y, z1)) for (x, y) in pts]
    g.faces.new(list(reversed(lo)))
    g.faces.new(hi)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        g.faces.new([lo[i], lo[j], hi[j], hi[i]])


def frustum(mat, cx, cy, z0, w0, d0, w1, d1, h, rz=0.0):
    """Square-ish frustum (hipped roof shape): bottom w0 x d0, top w1 x d1 (0 = apex)."""
    c, s = math.cos(rz), math.sin(rz)

    def P(x, y, z):
        return (cx + x * c - y * s, cy + x * s + y * c, z)

    g = bm(mat)
    lo = [g.verts.new(P(sx * w0 / 2, sy * d0 / 2, z0)) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    if w1 <= 1e-6 and d1 <= 1e-6:
        apex = g.verts.new(P(0, 0, z0 + h))
        for i in range(4):
            g.faces.new([lo[i], lo[(i + 1) % 4], apex])
    else:
        hi = [g.verts.new(P(sx * w1 / 2, sy * d1 / 2, z0 + h)) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for i in range(4):
            g.faces.new([lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]])
        g.faces.new(hi)
    g.faces.new(list(reversed(lo)))


def strip_tube(mat, pts, r, segs=6):
    """Thin tube along a polyline (for eyebrows, rims, flag cords)."""
    g = bm(mat)
    rings = []
    for i, p in enumerate(pts):
        p = Vector(p)
        t = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        a = t.orthogonal().normalized()
        b_ = t.cross(a)
        rings.append([g.verts.new(p + r * (math.cos(2 * math.pi * k / segs) * a + math.sin(2 * math.pi * k / segs) * b_))
                      for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            m = (k + 1) % segs
            g.faces.new([rings[i][k], rings[i][m], rings[i + 1][m], rings[i + 1][k]])


def panel(mat, pts2d, frame, thick=0.08):
    """Flat panel from a 2D CCW outline (u right, v up) placed by frame = (origin, u_axis, v_axis, n_axis)."""
    o, u, v, n = (Vector(x) for x in frame)
    g = bm(mat)
    front = [g.verts.new(o + p[0] * u + p[1] * v + n * thick) for p in pts2d]
    back = [g.verts.new(o + p[0] * u + p[1] * v) for p in pts2d]
    g.faces.new(front)
    g.faces.new(list(reversed(back)))
    k = len(pts2d)
    for i in range(k):
        j = (i + 1) % k
        g.faces.new([back[i], back[j], front[j], front[i]])


def ellipse(n, a, b_, cx=0.0, cy=0.0, start=0.0, end=2 * math.pi):
    return [(cx + a * math.cos(start + (end - start) * i / n), cy + b_ * math.sin(start + (end - start) * i / n))
            for i in range(n)]


# --------------------------------------------------------------------------
# site layout (Blender X = east, Y = north, metres from the stupa centre)
# --------------------------------------------------------------------------

TERRACE = [(-24, 7), (-23, -4), (-16, -14), (-6, -18.5), (5, -25), (16, -25), (29, -13.5),
           (29, 2), (24, 8.5), (14, 14.5), (0, 19), (-12, 21.5), (-22, 18.5)]

# 5 Dhyani Buddha (big) and 5 Tara (small) shrines on the dome base (OSM node positions)
SHRINES = [
    ('B', -12.2, 0.1), ('B', 1.6, 12.7), ('B', 12.8, -2.5), ('B', 12.9, 1.9), ('B', -2.0, -12.4),
    ('T', -8.5, 8.7), ('T', 10.2, 7.2), ('T', 7.9, -9.8), ('T', -8.5, -8.5), ('T', 11.8, -5.1),
]

PRATAPPUR = (19.2, 6.0)
ANANTAPUR = (9.7, -19.2)
VAJRA = (25.0, -8.5)
STAIR_Y = -8.5
HARATI = (-17.4, 12.6, math.radians(-13.4))

CHAITYAS = [(-14.5, -13.0), (-18.5, -6.0), (-19.5, 2.5), (-6.5, -16.0), (1.5, -18.5), (-12.2, 19.5),
            (-4.0, 17.5), (5.5, 16.5), (20.0, -11.5), (16.5, -15.5), (-21.5, 9.0), (22.0, -3.5),
            (-9.5, -14.8), (10.0, 15.0)]


# --------------------------------------------------------------------------
# terrace and stair
# --------------------------------------------------------------------------


def terrace():
    prism('paving', TERRACE, T - 14.0, T)
    # retaining-wall coping around the edge, a slightly darker stone band
    n = len(TERRACE)
    for i in range(n):
        (x0, y0), (x1, y1) = TERRACE[i], TERRACE[(i + 1) % n]
        if x0 == 29 and x1 == 29:
            # east edge: leave the stair opening
            for (ya, yb) in ((y0, STAIR_Y - 3.2), (STAIR_Y + 3.2, y1)):
                if abs(yb - ya) > 0.5:
                    box('stone', 28.8, (ya + yb) / 2, T, 0.5, abs(yb - ya), 0.6)
            continue
        L = math.hypot(x1 - x0, y1 - y0)
        a = math.atan2(y1 - y0, x1 - x0)
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L  # inward for a CCW ring
        box('stone', mx + 0.25 * nx, my + 0.25 * ny, T, L, 0.5, 0.6, a)
    # circumambulation path ring around the stupa plinth
    lathe('stone', [(16.0, T), (16.0, T + 0.05), (13.6, T + 0.05)], 64)


def stair():
    """Top flight of the eastern stair (the 365 steps) descending east from the terrace."""
    x0, x1 = 29.0, 57.0
    rise, run = 0.17, 0.30
    nsteps = int((x1 - x0) / run)
    w = 5.0
    for i in range(nsteps):
        x = x0 + i * run
        top = T - (i + 1) * rise
        box('stone', x + run / 2, STAIR_Y, top - 2.5, run, w, 2.5)
    drop = nsteps * rise
    # solid under the flight and the side parapets
    g = bm('stone')
    yl, yr = STAIR_Y - w / 2 - 0.5, STAIR_Y + w / 2 + 0.5
    for (ya, yb, ztop) in ((yl, STAIR_Y - w / 2, 0.9), (STAIR_Y + w / 2, yr, 0.9)):
        q = [(x0, ya, T + ztop), (x1, ya, T - drop + ztop), (x1, yb, T - drop + ztop), (x0, yb, T + ztop)]
        b = [(x0, ya, T - 14.0), (x1, ya, T - drop - 8.0), (x1, yb, T - drop - 8.0), (x0, yb, T - 14.0)]
        tv = [g.verts.new(v) for v in q]
        bv = [g.verts.new(v) for v in b]
        g.faces.new(tv)
        g.faces.new(list(reversed(bv)))
        for k in range(4):
            m = (k + 1) % 4
            g.faces.new([bv[k], bv[m], tv[m], tv[k]])
    # under-stair fill
    q = [(x0, STAIR_Y - w / 2, T - 2.0), (x1, STAIR_Y - w / 2, T - drop - 2.0),
         (x1, STAIR_Y + w / 2, T - drop - 2.0), (x0, STAIR_Y + w / 2, T - 2.0)]
    b = [(x0, STAIR_Y - w / 2, T - 14.0), (x1, STAIR_Y - w / 2, T - drop - 8.0),
         (x1, STAIR_Y + w / 2, T - drop - 8.0), (x0, STAIR_Y + w / 2, T - 14.0)]
    tv = [g.verts.new(v) for v in q]
    bv = [g.verts.new(v) for v in b]
    g.faces.new(list(reversed(bv)))
    for k in range(4):
        m = (k + 1) % 4
        g.faces.new([bv[k], bv[m], tv[m], tv[k]])
    # small stone chaityas on the parapets, every ~5 m
    for i in range(1, 6):
        x = x0 + i * (x1 - x0) / 6
        zt = T - (x - x0) / run * rise + 0.9
        for y in (yl + 0.25, yr - 0.25):
            chaitya(x, y, zt, 0.35, white=False)


# --------------------------------------------------------------------------
# the great stupa
# --------------------------------------------------------------------------

DOME_R = 11.0
DOME_Z0 = T + 1.6     # dome springing line (top of the drum)
DOME_H = 8.6
DOME_TOP_R = 3.6      # flat top under the harmika
HARMIKA_W = 5.6
HARMIKA_Z0 = DOME_Z0 + DOME_H + 0.55
HARMIKA_H = 4.0


def dome_profile():
    prof = [(13.4, T), (13.4, T + 0.6), (12.9, T + 0.6), (11.6, T + 0.6), (11.6, DOME_Z0 - 0.2),
            (11.3, DOME_Z0 - 0.2), (11.3, DOME_Z0)]
    # flattened hemispherical anda; stop at the flat top
    t_end = math.acos(DOME_TOP_R / DOME_R)
    n = 22
    for i in range(n + 1):
        t = t_end * i / n
        prof.append((DOME_R * math.cos(t), DOME_Z0 + DOME_H * math.sin(t) / math.sin(t_end)))
    return prof


def stupa():
    prof = dome_profile()
    segs = 96
    first_dome = 7  # index of the springing ring in prof
    petals = 16

    def face_mat(i, j):
        if i < 3:
            return 'stone'
        if i < first_dome:
            return 'whitewash'
        # saffron lotus petals painted down from the crown
        r_hi = prof[i + 1][0]
        colat = math.degrees(math.acos(min(1.0, r_hi / DOME_R)))
        top = math.degrees(math.acos(DOME_TOP_R / DOME_R))
        phi = (j + 0.5) / segs * petals
        s = abs((phi % 1.0) - 0.5) * 2.0  # 0 at petal centre, 1 at the gap
        reach = 9.0 + 13.0 * (1.0 - s * s)  # degrees down from the crown
        return 'saffron' if (top - colat) < reach and (top - colat) > 0.0 else 'whitewash'

    lathe('whitewash', prof, segs, face_mat=face_mat)
    # thin saffron ring where petals meet the harmika base
    cyl('saffron', 0, 0, DOME_Z0 + DOME_H - 0.02, DOME_TOP_R + 0.25, DOME_TOP_R, 0.08, 48)

    # harmika: white two-step base, gilded cube with eyes, cornice, cloth, toranas
    hz = DOME_Z0 + DOME_H
    box('whitewash', 0, 0, hz, HARMIKA_W + 1.4, HARMIKA_W + 1.4, 0.3)
    box('whitewash', 0, 0, hz + 0.3, HARMIKA_W + 0.8, HARMIKA_W + 0.8, 0.25)
    z0 = HARMIKA_Z0
    box('gilt', 0, 0, z0, HARMIKA_W, HARMIKA_W, HARMIKA_H)
    for k in range(4):
        eyes(k * math.pi / 2, z0)
    zc = z0 + HARMIKA_H
    # red and green drapery hanging over the top of the harmika
    box('cloth_red', 0, 0, zc - 1.0, HARMIKA_W + 0.24, HARMIKA_W + 0.24, 0.75)
    box('cloth_green', 0, 0, zc - 0.4, HARMIKA_W + 0.3, HARMIKA_W + 0.3, 0.3)
    box('gilt', 0, 0, zc - 0.1, HARMIKA_W + 0.9, HARMIKA_W + 0.9, 0.35)
    box('gilt', 0, 0, zc + 0.25, HARMIKA_W + 0.5, HARMIKA_W + 0.5, 0.25)
    for k in range(4):
        torana(k * math.pi / 2, zc + 0.5)
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        pinnacle(sx * (HARMIKA_W / 2 + 0.2), sy * (HARMIKA_W / 2 + 0.2), zc + 0.5, 0.28, 1.3)

    # thirteen gilded rings (trayodasha bhuvana)
    sz = zc + 0.5
    r0, r1, hspire = 3.0, 1.05, 7.6
    step = hspire / 13
    for i in range(13):
        t0, t1 = i / 13, (i + 1) / 13
        ra = r0 + (r1 - r0) * (t0 ** 0.9)
        rb = r0 + (r1 - r0) * (t1 ** 0.9)
        za = sz + i * step
        cyl('gilt', 0, 0, za, ra, ra - 0.08, step * 0.72, 40)
        cyl('dark', 0, 0, za + step * 0.72, ra - 0.22, rb - 0.15, step * 0.28, 40, cap=False)
    top = sz + hspire
    # chattra (canopy) with a cloth valance, then the gajur finial
    cyl('gilt', 0, 0, top, 0.9, 0.9, 0.5, 24)
    cyl('cloth_red', 0, 0, top + 0.5, 1.75, 1.75, 0.45, 32, cap=False)
    lathe('gilt', [(1.95, top + 0.9), (1.85, top + 1.05), (1.2, top + 1.55), (0.5, top + 1.85), (0.35, top + 1.95)], 32)
    lathe('gilt', [(0.35, top + 1.95), (0.6, top + 2.2), (0.68, top + 2.5), (0.5, top + 2.85), (0.22, top + 3.0),
                   (0.42, top + 3.25), (0.4, top + 3.6), (0.15, top + 3.85), (0.25, top + 4.1), (0.0, top + 4.9)], 20)
    for (kind, x, y) in SHRINES:
        shrine(kind, x, y)
    prayer_wheels()
    return top + 0.7  # height where the flag lines meet the spire


def eyes(rz, z0):
    """Buddha eyes, brows, urna and the nose sign on one harmika face (face normal at angle rz)."""
    c, s = math.cos(rz), math.sin(rz)
    n = Vector((c, s, 0.0))
    u = Vector((-s, c, 0.0))  # to the right when looking at the face
    v = Vector((0.0, 0.0, 1.0))
    o = n * (HARMIKA_W / 2) + v * z0
    fr = (o, u, v, n)
    for side in (-1, 1):
        ex, ey = side * 1.15, 2.45
        panel('whitewash', ellipse(16, 0.78, 0.30, ex, ey), fr, 0.03)
        panel('eye_blue', ellipse(12, 0.24, 0.24, ex + side * 0.1, ey - 0.02), (o + n * 0.03, u, v, n), 0.02)
        panel('dark', ellipse(10, 0.13, 0.13, ex + side * 0.1, ey - 0.02), (o + n * 0.05, u, v, n), 0.02)
        # upper lid line and brow
        lid = [o + n * 0.05 + u * (ex + 0.8 * math.cos(a)) + v * (ey + 0.32 * math.sin(a))
               for a in [math.radians(d) for d in range(10, 171, 20)]]
        strip_tube('dark', lid, 0.05)
        brow = [o + n * 0.03 + u * (ex + 0.95 * math.cos(a)) + v * (ey + 0.35 + 0.42 * math.sin(a))
                for a in [math.radians(d) for d in range(20, 161, 20)]]
        strip_tube('dark', brow, 0.06)
    # urna (third eye) and the curling nose sign
    panel('cloth_red', ellipse(8, 0.12, 0.16, 0.0, 3.05), fr, 0.04)
    nose = [o + n * 0.04 + u * (0.32 * math.cos(a)) + v * (1.75 + 0.3 * math.sin(a))
            for a in [math.radians(d) for d in range(90, 400, 30)]]
    nose += [o + n * 0.04 + u * (0.05 - 0.02 * k) + v * (1.4 - 0.25 * k) for k in range(4)]
    strip_tube('dark', nose, 0.07)


def torana(rz, z0):
    """Gilded pentagonal torana above each harmika face."""
    c, s = math.cos(rz), math.sin(rz)
    n = Vector((c, s, 0.0))
    u = Vector((-s, c, 0.0))
    v = Vector((0.0, 0.0, 1.0))
    o = n * (HARMIKA_W / 2 + 0.05) + v * z0
    w, h = 2.4, 2.9
    outline = [(-w, 0), (w, 0), (w, 1.4), (0.0, h), (-w, 1.4)]
    panel('gilt', outline, (o, u, v, n), 0.22)
    # five seated Buddhas in relief: small rounded bumps
    for k, (bx, by) in enumerate(((-1.6, 0.55), (-0.8, 0.55), (0.0, 0.55), (0.8, 0.55), (1.6, 0.55))):
        p = o + n * 0.25 + u * bx + v * by
        sphere('gilt', p.x, p.y, p.z, 0.28, 8, 5, 1.3)
        p2 = o + n * 0.25 + u * bx + v * (by + 0.45)
        sphere('gilt', p2.x, p2.y, p2.z, 0.15, 8, 5)
    # the top Buddha in the gable
    p = o + n * 0.25 + v * 1.9
    sphere('gilt', p.x, p.y, p.z, 0.34, 8, 5, 1.3)


def pinnacle(x, y, z0, r, h):
    cyl('gilt', x, y, z0, r, r, h * 0.25, 10)
    sphere('gilt', x, y, z0 + h * 0.42, r * 1.05, 10, 6, 1.2)
    cyl('gilt', x, y, z0 + h * 0.55, r * 0.7, 0.0, h * 0.45, 10)


def shrine(kind, x, y):
    """Gilded shrine set against the dome base, facing outwards."""
    big = kind == 'B'
    a = math.atan2(y, x)
    r = 11.15 if big else 11.25
    cx, cy = r * math.cos(a), r * math.sin(a)
    w, d, h = (3.0, 2.4, 3.2) if big else (1.6, 1.4, 1.9)
    rz = a + math.pi / 2  # local x along the tangent, local y outwards
    zb = T + 0.6
    box('stone', cx, cy, zb, w + 0.4, d + 0.3, 0.45, rz)
    zb += 0.45
    box('gilt', cx, cy, zb, w, d, h, rz)
    # dark grilled niche on the outward face
    nx, ny = math.cos(a), math.sin(a)
    box('dark', cx + nx * (d / 2), cy + ny * (d / 2), zb + h * 0.18, w * 0.5, 0.1, h * 0.55, rz)
    # flanking pilasters
    for side in (-1, 1):
        tx, ty = -math.sin(a) * side * (w / 2 - 0.15), math.cos(a) * side * (w / 2 - 0.15)
        box('gilt', cx + tx + nx * (d / 2), cy + ty + ny * (d / 2), zb, 0.3, 0.2, h, rz)
    z = zb + h
    # three receding tiers of gilded eaves
    tiers = 3 if big else 2
    tw, td = w + 0.5, d + 0.4
    for t in range(tiers):
        frustum('gilt', cx, cy, z, tw, td, tw * 0.78, td * 0.78, 0.35, rz)
        z += 0.35
        tw *= 0.78
        td *= 0.78
        box('gilt', cx, cy, z, tw * 0.85, td * 0.85, 0.32 if big else 0.25, rz)
        z += 0.32 if big else 0.25
    # crowning pinnacles
    for off in ((-0.32, 1.2), (0.0, 1.5), (0.32, 1.2)) if big else ((0.0, 0.9),):
        tx, ty = -math.sin(a) * off[0] * w, math.cos(a) * off[0] * w
        pinnacle(cx + tx, cy + ty, z, 0.17 if big else 0.12, off[1])
    # gilt flag banners on poles either side
    if big:
        for side in (-1, 1):
            tx, ty = -math.sin(a) * side * (w / 2 + 0.6), math.cos(a) * side * (w / 2 + 0.6)
            px, py = cx + tx + nx * 1.0, cy + ty + ny * 1.0
            cyl('dark', px, py, T + 0.6, 0.05, 0.05, 3.6, 6)
            box('gilt', px + tx * 0.12, py + ty * 0.12, T + 3.2, 0.8, 0.04, 0.35, rz)
            box('gilt', px + tx * 0.12, py + ty * 0.12, T + 2.7, 0.8, 0.04, 0.35, rz)


def prayer_wheels():
    """Ring of prayer wheels under a narrow metal canopy, between the shrines."""
    R = 12.35
    blocked = []
    for (kind, x, y) in SHRINES:
        a = math.atan2(y, x)
        half = (1.9 if kind == 'B' else 1.1) / R
        blocked.append((a, half))

    def free(a):
        for (b, half) in blocked:
            dd = (a - b + math.pi) % (2 * math.pi) - math.pi
            if abs(dd) < half + 0.02:
                return False
        return True

    n = 150
    run = []
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n
        if free(a):
            x, y = R * math.cos(a), R * math.sin(a)
            cyl('bronze', x, y, T + 0.95, 0.17, 0.17, 0.5, 10)
            cyl('dark', x, y, T + 0.6, 0.03, 0.03, 1.7, 4, cap=False)
            run.append(a)
        elif run:
            canopy(run)
            run = []
    if run:
        canopy(run)


def canopy(angles):
    """Short curved roof and rail over a run of wheels."""
    if len(angles) < 2:
        return
    a0, a1 = angles[0] - 0.02, angles[-1] + 0.02
    k = max(2, len(angles))
    g = bm('canopy')
    zr, ri, ro = T + 2.35, 11.75, 12.95
    inner = [g.verts.new((ri * math.cos(a0 + (a1 - a0) * i / k), ri * math.sin(a0 + (a1 - a0) * i / k), zr + 0.15))
             for i in range(k + 1)]
    outer = [g.verts.new((ro * math.cos(a0 + (a1 - a0) * i / k), ro * math.sin(a0 + (a1 - a0) * i / k), zr))
             for i in range(k + 1)]
    for i in range(k):
        g.faces.new([inner[i], outer[i], outer[i + 1], inner[i + 1]])
    # outer decorative railing band
    lo = [g.verts.new((12.85 * math.cos(a0 + (a1 - a0) * i / k), 12.85 * math.sin(a0 + (a1 - a0) * i / k), T + 0.7))
          for i in range(k + 1)]
    hi = [g.verts.new((12.85 * math.cos(a0 + (a1 - a0) * i / k), 12.85 * math.sin(a0 + (a1 - a0) * i / k), T + 1.6))
          for i in range(k + 1)]
    for i in range(k):
        g.faces.new([lo[i], lo[i + 1], hi[i + 1], hi[i]])
    for a in (a0, a1):
        cyl('dark', 12.85 * math.cos(a), 12.85 * math.sin(a), T + 0.6, 0.07, 0.07, 1.9, 6)


# --------------------------------------------------------------------------
# shikharas, vajra, Harati temple, chaityas
# --------------------------------------------------------------------------


def shikhara(cx, cy, scale=1.0, height=17.0):
    """Pratappur / Anantapur: white curvilinear tower on a square pavilion."""
    s = scale
    zb = T
    box('stone', cx, cy, zb, 8.0 * s, 8.0 * s, 0.5)
    zb += 0.5
    # square pavilion: white walls, red band, small dark windows and a dark metal roof skirt
    box('whitewash', cx, cy, zb, 6.6 * s, 6.6 * s, 3.4)
    box('cloth_red', cx, cy, zb + 2.75, 6.7 * s, 6.7 * s, 0.3)
    box('cloth_red', cx, cy, zb, 6.7 * s, 6.7 * s, 0.25)
    for k in range(4):
        a = k * math.pi / 2
        for t in (-1.8, 0.0, 1.8):
            px = cx + math.cos(a) * 3.3 * s - math.sin(a) * t * s
            py = cy + math.sin(a) * 3.3 * s + math.cos(a) * t * s
            box('dark', px, py, zb + 0.9, 0.7, 0.7, 1.3, a)
    frustum('dark', cx, cy, zb + 3.3, 8.6 * s, 8.6 * s, 5.6 * s, 5.6 * s, 1.0)
    zb += 4.3
    box('whitewash', cx, cy, zb, 5.4 * s, 5.4 * s, 0.6)
    zb += 0.6
    # curvilinear tower: stepped-square (pancha-ratha) section lofted on a convex curve
    top_z = T + height - 2.6
    H = top_z - zb
    w0, w1 = 2.5 * s, 0.8 * s

    def section(hw):
        o = hw * 0.9
        i = hw * 0.5
        q = []
        for k in range(4):
            a = k * math.pi / 2
            c, sn = math.cos(a), math.sin(a)
            for (x, y) in ((hw, -i), (hw, i), (o, i), (o, o), (i, o), (i, hw)):
                q.append((x * c - y * sn, x * sn + y * c))
        return q

    rings = 18
    g = bm('whitewash')
    prev = None
    for k in range(rings + 1):
        t = k / rings
        hw = w0 + (w1 - w0) * (t ** 2.4)
        z = zb + H * t
        ring = [g.verts.new((cx + x, cy + y, z)) for (x, y) in section(hw)]
        if prev:
            n = len(ring)
            for j in range(n):
                m = (j + 1) % n
                g.faces.new([prev[j], prev[m], ring[m], ring[j]])
        prev = ring
    g.faces.new(prev)
    # red band, amalaka, gilt crown and finial
    box('cloth_red', cx, cy, top_z - 0.9, 2.1 * w1 + 0.1, 2.1 * w1 + 0.1, 0.45)
    lathe('whitewash', [(0.95 * s, top_z), (1.2 * s, top_z + 0.3), (0.95 * s, top_z + 0.6), (0.6 * s, top_z + 0.7)], 20, cx, cy)
    lathe('gilt', [(0.7 * s, top_z + 0.7), (0.55 * s, top_z + 1.0), (0.5 * s, top_z + 1.3), (0.25 * s, top_z + 1.6),
                   (0.3 * s, top_z + 1.9), (0.0, top_z + 2.6)], 14, cx, cy)
    # small corner turrets
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        tx, ty = cx + sx * 2.35 * s, cy + sy * 2.35 * s
        box('whitewash', tx, ty, T + 5.4, 0.7, 0.7, 1.0)
        cyl('gilt', tx, ty, T + 6.4, 0.28, 0.0, 0.8, 8)


def vajra(x, y):
    # drum pedestal with carved animals (bronze), lotus rim
    cyl('stone', x, y, T, 2.0, 2.0, 0.35, 24)
    cyl('bronze', x, y, T + 0.35, 1.55, 1.55, 1.1, 24)
    cyl('bronze', x, y, T + 1.45, 1.75, 1.6, 0.3, 24)
    cyl('gilt', x, y, T + 1.75, 1.45, 1.45, 0.2, 24)
    # horizontal vajra along the east-west axis
    zc = T + 2.45
    sphere('gilt', x, y, zc, 0.36, 16, 10)
    for side in (-1, 1):
        for (off, r) in ((0.42, 0.24), (0.62, 0.36), (0.78, 0.3)):
            sphere('gilt', x + side * off, y, zc, r, 14, 8, 1.0)
        # four curved outer prongs and the central prong
        base = Vector((x + side * 0.9, y, zc))
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 4
            pts = []
            for i in range(7):
                t = i / 6
                out = math.sin(t * math.pi) * 0.42
                pts.append(base + Vector((side * 1.15 * t, out * math.cos(a), out * math.sin(a))))
            strip_tube('gilt', pts, 0.06, 6)
        cyl_x('gilt', x + side * 1.5, y, zc, 0.07, 1.25, side)


def cyl_x(mat, cx, cy, cz, r, length, side):
    bmesh.ops.create_cone(bm(mat), cap_ends=True, cap_tris=False, segments=8, radius1=r, radius2=0.01, depth=length,
                          matrix=Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(side * math.pi / 2, 4, 'Y'))


def harati(x, y, rz):
    box('stone', x, y, T, 7.0, 7.0, 0.6, rz)
    z = T + 0.6
    box('brick', x, y, z, 5.6, 5.6, 3.0, rz)
    box('wood', x, y, z + 0.9, 5.7, 5.7, 1.3, rz)  # carved wooden window band
    box('wood', x, y, z + 3.0, 6.0, 6.0, 0.25, rz)
    frustum('gilt', x, y, z + 3.25, 8.4, 8.4, 4.2, 4.2, 1.5, rz)
    box('brick', x, y, z + 4.75, 3.8, 3.8, 1.5, rz)
    box('wood', x, y, z + 6.25, 4.2, 4.2, 0.2, rz)
    frustum('gilt', x, y, z + 6.45, 6.2, 6.2, 0.0, 0.0, 2.2, rz)
    pinnacle(x, y, z + 8.3, 0.22, 1.6)


def chaitya(x, y, z0, s, white=True):
    """Votive chaitya: square base, dome, little harmika, pointed spire."""
    body = 'whitewash' if white else 'stone'
    top = 'gilt' if white else 'stone'
    box('stone', x, y, z0, 1.9 * s, 1.9 * s, 0.35 * s)
    box(body, x, y, z0 + 0.35 * s, 1.35 * s, 1.35 * s, 0.6 * s)
    z = z0 + 0.95 * s
    lathe(body, [(0.78 * s, z)] + [(0.78 * s * math.cos(t * math.pi / 12), z + 0.7 * s * math.sin(t * math.pi / 12))
                                  for t in range(1, 6)] + [(0.0, z + 0.72 * s)], 12, x, y)
    box(top, x, y, z + 0.6 * s, 0.5 * s, 0.5 * s, 0.4 * s)
    cyl(top, x, y, z + 1.0 * s, 0.3 * s, 0.0, 1.1 * s, 10)


# --------------------------------------------------------------------------
# prayer flags
# --------------------------------------------------------------------------

FLAG_MATS = ('flag_blue', 'flag_white', 'flag_red', 'flag_green', 'flag_yellow')


def flags(z_top):
    """Lines of prayer flags fanning from the spire down to poles at the terrace edge."""
    anchors = []
    for i in range(16):
        a = 2 * math.pi * (i + 0.5) / 16 + 0.13 * math.sin(i * 2.3)
        rr = 24.0 + 4.0 * math.sin(i * 1.7)
        anchors.append((rr * math.cos(a), rr * math.sin(a)))
    for (ax, ay) in anchors:
        zt = T + 6.0
        cyl('wood', ax, ay, T - 10.0, 0.09, 0.07, zt - (T - 10.0) + 0.3, 6)
        start = Vector((0.0, 0.0, z_top))
        dirv = Vector((ax, ay, 0.0)).normalized()
        start += dirv * 1.3
        end = Vector((ax, ay, zt))
        L = (end - start).length
        n = int(L / 0.42)
        side = Vector((-dirv.y, dirv.x, 0.0))
        for k in range(1, n):
            t = k / n
            p = start.lerp(end, t)
            p.z -= 2.2 * math.sin(math.pi * t)  # sag
            q = start.lerp(end, min(1.0, t + 0.6 / n))
            q.z -= 2.2 * math.sin(math.pi * min(1.0, t + 0.6 / n))
            along = (q - p)
            g = bm(FLAG_MATS[k % 5])
            off = side * 0.004 * ((k % 3) - 1)
            v = [g.verts.new(p + off), g.verts.new(p + along + off),
                 g.verts.new(p + along + off + Vector((0, 0, -0.38))), g.verts.new(p + off + Vector((0, 0, -0.38)))]
            g.faces.new(v)


# --------------------------------------------------------------------------
# assemble
# --------------------------------------------------------------------------


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    B.clear()


def build():
    clear()
    mats = make_materials()
    terrace()
    stair()
    z_flags = stupa()
    shikhara(*PRATAPPUR)
    shikhara(*ANANTAPUR)
    vajra(*VAJRA)
    harati(*HARATI)
    for (x, y) in CHAITYAS:
        chaitya(x, y, T, 1.15 if (abs(x) + abs(y)) % 3 < 1.5 else 0.9)
    flags(z_flags)

    root = bpy.data.objects.new('swayambhunath', None)
    bpy.context.scene.collection.objects.link(root)
    tris = 0
    for name in sorted(B):
        g = B[name]
        # triangulate here so the exported index order never depends on the exporter's n-gon split
        bmesh.ops.triangulate(g, faces=g.faces[:], quad_method='FIXED', ngon_method='EAR_CLIP')
        me = bpy.data.meshes.new(name)
        g.to_mesh(me)
        g.free()
        me.materials.append(mats[name])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = root
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
    B.clear()
    print(f'swayambhunath: {tris} triangles')
    return tris


def export(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              use_selection=False, export_extras=False, export_cameras=False, export_lights=False)
    print(f'swayambhunath: wrote {path}')


if __name__ == '__main__':
    build()
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--out' in argv:
        export(argv[argv.index('--out') + 1])
