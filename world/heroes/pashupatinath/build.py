"""Pashupatinath: the main temple, its courtyard and the ghats on the Bagmati.

Pure bpy, deterministic, no external assets. Blender frame: X = east, Y = north,
Z = up, metres. Origin = ground level at the anchor (centroid of the temple
footprint in OpenStreetMap, way 1826340630).

The whole complex is laid out square to the temple, which OpenStreetMap shows
turned 37.2 degrees clockwise from north. Everything below is authored in that
temple frame (u = the temple's east axis, towards the river; v = its north axis,
upstream) and turned into the Blender frame at the end, so rotationDeg stays 0.
The glTF export (+Y up) maps Blender +Y (north) to -Z, the world frame.

Positions come from the OpenStreetMap features of tiles x19_y18 and x19_y17.
Terrace, ghat and water levels are chosen against the 12.5 m terrain grid of
those tiles, which does not resolve the river trench: every surface sits above
the rendered ground and walls reach SKIRT below the anchor.

Usage:
  Blender -b -P build.py                       # build the scene only
  Blender -b -P build.py -- --out model.glb    # build and export
  Blender -b -P build.py -- --layout out.json  # also write terrace outlines (temple frame)
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROT = math.radians(-37.2)   # temple frame -> east/north
SKIRT = -9.0                # bottom of every retaining wall

# levels above the anchor ground (metres)
C1 = 3.0                    # inner courtyard around the temple
C2 = 4.9                    # western upper terrace
P1, P2, P3 = -3.6, -2.5, -1.4   # river pools, downstream to upstream
G1, G2, G3, G4 = -2.3, -1.2, -0.1, 1.8   # ghat promenade levels
BR = -2.0                   # bridge deck

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
    'plaster_white': '#e8e2d6', 'pastel_1': '#d9c8b4', 'pastel_2': '#c6d3dc', 'pastel_4': '#cdd8c3',
    'rcc_grey': '#9a9790', 'tin_blue': '#3b6ea5', 'marigold': '#f2a81d',
    'saffron': '#e07a1f', 'asphalt': '#3b3b3b', 'dust': '#b89f7e',
}
PAL.update(_palette())


def srgb(h, k=1.0):
    h = h.lstrip('#')
    c = [k * int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


# name: (palette key, brightness factor, metallic, roughness, double sided)
MATS = {
    'gilt': ('marigold', 1.0, 0.35, 0.45, False),
    'gilt_dark': ('marigold', 0.72, 0.35, 0.5, False),
    'wood': ('old_wood', 1.0, 0.0, 0.75, False),
    'wood_dark': ('old_wood', 0.62, 0.0, 0.8, False),
    'whitewash': ('plaster_white', 1.0, 0.0, 0.85, False),
    'stone': ('rcc_grey', 1.0, 0.0, 0.9, False),
    'stone_dark': ('rcc_grey', 0.58, 0.0, 0.9, False),
    'paving': ('dust', 1.0, 0.0, 0.95, False),
    'brick': ('newari_brick', 1.0, 0.0, 0.85, False),
    'tin': ('rcc_grey', 0.55, 0.3, 0.55, False),
    'tile': ('tile_roof', 1.0, 0.0, 0.8, True),
    'dark': ('asphalt', 1.0, 0.0, 0.7, False),
    'water': ('pastel_4', 0.45, 0.0, 0.15, False),
    'foam': ('pastel_2', 0.95, 0.0, 0.5, False),
    'ash': ('asphalt', 0.55, 0.0, 1.0, False),
    'blue': ('tin_blue', 1.0, 0.0, 0.6, False),
    'pennant': ('saffron', 1.0, 0.0, 0.9, True),
}


def make_materials():
    out = {}
    for name, (key, k, metal, rough, double) in MATS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = srgb(PAL[key], k)
        b.inputs['Metallic'].default_value = metal
        b.inputs['Roughness'].default_value = rough
        m.use_backface_culling = not double
        out[name] = m
    return out


# --------------------------------------------------------------------------
# geometry buckets: one bmesh per material, one mesh per material at the end
# --------------------------------------------------------------------------

B = {}
LAYOUT = []   # (name, [(u, v)], top) for the terrain check


def bm(mat):
    if mat not in B:
        B[mat] = bmesh.new()
    return B[mat]


def M(x=0.0, y=0.0, z=0.0, rz=0.0, sx=1.0, sy=1.0, sz=1.0):
    return Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((sx, sy, sz, 1.0))


def box(mat, cx, cy, z0, w, d, h, rz=0.0):
    """Box w (local x) by d (local y), from z0 to z0+h, rotated rz about its centre."""
    bmesh.ops.create_cube(bm(mat), size=1.0, matrix=M(cx, cy, z0 + h / 2, rz, w, d, h))


def cyl(mat, cx, cy, z0, r0, r1, h, segs=16, cap=True):
    bmesh.ops.create_cone(bm(mat), cap_ends=cap, cap_tris=False, segments=segs,
                          radius1=r0, radius2=r1, depth=h, matrix=M(cx, cy, z0 + h / 2))


def lathe(mat, prof, segs, cx=0.0, cy=0.0, cap_bottom=False):
    """Surface of revolution of prof [(r, z), ...] bottom to top. A last r of 0 closes to a point."""
    rings = []
    for (r, z) in prof:
        if r <= 1e-6:
            rings.append(None)
            continue
        rings.append([(cx + r * math.cos(2 * math.pi * j / segs), cy + r * math.sin(2 * math.pi * j / segs), z)
                      for j in range(segs)])
    g = bm(mat)
    for i in range(len(prof) - 1):
        a, b_ = rings[i], rings[i + 1]
        for j in range(segs):
            k = (j + 1) % segs
            if b_ is None:
                vs = [g.verts.new(a[j]), g.verts.new(a[k]), g.verts.new((cx, cy, prof[i + 1][1]))]
            elif a is None:
                vs = [g.verts.new((cx, cy, prof[i][1])), g.verts.new(b_[k]), g.verts.new(b_[j])]
            else:
                vs = [g.verts.new(a[j]), g.verts.new(a[k]), g.verts.new(b_[k]), g.verts.new(b_[j])]
            g.faces.new(vs)
    if cap_bottom and rings[0] is not None:
        g.faces.new([g.verts.new(v) for v in reversed(rings[0])])
    if rings[-1] is not None:
        g.faces.new([g.verts.new(v) for v in rings[-1]])


def ellipsoid(mat, c, r, segs=12, rings=8, rz=0.0):
    """Ellipsoid with semi-axes r = (rx, ry, rz) about centre c, turned rz about Z."""
    cr, sr = math.cos(rz), math.sin(rz)
    g = bm(mat)

    def P(i, j):
        t = math.pi * i / rings
        p = 2 * math.pi * j / segs
        x, y, z = r[0] * math.sin(t) * math.cos(p), r[1] * math.sin(t) * math.sin(p), -r[2] * math.cos(t)
        return (c[0] + x * cr - y * sr, c[1] + x * sr + y * cr, c[2] + z)

    bot = g.verts.new(P(0, 0))
    top = g.verts.new(P(rings, 0))
    grid = [[g.verts.new(P(i, j)) for j in range(segs)] for i in range(1, rings)]
    for j in range(segs):
        k = (j + 1) % segs
        g.faces.new([bot, grid[0][k], grid[0][j]])
        g.faces.new([grid[-1][j], grid[-1][k], top])
    for i in range(rings - 2):
        for j in range(segs):
            k = (j + 1) % segs
            g.faces.new([grid[i][j], grid[i][k], grid[i + 1][k], grid[i + 1][j]])


def prism(mat, poly, z0, z1, side=None, name=None):
    """Extrude a CCW polygon [(x, y)] from z0 to z1; side = material of the walls."""
    if name:
        LAYOUT.append((name, [tuple(p) for p in poly], z1))
    g = bm(mat)
    lo = [g.verts.new((x, y, z0)) for (x, y) in poly]
    hi = [g.verts.new((x, y, z1)) for (x, y) in poly]
    g.faces.new(list(reversed(lo)))
    g.faces.new(hi)
    s = bm(side or mat)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        q = [s.verts.new(v.co) for v in (lo[i], lo[j], hi[j], hi[i])]
        s.faces.new(q)


def frustum(mat, cx, cy, z0, w0, d0, w1, d1, h, rz=0.0, bottom=True):
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
    if bottom:
        g.faces.new(list(reversed(lo)))


def tube(mat, pts, r, segs=6):
    """Thin tube along a polyline."""
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


def arch_outline(w, h, n=8):
    """Door outline: rectangle w wide with a semicircular head, total height h."""
    r = w / 2
    pts = [(-r, 0.0), (r, 0.0)]
    for i in range(n + 1):
        a = math.pi * i / n
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    return pts


def face_frame(cx, cy, z0, rz, half):
    """Frame on the outward face (normal at angle rz) of a square of half-size half centred at cx, cy."""
    n = Vector((math.cos(rz), math.sin(rz), 0.0))
    u = Vector((-math.sin(rz), math.cos(rz), 0.0))
    return (Vector((cx, cy, z0)) + n * half, u, Vector((0.0, 0.0, 1.0)), n)


def pinnacle(mat, x, y, z0, r, h):
    """Gilt finial: drum, bulb, spike."""
    cyl(mat, x, y, z0, r, r, h * 0.25, 10)
    lathe(mat, [(r, z0 + h * 0.25), (r * 1.15, z0 + h * 0.4), (r * 0.9, z0 + h * 0.55), (r * 0.45, z0 + h * 0.62),
                (r * 0.55, z0 + h * 0.7), (0.0, z0 + h)], 10, x, y)


# --------------------------------------------------------------------------
# river banks (temple frame)
# --------------------------------------------------------------------------

# OSM river edges (u at v), from the Bagmati multipolygon a1502933512
U_WEST = [(-76, 45.0), (-72, 43.3), (-68, 41.7), (-64, 41.0), (-56, 40.8), (-48, 40.6), (-44, 39.8), (-40, 38.8),
          (-36, 37.8), (-32, 37.3), (-28, 37.2), (-20, 36.9), (-12, 37.1), (0, 37.5), (8, 37.8), (16, 37.4),
          (24, 36.4), (36, 36.3)]
U_EAST = [(-76, 64.3), (-72, 62.3), (-68, 60.4), (-64, 59.6), (-60, 59.1), (-56, 58.6), (-52, 58.2), (-48, 57.7),
          (-44, 57.2), (-40, 56.8), (-36, 56.3), (-32, 55.8), (-28, 55.4), (-24, 54.9), (-20, 54.4), (-16, 54.1),
          (-12, 53.8), (-8, 53.5), (-4, 53.2), (0, 53.0), (4, 52.7), (8, 52.4), (12, 52.1)]


def interp(tab, v):
    if v <= tab[0][0]:
        return tab[0][1]
    for (v0, u0), (v1, u1) in zip(tab, tab[1:]):
        if v <= v1:
            return u0 + (u1 - u0) * (v - v0) / (v1 - v0)
    return tab[-1][1]


def vsamples(tab, v0, v1):
    return [v0] + [v for (v, _) in tab if v0 < v < v1] + [v1]


def bank_profile(u_face, u_back, top, pool, east):
    """Closed (u, z) outline of a bank cut at one v: terrace at `top` from u_back to the river face u_face,
    stepping down to the pool (if any). east=True when the river lies to the west of the bank."""
    s = -1.0 if east else 1.0          # +u runs from the terrace towards the river on the west bank
    if pool is None or top - pool < 0.2:
        pts = [(u_back, SKIRT), (u_face, SKIRT), (u_face, top), (u_back, top)]
    else:
        n = max(1, int(round((top - pool) / 0.3)))
        rise = (top - pool) / n
        d = 0.42
        pts = [(u_back, SKIRT), (u_face, SKIRT)]
        for k in range(n):
            z = pool + (k + 1) * rise
            pts.append((u_face - s * k * d, z))
            if k < n - 1:
                pts.append((u_face - s * (k + 1) * d, z))
        pts.append((u_back, top))
    if east:
        pts.reverse()  # keep the outline counter-clockwise in (u, z)
    return pts


def loft_bank(mat, v0, v1, back, top, pool, east=False, tab=None, name=None):
    """Ghat or embankment between v0 and v1: terrace at `top`, back edge at u = back (number or function of v)."""
    tab = tab or (U_EAST if east else U_WEST)
    vs = vsamples(tab, v0, v1)
    profs = []
    for v in vs:
        uf = interp(tab, v)
        ub = back(v) if callable(back) else back
        profs.append((v, bank_profile(uf, ub, top, pool, east)))
    n = len(profs[0][1])
    if any(len(p) != n for (_, p) in profs):
        raise ValueError('bank profile size changed along the loft')
    g = bm(mat)
    rings = [[g.verts.new((u, v, z)) for (u, z) in p] for (v, p) in profs]
    for a, b_ in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            g.faces.new([a[i], b_[i], b_[j], a[j]])
    g.faces.new(rings[0])
    g.faces.new(list(reversed(rings[-1])))
    if name:
        poly = [((back(v) if callable(back) else back), v) for (v, _) in profs] + \
               [(interp(tab, v), v) for (v, _) in reversed(profs)]
        LAYOUT.append((name, poly, top))


def ghats():
    """West-bank promenade, river steps and cremation platforms."""
    loft_bank('stone', -68.0, -55.0, 32.4, G1, P1, name='ghat_s')
    loft_bank('stone', -55.0, -28.0, 25.2, G1, P1, name='ghat_bridge')
    loft_bank('stone', -28.0, -26.2, 25.2, G2, P2, name='ghat_hospice_s')
    loft_bank('stone', -26.2, -11.0, 32.7, G2, P2, name='ghat_hospice')
    loft_bank('stone', -11.0, -8.0, 24.8, G3, P2, name='ghat_stair_s')
    loft_bank('stone', -8.0, 10.0, 24.8, G3, P3, name='ghat_stair')
    loft_bank('stone', 10.0, 22.0, 31.2, G4, None, name='ghat_n2')
    loft_bank('stone', 22.0, 33.4, 29.0, C1, None, name='ghat_n3')
    # flights between the promenade levels; the higher level is always upstream (north)
    step_run(29.0, 35.0, -28.0, G2, G1)
    step_run(33.0, 35.2, -11.0, G3, G2)
    step_run(32.0, 35.6, 10.0, G4, G3)
    step_run(31.6, 36.0, 22.0, C1, G4)
    # cremation platforms jutting into the river, each with an ash bed
    for (v, pool) in ((-65.0, P1), (-59.5, P1), (-44.0, P1), (-38.5, P1), (-23.0, P2), (-16.5, P2)):
        uf = interp(U_WEST, v)
        top = pool + 1.05
        box('stone', uf + 1.4, v, SKIRT, 4.6, 4.0, top - SKIRT)
        box('stone_dark', uf + 1.6, v, top, 3.4, 3.2, 0.12)
        box('ash', uf + 1.6, v, top + 0.12, 2.6, 2.2, 0.06)
    # sheet-metal canopies on steel posts over four of the platforms
    for (v, pool) in ((-44.0, P1), (-38.5, P1), (-23.0, P2), (-16.5, P2)):
        uf = interp(U_WEST, v)
        z = pool + 1.17
        for (du, dv) in ((-0.2, -1.6), (-0.2, 1.6), (3.4, -1.6), (3.4, 1.6)):
            cyl('dark', uf + du, v + dv, z, 0.06, 0.06, 3.3, 6)
        g = bm('tile')
        q = [(uf - 0.6, v - 2.1, z + 3.45), (uf + 4.0, v - 2.1, z + 3.0), (uf + 4.0, v + 2.1, z + 3.0), (uf - 0.6, v + 2.1, z + 3.45)]
        g.faces.new([g.verts.new(p) for p in q])
        box('dark', uf + 1.6, v, z + 3.05, 4.4, 0.08, 0.12)
    for (v, pool) in ((-59.5, P1), (-23.0, P2)):
        uf = interp(U_WEST, v)
        z = pool + 1.05 + 0.18
        for k in range(4):
            for j in (-1, 0, 1):
                if k % 2 == 0:
                    box('wood', uf + 1.6 + j * 0.55, v, z + k * 0.22, 0.2, 1.9, 0.2)
                else:
                    box('wood', uf + 1.6, v + j * 0.55, z + k * 0.22, 1.9, 0.2, 0.2)


def step_run(u0, u1, v, z_hi, z_lo):
    """Flight across the promenade between u0 and u1, descending southwards from the level change at v."""
    n = max(1, int(round((z_hi - z_lo) / 0.17)))
    rise = (z_hi - z_lo) / n
    for i in range(n):
        top = z_hi - (i + 1) * rise
        box('stone', (u0 + u1) / 2, v - (i + 0.5) * 0.3, top - 1.5, u1 - u0, 0.3, 1.5)


def river():
    """Water in three pools held by two stone weirs, with spill faces."""
    for (v0, v1, z) in ((-71.0, -28.0, P1), (-28.0, -8.0, P2), (-8.0, 10.0, P3)):
        vs = vsamples(U_EAST, v0, v1)
        vs = sorted(set(vs + vsamples(U_WEST, v0, v1)))
        west = [(interp(U_WEST, v) - 0.4, v) for v in vs]
        east = [(interp(U_EAST, v) + 0.8, v) for v in reversed(vs)]
        g = bm('water')
        k = len(vs)
        wv = [g.verts.new((u, v, z)) for (u, v) in west]
        ev = [g.verts.new((u, v, z)) for (u, v) in reversed(east)]
        for i in range(k - 1):
            g.faces.new([wv[i], ev[i], ev[i + 1], wv[i + 1]])
    for (vw, hi, lo) in ((-28.0, P2, P1), (-8.0, P3, P2)):
        u0, u1 = interp(U_WEST, vw) - 0.6, interp(U_EAST, vw) + 1.4
        box('stone', (u0 + u1) / 2, vw, SKIRT, u1 - u0, 1.0, hi + 0.08 - SKIRT)
        # water sheeting over the weir
        g = bm('foam')
        a, b_ = interp(U_WEST, vw) + 1.2, interp(U_EAST, vw) - 1.6
        q = [(a, vw - 0.5, hi + 0.1), (b_, vw - 0.5, hi + 0.1), (b_, vw - 1.1, lo + 0.03), (a, vw - 1.1, lo + 0.03)]
        g.faces.new([g.verts.new(p) for p in reversed(q)])


def east_bank():
    """Embankment and terrace along the east bank, with steps down to the water."""
    loft_bank('stone', -70.0, -28.0, lambda v: interp(U_EAST, v) + 4.5, G1, P1, east=True, name='east_p1')
    loft_bank('stone', -28.0, -8.0, lambda v: interp(U_EAST, v) + 4.5, G2, P2, east=True, name='east_p2')
    loft_bank('stone', -8.0, 8.0, lambda v: interp(U_EAST, v) + 4.5, G3, P3, east=True, name='east_p3')


def bridge():
    """Footbridge between the ghats (OSM way 37707651), brick parapets with stone coping."""
    a, b_ = Vector((35.0, -51.92, 0)), Vector((61.4, -45.68, 0))
    d = b_ - a
    L = d.length
    rz = math.atan2(d.y, d.x)
    m = (a + b_) / 2
    box('stone', m.x, m.y, BR - 0.7, L, 3.2, 0.7, rz)
    t = Vector((-math.sin(rz), math.cos(rz), 0))
    for s in (-1, 1):
        p = m + t * s * 1.75
        box('brick', p.x, p.y, BR - 0.7, L, 0.35, 0.7 + 0.85, rz)
        box('stone', p.x, p.y, BR + 0.85, L + 0.1, 0.45, 0.12, rz)
    for f in (0.36, 0.64):
        p = a + d * f
        box('stone', p.x, p.y, SKIRT, 1.4, 3.6, BR - 0.7 - SKIRT, rz)
        box('stone', p.x, p.y, SKIRT, 2.2, 1.0, BR - 0.7 - SKIRT, rz)
    # landing on the east bank
    prism('stone', [(56.0, -51.5), (63.5, -51.5), (63.5, -41.5), (56.0, -41.5)], SKIRT, BR, name='bridge_landing')


# --------------------------------------------------------------------------
# courtyard and the buildings around it
# --------------------------------------------------------------------------

COURT = [(-15.0, -14.5), (-3.0, -14.5), (-3.0, -12.4), (18.6, -12.4), (18.6, -1.4), (19.6, -1.4), (19.6, 5.4),
         (19.28, 5.36), (17.4, 22.89), (16.66, 22.81), (15.65, 32.29), (-4.6, 32.3), (-4.6, 17.6), (-15.0, 17.0)]
UPPER = [(-24.0, -14.5), (-18.3, -14.5), (-18.3, 17.0), (-24.0, 16.4)]


def courtyard():
    prism('paving', COURT, SKIRT, C1, side='stone', name='court')
    prism('paving', UPPER, SKIRT, C2, side='stone', name='upper_terrace')
    # steps from the upper terrace down to the courtyard along its whole east edge
    n = int(round((C2 - C1) / 0.17))
    rise = (C2 - C1) / n
    for i in range(n):
        top = C2 - (i + 1) * rise
        box('stone', -15.0 - (n - i - 0.5) * 0.3, 1.25, SKIRT, 0.3, 31.5, top - SKIRT)
    # parapet where the courtyard drops to the ghat south of the pavilion
    balustrade([(9.6, -12.25), (18.4, -12.25)], C1)


def balustrade(pts, z, h=1.0):
    """White parapet with red pilasters and a red coping rail (the pavilion terrace style)."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        rz = math.atan2(y1 - y0, x1 - x0)
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        box('whitewash', mx, my, z, L, 0.24, h, rz)
        box('brick', mx, my, z + h, L + 0.1, 0.32, 0.12, rz)
        n = max(1, int(L / 1.25))
        for i in range(n + 1):
            t = i / n
            px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            box('brick', px, py, z, 0.22, 0.3, h + 0.05, rz)
            if i < n:
                tm = (i + 0.5) / n
                qx, qy = x0 + (x1 - x0) * tm, y0 + (y1 - y0) * tm
                frustum('whitewash', qx, qy, z + h + 0.12, 0.5, 0.22, 0.0, 0.0, 0.28, rz)


def temple():
    """Main temple: two gilded roofs on a dark carved timber body, gajur on top."""
    b = C1
    box('stone', 0, 0, b, 18.6, 18.6, 0.5)
    box('stone', 0, 0, b + 0.5, 17.4, 17.4, 0.5)
    box('stone_dark', 0, 0, b + 1.0, 13.4, 13.4, 0.35)
    # steps up to the four doors
    for k in range(4):
        a = k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        for i in range(3):
            r = 9.3 + 0.35 * (2 - i) + 0.18
            box('stone', r * c, r * s, b, 0.36 if abs(c) > 0.5 else 3.4, 3.4 if abs(c) > 0.5 else 0.36, 0.34 * (i + 1), 0)
    z0 = b + 1.0
    box('wood', 0, 0, z0, 12.8, 12.8, 8.4)
    for (zz, hh) in ((z0 + 0.35, 0.3), (z0 + 4.9, 0.4), (z0 + 8.0, 0.4)):
        box('wood_dark', 0, 0, zz, 13.1, 13.1, hh)
    for k in range(4):
        a = k * math.pi / 2
        fr = face_frame(0, 0, z0 + 0.35, a, 6.4)
        # gilt door with its torana, and latticed windows either side
        panel('gilt', [(-1.6, 0), (1.6, 0), (1.6, 4.4), (-1.6, 4.4)], fr, 0.16)
        panel('dark', [(-0.12, 0.2), (0.12, 0.2), (0.12, 4.0), (-0.12, 4.0)], (fr[0] + fr[3] * 0.16, fr[1], fr[2], fr[3]), 0.03)
        panel('gilt', [(-2.0, 4.4), (2.0, 4.4)] + [(2.0 * math.cos(math.pi * i / 8), 4.4 + 1.5 * math.sin(math.pi * i / 8)) for i in range(1, 8)],
              fr, 0.2)
        for sx in (-4.0, 4.0):
            panel('gilt', [(sx - 0.8, 5.2), (sx + 0.8, 5.2), (sx + 0.8, 6.9), (sx - 0.8, 6.9)], fr, 0.12)
            panel('wood_dark', [(sx - 0.55, 5.4), (sx + 0.55, 5.4), (sx + 0.55, 6.7), (sx - 0.55, 6.7)],
                  (fr[0] + fr[3] * 0.12, fr[1], fr[2], fr[3]), 0.03)
        # gilt roof struts (tundal) leaning out to the eave
        for t in (-5.4, -3.6, -1.8, 0.0, 1.8, 3.6, 5.4):
            strut(a, 6.4, t, z0 + 6.0, 3.0, z0 + 8.65)
    lower_eave = z0 + 8.4
    roof(19.4, lower_eave, 10.0, lower_eave + 2.75, 0.3)
    # upper storey
    z1 = lower_eave + 2.6
    box('wood', 0, 0, z1, 9.6, 9.6, 2.8)
    box('wood_dark', 0, 0, z1 + 2.1, 9.9, 9.9, 0.35)
    for k in range(4):
        a = k * math.pi / 2
        fr = face_frame(0, 0, z1 + 0.4, a, 4.8)
        for sx in (-2.6, 0.0, 2.6):
            panel('gilt', [(sx - 0.7, 0), (sx + 0.7, 0), (sx + 0.7, 1.3), (sx - 0.7, 1.3)], fr, 0.1)
        for t in (-3.6, -1.2, 1.2, 3.6):
            strut(a, 4.8, t, z1 + 0.9, 1.9, z1 + 2.95)
    upper_eave = z1 + 2.8
    top = upper_eave + 3.7
    roof(13.4, upper_eave, 1.9, top, 0.25)
    gajur(top)
    return top


def strut(a, half, t, z_lo, out, z_hi):
    """Gilt strut on face angle a at offset t along the face, from the wall at z_lo to `out` metres out at z_hi."""
    n = Vector((math.cos(a), math.sin(a), 0.0))
    u = Vector((-math.sin(a), math.cos(a), 0.0))
    p0 = n * half + u * t + Vector((0, 0, z_lo))
    p1 = n * (half + out) + u * t + Vector((0, 0, z_hi))
    d = p1 - p0
    g = bm('gilt')
    w, th = 0.18, 0.1
    side = u * w
    nn = d.cross(u).normalized() * th
    vs = [g.verts.new(p) for p in (p0 - side, p0 + side, p0 + side + nn, p0 - side + nn,
                                    p1 - side, p1 + side, p1 + side + nn, p1 - side + nn)]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        g.faces.new([vs[i] for i in f])


def roof(w0, z0, w1, z1, fascia):
    """Gilded hipped roof: sloped skin with ribs, hip rolls, eave fascia, bell fringe and dark soffit."""
    frustum('gilt', 0, 0, z0, w0, w0, w1, w1, z1 - z0, bottom=False)
    box('gilt', 0, 0, z0 - fascia, w0 + 0.1, w0 + 0.1, fascia)
    box('wood_dark', 0, 0, z0 - fascia - 0.06, w0 - 0.3, w0 - 0.3, 0.06)
    # hanging fringe (kinkinimala) just inside the eave
    for k in range(4):
        a = k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        r = w0 / 2 - 0.08
        box('gilt_dark', c * r, s * r, z0 - fascia - 0.55, 0.06 if abs(c) > 0.5 else w0 - 0.4, w0 - 0.4 if abs(c) > 0.5 else 0.06, 0.55)
    # ribs down each slope
    h = z1 - z0
    half0, half1 = w0 / 2, w1 / 2
    for k in range(4):
        a = k * math.pi / 2
        n = Vector((math.cos(a), math.sin(a), 0.0))
        u = Vector((-math.sin(a), math.cos(a), 0.0))
        count = int(w0 / 0.95)
        for i in range(1, count):
            t = -half0 + w0 * i / count
            if abs(t) > half0 - 0.4:
                continue
            # rib runs from the eave line to where it meets the hip or the top edge
            tt = abs(t)
            f_end = 1.0 if tt <= half1 else (half0 - tt) / (half0 - half1)
            f_end = min(1.0, f_end)
            p0 = n * (half0 + 0.02) + u * t + Vector((0, 0, z0 + 0.04))
            p1 = n * (half0 + (half1 - half0) * f_end + 0.02) + u * t + Vector((0, 0, z0 + h * f_end + 0.04))
            if (p1 - p0).length < 0.3:
                continue
            tube('gilt_dark', [p0, p1], 0.06, 4)
    # hip rolls and corner finials
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        p0 = Vector((sx * half0, sy * half0, z0 + 0.08))
        p1 = Vector((sx * half1, sy * half1, z1 + 0.05))
        tube('gilt', [p0, p1], 0.13, 6)
        pinnacle('gilt', sx * (half0 + 0.05), sy * (half0 + 0.05), z0 + 0.1, 0.13, 0.9)


def gajur(z):
    box('gilt', 0, 0, z - 0.05, 2.0, 2.0, 0.3)
    prof = [(1.0, z + 0.25), (1.0, z + 0.45), (0.72, z + 0.6), (0.9, z + 0.85), (0.92, z + 1.0), (0.55, z + 1.3),
            (0.72, z + 1.55), (0.72, z + 1.7), (0.45, z + 1.95), (0.58, z + 2.2), (0.36, z + 2.55), (0.45, z + 2.75),
            (0.22, z + 3.1), (0.28, z + 3.3), (0.08, z + 3.7), (0.0, z + 4.4)]
    lathe('gilt', prof, 16)
    # small umbrella ring
    cyl('gilt_dark', 0, 0, z + 2.6, 0.9, 0.5, 0.12, 16)
    # banner pole (dhvaja) standing on the upper roof with a saffron pennant
    px, py = 1.6, -1.6
    zr = z - 1.9
    cyl('gilt', px, py, zr, 0.06, 0.05, 6.3, 6)
    g = bm('pennant')
    q = [(px, py, zr + 6.2), (px + 0.05, py - 0.05, zr + 5.5), (px + 1.2, py - 1.2, zr + 5.85)]
    g.faces.new([g.verts.new(p) for p in q])


def nandi():
    """Gilded bull on its stone plinth west of the temple, facing the west door."""
    x, y = -12.9, 0.0
    box('stone', x, y, C1, 3.4, 1.9, 1.1)
    box('stone_dark', x, y, C1 + 1.1, 3.1, 1.6, 0.12)
    z = C1 + 1.22
    ellipsoid('gilt', (x - 0.1, y, z + 0.55), (1.35, 0.62, 0.58))
    ellipsoid('gilt', (x + 0.55, y, z + 0.95), (0.45, 0.42, 0.38))          # hump
    ellipsoid('gilt', (x + 1.2, y, z + 1.25), (0.42, 0.28, 0.34))           # head
    ellipsoid('gilt', (x + 1.5, y, z + 1.05), (0.22, 0.2, 0.16))            # muzzle
    for s in (-1, 1):
        tube('gilt', [(x + 1.15, y + s * 0.22, z + 1.5), (x + 1.05, y + s * 0.42, z + 1.8)], 0.05, 5)
        ellipsoid('gilt', (x + 0.5, y + s * 0.42, z + 0.12), (0.55, 0.2, 0.14))   # folded legs


def trident(x, y):
    box('stone', x, y, C1, 1.0, 1.0, 0.6)
    cyl('gilt', x, y, C1 + 0.6, 0.07, 0.06, 4.2, 8)
    z = C1 + 4.6
    tube('gilt', [(x, y - 0.55, z + 0.9), (x, y - 0.55, z + 0.1), (x, y, z - 0.25), (x, y + 0.55, z + 0.1),
                  (x, y + 0.55, z + 0.9)], 0.05, 6)
    cyl('gilt', x, y, z - 0.2, 0.06, 0.0, 1.4, 8)
    ellipsoid('gilt', (x, y + 0.0, z - 0.7), (0.18, 0.12, 0.25), 8, 6)   # damaru


def pavilion():
    """Terrace and pavilion south of the east gate (OSM 1826434824)."""
    pod = [(18.6, -10.6), (28.0, -10.6), (28.0, -1.4), (18.6, -1.4)]
    prism('paving', pod, SKIRT, C1, side='whitewash', name='pavilion_terrace')
    box('brick', 23.3, -6.0, C1 - 0.45, 9.5, 9.3, 0.3)
    balustrade([(18.7, -10.45), (27.85, -10.45), (27.85, -1.55), (19.8, -1.55)], C1)
    cx, cy = 22.6, -6.2
    box('stone', cx, cy, C1, 7.0, 7.0, 0.3)
    z = C1 + 0.3
    for i in range(6):
        t = -3.0 + 6.0 * i / 5
        for (px, py) in ((cx + t, cy - 3.0), (cx + t, cy + 3.0), (cx - 3.0, cy + t), (cx + 3.0, cy + t)):
            box('wood_dark', px, py, z, 0.32, 0.32, 2.7)
    box('wood', cx, cy, z + 2.7, 6.8, 6.8, 0.55)
    box('wood_dark', cx, cy, z + 3.25, 7.2, 7.2, 0.2)
    frustum('tin', cx, cy, z + 3.45, 9.0, 9.0, 0.0, 0.0, 2.6)
    pinnacle('gilt', cx, cy, z + 6.0, 0.22, 1.5)


def east_gate():
    """White gatehouse at the head of the ghat stair, with the painted torana over the door."""
    u0, u1, v0, v1 = 17.0, 19.8, -1.4, 5.4
    cx, cy = (u0 + u1) / 2, (v0 + v1) / 2
    box('whitewash', cx, cy, C1 - 0.3, u1 - u0, v1 - v0, 5.0)
    box('whitewash', cx, cy, C1 + 4.7, u1 - u0 + 0.3, v1 - v0 + 0.3, 0.3)
    frustum('whitewash', cx, cy, C1 + 5.0, u1 - u0, v1 - v0 - 1.0, 0.8, 2.0, 1.1)
    for dv in (-2.9, 2.9):
        box('whitewash', u1 - 0.2, cy + dv, C1 - 0.3, 0.6, 0.7, 5.3)
        pinnacle('gilt', u1 - 0.2, cy + dv, C1 + 5.0, 0.2, 1.0)
    pinnacle('gilt', cx, cy, C1 + 6.1, 0.36, 1.9)
    fr = (Vector((u1, cy, C1)), Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)))
    panel('wood', [(-1.0, 0), (1.0, 0), (1.0, 2.9), (-1.0, 2.9)], fr, 0.08)
    panel('gilt', [(-1.45, 2.9), (1.45, 2.9)] + [(1.45 * math.cos(math.pi * i / 10), 2.9 + 1.3 * math.sin(math.pi * i / 10))
                                                 for i in range(1, 10)], fr, 0.06)
    panel('blue', [(-1.2, 2.95), (1.2, 2.95)] + [(1.2 * math.cos(math.pi * i / 10), 2.95 + 1.05 * math.sin(math.pi * i / 10))
                                                for i in range(1, 10)], (fr[0] + fr[3] * 0.06, fr[1], fr[2], fr[3]), 0.03)
    ellipse_disc('whitewash', fr, 0.0, 4.55, 0.28, 0.1)


def ellipse_disc(mat, fr, x, y, r, thick, n=12):
    panel(mat, [(x + r * math.cos(2 * math.pi * i / n), y + r * math.sin(2 * math.pi * i / n)) for i in range(n)], fr, thick)


def ghat_stair():
    """The flight from the ghat up to the east gate, with side walls and a centre rail."""
    u0, v0, v1 = 19.8, -0.7, 4.7
    n = int(round((C1 - G3) / 0.172))
    rise = (C1 - G3) / n
    run = 0.3
    for i in range(n):
        top = C1 - (i + 1) * rise
        box('stone', u0 + (i + 0.5) * run, (v0 + v1) / 2, SKIRT, run, v1 - v0, top - SKIRT)
    u1 = u0 + n * run
    for (va, vb) in ((-1.4, v0), (v1, 5.4)):
        g = bm('whitewash')
        q = [(u0, va, C1 + 0.9), (u1, va, G3 + 0.9), (u1, vb, G3 + 0.9), (u0, vb, C1 + 0.9)]
        b_ = [(u0, va, SKIRT), (u1, va, SKIRT), (u1, vb, SKIRT), (u0, vb, SKIRT)]
        tv = [g.verts.new(v) for v in q]
        bv = [g.verts.new(v) for v in b_]
        g.faces.new(tv)
        g.faces.new(list(reversed(bv)))
        for k in range(4):
            m = (k + 1) % 4
            g.faces.new([bv[k], bv[m], tv[m], tv[k]])
    vm = (v0 + v1) / 2
    tube('dark', [(u0, vm, C1 + 0.9), (u1, vm, G3 + 0.9)], 0.04, 6)
    for f in (0.1, 0.5, 0.9):
        cyl('dark', u0 + (u1 - u0) * f, vm, C1 - (C1 - G3) * f - 0.1, 0.03, 0.03, 1.0, 4)
    LAYOUT.append(('stair', [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], G3))


WHITE = [(19.28, 5.36), (22.69, 5.74), (22.33, 9.07), (31.57, 10.09), (31.25, 13.03), (33.49, 13.31), (32.04, 26.79),
         (29.76, 26.53), (29.27, 31.04), (25.58, 30.63), (25.29, 33.38), (15.65, 32.29), (16.66, 22.81), (17.4, 22.89)]


def white_building():
    """Three-storey white building north of the stair (OSM 1826434832), with rows of small windows."""
    top = C1 + 6.6
    prism('whitewash', WHITE, SKIRT, top, name='white_building')
    # parapet
    n = len(WHITE)
    for i in range(n):
        (x0, y0), (x1, y1) = WHITE[i], WHITE[(i + 1) % n]
        L = math.hypot(x1 - x0, y1 - y0)
        rz = math.atan2(y1 - y0, x1 - x0)
        nx, ny = (y1 - y0) / L, -(x1 - x0) / L       # outward for a CCW ring
        box('whitewash', (x0 + x1) / 2 - nx * 0.15, (y0 + y1) / 2 - ny * 0.15, top, L, 0.3, 0.7, rz)
        box('stone', (x0 + x1) / 2 + nx * 0.02, (y0 + y1) / 2 + ny * 0.02, top - 0.35, L + 0.1, 0.12, 0.2, rz)
        if L < 2.0:
            continue
        k = int(L / 2.1)
        for j in range(k):
            t = (j + 0.5) / k
            px, py = x0 + (x1 - x0) * t + nx * 0.03, y0 + (y1 - y0) * t + ny * 0.03
            for z in (G3 + 1.2, C1 + 0.9, C1 + 3.9):
                box('dark', px, py, z, 0.85, 0.1, 1.25, rz)
                box('stone', px + nx * 0.04, py + ny * 0.04, z - 0.12, 1.05, 0.12, 0.12, rz)
    # tin awning along the ghat front
    g = bm('tile')
    q = [(33.4, 13.5, G4 + 2.7), (32.0, 26.6, G4 + 2.7), (33.6, 26.8, G4 + 2.2), (35.0, 13.7, G4 + 2.2)]
    g.faces.new([g.verts.new(p) for p in q])


# --------------------------------------------------------------------------
# shrines
# --------------------------------------------------------------------------

# the eleven shrines on the east bank (OSM 2065096706..726): centre u, v, slab top, slab bottom
EAST_SHRINES = [
    (66.78, -14.36, -1.78, -4.64), (65.44, -7.71, -0.67, -3.86), (64.13, -1.19, 0.95, -2.89),
    (62.79, 5.43, 2.97, -1.62), (61.21, 13.25, 5.37, 0.27), (59.81, 20.24, 7.79, 2.29),
    (58.33, 27.57, 10.04, 4.11), (56.93, 34.5, 12.02, 5.71), (55.53, 41.46, 13.19, 6.94),
    (54.12, 48.47, 14.3, 8.2), (52.76, 55.23, 15.34, 9.08),
]
EAST_ROT = math.radians(11.7)
# small shrines in the courtyard north of the temple (OSM 2189266982.., 2737989480..)
COURT_SHRINES = [(6.9, 17.6), (15.4, 21.1), (1.4, 21.3), (10.0, 28.9), (5.7, 28.5), (1.5, 28.0)]


def shrine(x, y, z0, s=1.0, rz=0.0, body='stone_dark', top='whitewash', door_rz=math.pi):
    """Shiva shrine: stepped plinth, square cella with an arched door, stepped white tower, gilt finial."""
    box('stone', x, y, z0, 4.4 * s, 4.4 * s, 0.4 * s, rz)
    box('stone', x, y, z0 + 0.4 * s, 3.9 * s, 3.9 * s, 0.25 * s, rz)
    z = z0 + 0.65 * s
    box(body, x, y, z, 3.3 * s, 3.3 * s, 2.3 * s, rz)
    box('stone', x, y, z + 2.3 * s, 3.7 * s, 3.7 * s, 0.25 * s, rz)
    fr = face_frame(x, y, z, rz + door_rz, 1.65 * s)
    panel('dark', arch_outline(0.95 * s, 1.75 * s), fr, 0.04)
    panel('stone', [(-0.75 * s, 0), (0.75 * s, 0), (0.75 * s, 2.0 * s), (-0.75 * s, 2.0 * s)], fr, 0.02)
    z += 2.55 * s
    w = 3.5 * s
    for (dw, h, hb) in ((0.55, 0.55, 0.32), (0.55, 0.5, 0.28), (0.6, 0.45, 0.25)):
        frustum(top, x, y, z, w, w, w - dw * s, w - dw * s, h * s, rz)
        z += h * s
        w -= dw * s
        box(top, x, y, z, w * 0.92, w * 0.92, hb * s, rz)
        z += hb * s
    c, sn = math.cos(rz), math.sin(rz)
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        px, py = sx * 1.45 * s, sy * 1.45 * s
        cxp, cyp = x + px * c - py * sn, y + px * sn + py * c
        frustum(top, cxp, cyp, z0 + 3.2 * s, 0.45 * s, 0.45 * s, 0.0, 0.0, 0.7 * s, rz)
    lathe(top, [(w * 0.45, z), (w * 0.5, z + 0.2 * s), (w * 0.38, z + 0.5 * s), (0.15 * s, z + 0.65 * s)], 12, x, y)
    pinnacle('gilt', x, y, z + 0.6 * s, 0.13 * s, 1.0 * s)


def shikhara(x, y, z0, s=1.0, mat='whitewash', rz=0.0):
    """Small curvilinear shikhara shrine (the ones at the foot of the stair)."""
    box('stone', x, y, z0, 2.6 * s, 2.6 * s, 0.4 * s, rz)
    box(mat, x, y, z0 + 0.4 * s, 2.0 * s, 2.0 * s, 1.6 * s, rz)
    fr = face_frame(x, y, z0 + 0.4 * s, rz, 1.0 * s)
    panel('dark', arch_outline(0.7 * s, 1.2 * s), fr, 0.04)
    z = z0 + 2.0 * s
    prev = None
    g = bm(mat)
    c, sn = math.cos(rz), math.sin(rz)
    for k in range(9):
        t = k / 8
        hw = (1.05 - 0.75 * t ** 1.6) * s
        zz = z + 2.6 * s * t
        ring = [g.verts.new((x + px * c - py * sn, y + px * sn + py * c, zz))
                for (px, py) in ((hw, -hw), (hw, hw), (-hw, hw), (-hw, -hw))]
        if prev:
            for j in range(4):
                m = (j + 1) % 4
                g.faces.new([prev[j], prev[m], ring[m], ring[j]])
        prev = ring
    g.faces.new(prev)
    zt = z + 2.6 * s
    lathe(mat, [(0.32 * s, zt), (0.42 * s, zt + 0.12 * s), (0.3 * s, zt + 0.28 * s), (0.1 * s, zt + 0.32 * s)], 10, x, y)
    pinnacle('gilt', x, y, zt + 0.3 * s, 0.09 * s, 0.7 * s)


def red_shrine(x, y, z0):
    box('stone', x, y, z0, 1.9, 1.9, 0.4)
    box('stone_dark', x, y, z0 + 0.4, 1.4, 1.4, 1.2)
    lathe('brick', [(0.95, z0 + 1.6), (0.9, z0 + 1.9), (0.6, z0 + 2.3), (0.3, z0 + 2.5), (0.0, z0 + 2.65)], 12, x, y)
    pinnacle('gilt', x, y, z0 + 2.6, 0.08, 0.6)


def shrines():
    for i, (u, v, top, bot) in enumerate(EAST_SHRINES):
        c, s = math.cos(EAST_ROT), math.sin(EAST_ROT)
        slab = [(-3.0, -3.55), (2.8, -3.55), (2.8, 3.55), (-3.0, 3.55)]
        poly = [(u + px * c - py * s, v + px * s + py * c) for (px, py) in slab]
        prism('stone', poly, bot, top, name=f'east_shrine_{i + 1}')
        shrine(u, v, top, 1.0, EAST_ROT)
        # steps up to the next slab along the river side
        if i + 1 < len(EAST_SHRINES):
            rise = EAST_SHRINES[i + 1][2] - top
            if rise > 0.3:
                n = int(round(rise / 0.18))
                for k in range(n):
                    px, py = -2.25, 1.15 + 2.4 * (k + 0.5) / n
                    box('stone', u + px * c - py * s, v + px * s + py * c, top - 0.5, 1.4, 2.4 / n + 0.02,
                        rise * (k + 1) / n + 0.5, EAST_ROT)
    for (u, v) in COURT_SHRINES:
        dark = (int(u * 10 + v * 7) % 2) == 0
        shrine(u, v, C1, 0.66, 0.0, 'stone_dark' if dark else 'whitewash', 'whitewash', door_rz=-math.pi / 2)
    # at the foot of the ghat stair, in front of the pavilion terrace
    shikhara(30.4, -8.4, G3, 1.0, 'whitewash', math.pi)
    shikhara(30.4, -4.9, G3, 0.95, 'stone_dark', math.pi)
    red_shrine(30.2, -2.2, G3)
    shikhara(33.2, -9.6, G3, 0.6, 'whitewash', math.pi)


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
    LAYOUT.clear()


def build():
    clear()
    mats = make_materials()
    courtyard()
    temple()
    nandi()
    trident(-11.8, 8.6)
    pavilion()
    east_gate()
    ghat_stair()
    white_building()
    ghats()
    river()
    east_bank()
    bridge()
    shrines()

    root = bpy.data.objects.new('pashupatinath', None)
    bpy.context.scene.collection.objects.link(root)
    tris = 0
    turn = Matrix.Rotation(ROT, 3, 'Z')
    for name in sorted(B):
        g = B[name]
        bmesh.ops.rotate(g, cent=(0.0, 0.0, 0.0), matrix=turn, verts=g.verts[:])
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
    print(f'pashupatinath: {tris} triangles')
    return tris


def export(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              use_selection=False, export_extras=False, export_cameras=False, export_lights=False)
    print(f'pashupatinath: wrote {path}')


if __name__ == '__main__':
    build()
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--layout' in argv:
        with open(argv[argv.index('--layout') + 1], 'w') as f:
            json.dump([{'name': n, 'poly': p, 'top': t} for (n, p, t) in LAYOUT], f)
    if '--out' in argv:
        export(argv[argv.index('--out') + 1])
