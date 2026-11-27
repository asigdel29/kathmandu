"""Boudhanath Stupa (Bouddha), Kathmandu.

Pure bpy, deterministic, no external assets. Blender frame while building:
X = east, Y = north, Z = up, meters, in the stupa's own axes (the mandala is
turned 9.5 degrees clockwise from true north; hero.json carries that as
rotationDeg). Origin = ground level at the centroid of the OpenStreetMap
outline (way 113376590, lon 85.3619721, lat 27.7214711). The glTF export
(+Y up) maps Blender +Y (north) to -Z, which matches the world frame.

Layout, outermost first:
  - 20-sided enclosure wall on the OSM outline (40 m half width) with the
    ring of prayer wheels set into its outer face, gate on the south side;
  - three-level mandala plinth with the same stepped outline, white walls,
    red-brown washed floors, stairs on the south axis, corner chortens;
  - two-step drum with 108 niches, the low whitewashed dome (31 m across,
    9.6 m high) with saffron lotus arcs and the stair up its south face;
  - gilded harmika with the painted eyes on all four faces, cloth valance,
    13-tier gilded spire, cloth-banded crown, canopy and pinnacle (36 m);
  - prayer flag lines fanning from the crown to the enclosure wall.

Usage:
  Blender -b -P build.py                       # build the scene only
  Blender -b -P build.py -- --out model.glb    # build and export
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
SLUG = 'boudhanath'

# --------------------------------------------------------------------------
# palette and materials
# --------------------------------------------------------------------------

FALLBACK_PALETTE = {
    'newari_brick': '#8b3a2a', 'old_wood': '#4a2e1c', 'tile_roof': '#6b3b2e', 'plaster_white': '#e8e2d6',
    'pastel_4': '#cdd8c3', 'rcc_grey': '#9a9790', 'tin_blue': '#3b6ea5', 'marigold': '#f2a81d',
    'saffron': '#e07a1f', 'asphalt': '#3b3b3b', 'dust': '#b89f7e',
}


def _palette():
    p = os.path.join(HERE, '..', '..', 'style', 'palette.json')
    try:
        with open(p) as f:
            return {**FALLBACK_PALETTE, **json.load(f)}
    except OSError:  # running outside the repository
        return dict(FALLBACK_PALETTE)


def _linear(hex_color):
    """sRGB hex -> linear RGBA (Blender colour sockets and glTF baseColorFactor are linear)."""
    h = hex_color.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


# name -> (palette key, metallic, roughness, double sided)
MATERIALS = {
    'whitewash': ('plaster_white', 0.0, 0.85, False),
    'terrace_floor': ('tile_roof', 0.0, 0.9, False),
    'courtyard': ('dust', 0.0, 0.95, False),
    'gold': ('marigold', 1.0, 0.32, False),
    'cloth_red': ('newari_brick', 0.0, 0.8, False),
    'cloth_saffron': ('saffron', 0.0, 0.8, False),
    'cloth_yellow': ('marigold', 0.0, 0.8, False),
    'cloth_green': ('pastel_4', 0.0, 0.8, False),
    'cloth_blue': ('tin_blue', 0.0, 0.8, False),
    'cloth_white': ('plaster_white', 0.0, 0.8, False),
    'paint_black': ('asphalt', 0.0, 0.6, False),
    'paint_blue': ('tin_blue', 0.0, 0.6, False),
    'paint_white': ('plaster_white', 0.0, 0.6, False),
    'paint_saffron': ('saffron', 0.0, 0.85, False),
    'wheel_panel': ('newari_brick', 0.0, 0.75, False),
    'niche': ('old_wood', 0.0, 0.9, False),
    'flag_blue': ('tin_blue', 0.0, 0.9, True),
    'flag_white': ('plaster_white', 0.0, 0.9, True),
    'flag_red': ('newari_brick', 0.0, 0.9, True),
    'flag_green': ('pastel_4', 0.0, 0.9, True),
    'flag_yellow': ('marigold', 0.0, 0.9, True),
}
FLAG_CYCLE = ('flag_blue', 'flag_white', 'flag_red', 'flag_green', 'flag_yellow')


def make_materials():
    pal = _palette()
    mats = {}
    for name in sorted(MATERIALS):
        key, metallic, rough, double = MATERIALS[name]
        m = bpy.data.materials.new(name)
        if m.node_tree is None:  # older Blender: node trees are opt-in
            m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = _linear(pal[key])
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = rough
        m.use_backface_culling = not double
        mats[name] = m
    return mats


# --------------------------------------------------------------------------
# geometry accumulator: one mesh, one material slot per material name
# --------------------------------------------------------------------------


class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []  # (indices, material name, smooth)

    def face(self, pts, mat, smooth=False):
        base = len(self.verts)
        self.verts.extend(tuple(float(round(c, 5)) for c in p) for p in pts)
        self.faces.append((tuple(range(base, base + len(pts))), mat, smooth))

    def quad_strip_mesh(self, grid, mat, smooth=False, closed=True):
        """grid[k][j] rows of points; emits quads (k,j)-(k,j+1)-(k+1,j+1)-(k+1,j), collapsing apex rows."""
        base = len(self.verts)
        idx = []
        for row in grid:
            r = []
            for p in row:
                r.append(len(self.verts))
                self.verts.append(tuple(float(round(c, 5)) for c in p))
            idx.append(r)
        n = len(grid[0])
        segs = n if closed else n - 1
        for k in range(len(grid) - 1):
            a, b = idx[k], idx[k + 1]
            for j in range(segs):
                j1 = (j + 1) % n
                if len(a) == 1:  # apex below: winding keeps the normal outward
                    f = (a[0], b[j1], b[j])
                elif len(b) == 1:
                    f = (a[j], a[j1], b[0])
                else:
                    f = (a[j], a[j1], b[j1], b[j])
                self.faces.append((f, mat, smooth))
        return base


B = Builder()


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------


def rot(x, y, ang):
    c, s = math.cos(ang), math.sin(ang)
    return x * c - y * s, x * s + y * c


def prism(ring, z0, z1, side_mat, top_mat=None, bottom=False):
    """Vertical prism over a CCW (seen from above) ring."""
    n = len(ring)
    for i in range(n):
        (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % n]
        B.face([(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)], side_mat)
    if top_mat:
        B.face([(x, y, z1) for (x, y) in ring], top_mat)
    if bottom:
        B.face([(x, y, z0) for (x, y) in reversed(ring)], side_mat)


def box(cx, cy, z0, sx, sy, z1, mat, ang=0.0, top_mat=None, bottom=False):
    hx, hy = sx / 2, sy / 2
    ring = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
    ring = [(cx + rx, cy + ry) for (rx, ry) in (rot(x, y, ang) for (x, y) in ring)]
    prism(ring, z0, z1, mat, top_mat or mat, bottom)


def lathe(profile, segs, mat, cx=0.0, cy=0.0, smooth=False, phase=0.0):
    """profile: [(r, z)] bottom to top; r == 0 rows collapse to a single apex."""
    grid = []
    for (r, z) in profile:
        if r <= 1e-6:
            grid.append([(cx, cy, z)])
        else:
            row = []
            for j in range(segs):
                a = phase + 2 * math.pi * j / segs
                row.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
            grid.append(row)
    B.quad_strip_mesh(grid, mat, smooth)


def cross20(a, b, c):
    """The Boudha mandala outline: a square of half width a whose corners step in
    twice (to b, then to c); 20 vertices, CCW seen from above."""
    return [(a, -c), (a, c), (b, c), (b, b), (c, b), (c, a), (-c, a), (-c, b), (-b, b), (-b, c),
            (-a, c), (-a, -c), (-b, -c), (-b, -b), (-c, -b), (-c, -a), (c, -a), (c, -b), (b, -b), (b, -c)]


def ring_edges(ring):
    n = len(ring)
    return [(ring[i], ring[(i + 1) % n]) for i in range(n)]


# --------------------------------------------------------------------------
# dimensions (meters)
# --------------------------------------------------------------------------

# enclosure: the OSM outline, symmetrised (half widths 40 / 33.5 / 21)
ENC = (40.0, 33.5, 21.0)
ENC_T, ENC_H = 0.9, 2.1
GATE_W = 5.0
SKIRT = -1.5  # foundations reach below the anchor ground so slopes never show a gap

# three mandala levels: (outline, z top)
K = (ENC[1] / ENC[0], ENC[2] / ENC[0])
LEVELS = [((34.0, 34.0 * K[0], 34.0 * K[1]), 2.4),
          ((28.5, 28.5 * K[0], 28.5 * K[1]), 4.6),
          ((23.5, 23.5 * K[0], 23.5 * K[1]), 6.6)]
TOP = LEVELS[-1][1]

DRUM = [(16.7, TOP, TOP + 0.7), (16.0, TOP + 0.7, TOP + 1.4)]
DOME_Z = TOP + 1.4         # 8.0
DOME_R, DOME_H = 15.4, 9.6  # low, wide dome
HARMIKA_W = 7.2
HARMIKA_Z0 = DOME_Z + DOME_H - 0.2  # square white base sits into the dome crown
EYES_Z0 = HARMIKA_Z0 + 0.8          # gilded cube with the eyes
EYES_Z1 = EYES_Z0 + 3.6
VALANCE_Z1 = EYES_Z1 + 1.6
SPIRE_TIERS = 13
SPIRE_H = 7.4
SPIRE_W0, SPIRE_W1 = 6.6, 3.4


def dome_r(z):
    """Dome radius at absolute height z (ellipse, semi axes DOME_R x DOME_H)."""
    t = (z - DOME_Z) / DOME_H
    t = min(max(t, 0.0), 1.0)
    return DOME_R * math.sqrt(max(0.0, 1.0 - t * t))


# --------------------------------------------------------------------------
# parts
# --------------------------------------------------------------------------


def enclosure():
    a, b, c = ENC
    outer = cross20(a, b, c)
    # courtyard paving inside the wall
    prism(cross20(a - ENC_T, b - ENC_T, c - ENC_T), SKIRT, 0.12, 'courtyard', 'courtyard')
    # the wall: one box per edge (the outline is orthogonal), gate gap on the south face
    for (p, q) in ring_edges(outer):
        (x0, y0), (x1, y1) = p, q
        horizontal = abs(y1 - y0) < 1e-6
        length = abs(x1 - x0) if horizontal else abs(y1 - y0)
        # inward normal of a CCW edge is to the left
        ex, ey = (x1 - x0) / length, (y1 - y0) / length
        nx, ny = -ey, ex
        spans = [(0.0, length)]
        if horizontal and y0 < -a + 1e-6:  # south outer face
            mid = length / 2
            spans = [(0.0, mid - GATE_W / 2), (mid + GATE_W / 2, length)]
        for (s0, s1) in spans:
            sx0, sy0 = x0 + ex * s0, y0 + ey * s0
            sx1, sy1 = x0 + ex * s1, y0 + ey * s1
            cx = (sx0 + sx1) / 2 + nx * ENC_T / 2
            cy = (sy0 + sy1) / 2 + ny * ENC_T / 2
            seg = s1 - s0
            if horizontal:
                box(cx, cy, SKIRT, seg + (ENC_T if seg < length else ENC_T), ENC_T, ENC_H, 'whitewash')
            else:
                box(cx, cy, SKIRT, ENC_T, seg + ENC_T, ENC_H, 'whitewash')
            # coping
            if horizontal:
                box(cx, cy, ENC_H, seg + ENC_T + 0.2, ENC_T + 0.3, ENC_H + 0.18, 'whitewash')
            else:
                box(cx, cy, ENC_H, ENC_T + 0.3, seg + ENC_T + 0.2, ENC_H + 0.18, 'whitewash')
            prayer_wheels(sx0, sy0, ex, ey, -nx, -ny, seg)


def prayer_wheels(x0, y0, ex, ey, ox, oy, length):
    """Maroon niche panel on the outer face of a wall run, with a row of gilded wheels."""
    if length < 3.0:
        return
    margin = 0.6
    usable = length - 2 * margin
    panel_d = 0.08
    ang = math.atan2(ey, ex)
    cx = x0 + ex * length / 2 + ox * panel_d / 2
    cy = y0 + ey * length / 2 + oy * panel_d / 2
    box(cx, cy, 0.45, usable, panel_d, 1.75, 'wheel_panel', ang)
    # little roof ledge over the wheels
    lx = x0 + ex * length / 2 + ox * 0.3
    ly = y0 + ey * length / 2 + oy * 0.3
    box(lx, ly, 1.75, usable, 0.6, 1.88, 'whitewash', ang)
    n = int(usable // 1.25)
    if n < 1:
        return
    step = usable / n
    for i in range(n):
        s = margin + step * (i + 0.5)
        wx = x0 + ex * s + ox * 0.32
        wy = y0 + ey * s + oy * 0.32
        lathe([(0.0, 0.62), (0.2, 0.62), (0.22, 0.72), (0.22, 1.42), (0.2, 1.52), (0.0, 1.52)], 10, 'gold', wx, wy)
        lathe([(0.03, 0.45), (0.03, 0.62)], 4, 'niche', wx, wy)
        lathe([(0.03, 1.52), (0.03, 1.75)], 4, 'niche', wx, wy)


def terrace(outline, z0, z1):
    a, b, c = outline
    prism(cross20(a, b, c), SKIRT if z0 <= 0 else z0 - 0.2, z1, 'whitewash', 'terrace_floor')
    # cornice band just below the floor edge
    prism(cross20(a + 0.15, b + 0.15, c - 0.15), z1 - 0.35, z1 - 0.1, 'whitewash', 'whitewash')
    # low parapet around the edge of the floor
    for (p, q) in ring_edges(cross20(a, b, c)):
        (x0, y0), (x1, y1) = p, q
        horizontal = abs(y1 - y0) < 1e-6
        length = abs(x1 - x0) if horizontal else abs(y1 - y0)
        ex, ey = (x1 - x0) / length, (y1 - y0) / length
        nx, ny = -ey, ex
        mx, my = (x0 + x1) / 2 + nx * 0.15, (y0 + y1) / 2 + ny * 0.15
        south_axis = horizontal and y0 < -a + 1e-6
        spans = [(-length / 2, length / 2)] if not south_axis else [(-length / 2, -2.6), (2.6, length / 2)]
        for (s0, s1) in spans:
            cx, cy = mx + ex * (s0 + s1) / 2, my + ey * (s0 + s1) / 2
            seg = s1 - s0 + 0.3
            if horizontal:
                box(cx, cy, z1, seg, 0.3, z1 + 0.45, 'whitewash')
            else:
                box(cx, cy, z1, 0.3, seg, z1 + 0.45, 'whitewash')


def stairs(y_face, z0, z1, width, run_per_step=0.3, rise=0.17, outward=-1.0):
    """Straight flight on the south axis ending at the face y_face; outward = -1 means the stair lies south of it."""
    n = max(1, int(round((z1 - z0) / rise)))
    h = (z1 - z0) / n
    run = run_per_step * n
    for i in range(n):
        # step i spans from the foot to its own front edge
        y_front = y_face + outward * (run - i * run_per_step)
        ya, yb = sorted((y_front, y_face))
        box(0.0, (ya + yb) / 2, z0 - 0.05 if i == 0 else z0, width, yb - ya, z0 + h * (i + 1), 'whitewash')
    # side walls (balustrade) with a cap
    for sx in (-1, 1):
        x = sx * (width / 2 + 0.3)
        ya, yb = sorted((y_face + outward * run, y_face))
        box(x, (ya + yb) / 2, z0, 0.6, yb - ya, z1 + 0.6, 'whitewash')
        # guardian plinths at the foot
        box(x, y_face + outward * (run + 0.5), z0, 1.2, 1.2, z0 + 1.6, 'whitewash')
        lathe([(0.45, z0 + 1.6), (0.45, z0 + 2.2), (0.25, z0 + 2.5), (0.0, z0 + 2.6)], 8, 'whitewash',
              x, y_face + outward * (run + 0.5))


def chorten(x, y, z, s=1.0):
    """Small white chorten with a gilded finial."""
    box(x, y, z, 2.2 * s, 2.2 * s, z + 0.6 * s, 'whitewash')
    box(x, y, z + 0.6 * s, 1.8 * s, 1.8 * s, z + 1.0 * s, 'whitewash')
    box(x, y, z + 1.0 * s, 1.5 * s, 1.5 * s, z + 1.3 * s, 'whitewash')
    lathe([(0.75 * s, z + 1.3 * s), (0.85 * s, z + 1.6 * s), (0.8 * s, z + 2.0 * s), (0.55 * s, z + 2.35 * s),
           (0.0, z + 2.45 * s)], 12, 'whitewash', x, y, smooth=True)
    box(x, y, z + 2.35 * s, 0.5 * s, 0.5 * s, z + 2.7 * s, 'whitewash')
    lathe([(0.28 * s, z + 2.7 * s), (0.08 * s, z + 3.7 * s), (0.18 * s, z + 3.75 * s), (0.0, z + 4.05 * s)],
          8, 'gold', x, y)


def drum():
    for (r, z0, z1) in DRUM:
        lathe([(0.0, z1), (r, z1), (r, z0)][::-1], 96, 'whitewash')
        lathe([(r + 0.12, z1 - 0.12), (r + 0.12, z1)], 96, 'whitewash')
    # 108 niches with images of the Buddha around the upper drum step
    r, z0, z1 = DRUM[1]
    for i in range(108):
        a = 2 * math.pi * (i + 0.5) / 108
        x, y = (r + 0.03) * math.cos(a), (r + 0.03) * math.sin(a)
        box(x, y, z0 + 0.18, 0.06, 0.42, z0 + 0.58, 'niche', a)


def dome():
    rings = 56
    segs = 128
    petals = 20
    # vertices
    grid = []
    zs = []
    for k in range(rings + 1):
        t = k / rings
        th = t * math.pi / 2
        r = DOME_R * math.cos(th)
        z = DOME_Z + DOME_H * math.sin(th)
        zs.append(z)
        if k == rings:
            grid.append([(0.0, 0.0, z)])
        else:
            grid.append([(r * math.cos(2 * math.pi * j / segs), r * math.sin(2 * math.pi * j / segs), z)
                         for j in range(segs)])
    base = len(B.verts)
    idx = []
    for row in grid:
        idx.append(list(range(len(B.verts), len(B.verts) + len(row))))
        B.verts.extend(row)
    for k in range(rings):
        for j in range(segs):
            j1 = (j + 1) % segs
            a, b = idx[k], idx[k + 1]
            f = (a[j], a[j1], b[0]) if len(b) == 1 else (a[j], a[j1], b[j1], b[j])
            B.faces.append((f, 'whitewash', True))
    # saffron lotus arcs: a scalloped ribbon painted around the shoulder of the dome
    samples = petals * 36
    grid_lo, grid_hi = [], []
    for i in range(samples):
        phi = 2 * math.pi * i / samples
        hc = 0.30 + 0.24 * abs(math.sin(petals * phi / 2))
        for (hn, row) in ((hc - 0.017, grid_lo), (hc + 0.017, grid_hi)):
            th = math.asin(min(max(hn, 0.0), 1.0))
            r = DOME_R * math.cos(th) + 0.04
            row.append((r * math.cos(phi), r * math.sin(phi), DOME_Z + DOME_H * math.sin(th) + 0.02))
    B.quad_strip_mesh([grid_lo, grid_hi], 'paint_saffron', smooth=True)
    # stair of the whitewashers up the south face of the dome
    n = 26
    for i in range(n):
        z = DOME_Z + 0.2 + i * (DOME_H - 1.0) / n
        r = dome_r(z + 0.35)
        box(0.0, -(r + 0.15), z, 1.1, 0.6, z + 0.36, 'whitewash')


def eye_parts():
    """Flat shapes for one face, in (u, v, layer, material) polygons; u right, v up (absolute z)."""
    parts = []
    vc = EYES_Z0 + 2.05

    def poly(pts, layer, mat):
        parts.append((pts, layer, mat))

    for side in (-1, 1):
        cu = side * 1.55
        w = 1.05
        n = 16
        upper = [(cu + w * x, vc + 0.36 * (1 - x * x) ** 0.85) for x in (i / n * 2 - 1 for i in range(n + 1))]
        lower = [(cu + w * x, vc - 0.2 * (1 - x * x)) for x in (i / n * 2 - 1 for i in range(n + 1))]
        almond = lower + upper[::-1][1:-1]
        poly(almond, 1, 'paint_white')
        # iris and pupil, looking slightly down
        poly([(cu + 0.25 * math.cos(2 * math.pi * i / 20), vc + 0.03 + 0.25 * math.sin(2 * math.pi * i / 20))
              for i in range(20)], 2, 'paint_blue')
        poly([(cu + 0.12 * math.cos(2 * math.pi * i / 16), vc + 0.03 + 0.12 * math.sin(2 * math.pi * i / 16))
              for i in range(16)], 3, 'paint_black')
        # heavy upper lid line
        lid = list(upper) + [(u, v + 0.11) for (u, v) in upper[::-1]]
        poly(lid, 3, 'paint_black')
        # thin brow
        brow_lo = [(cu + 1.1 * x, vc + 0.62 + 0.18 * (1 - x * x)) for x in (i / n * 2 - 1 for i in range(n + 1))]
        brow = brow_lo + [(u, v + 0.07) for (u, v) in brow_lo[::-1]]
        poly(brow, 2, 'paint_black')
    # urna (third eye) between the brows
    poly([(0.13 * math.cos(2 * math.pi * i / 14), vc + 0.7 + 0.13 * math.sin(2 * math.pi * i / 14))
          for i in range(14)], 2, 'paint_blue')
    # the nose: a curl over a falling stroke, like a question mark
    pts = []
    for i in range(15):
        a = math.pi * 0.9 - i / 14 * math.pi * 1.45
        pts.append((0.22 * math.cos(a), vc - 0.32 + 0.22 * math.sin(a)))
    pts += [(0.06, vc - 0.62), (0.0, vc - 0.95), (-0.04, vc - 1.2)]
    for (p, q) in zip(pts, pts[1:]):
        du, dv = q[0] - p[0], q[1] - p[1]
        L = math.hypot(du, dv) or 1.0
        nu, nv = -dv / L * 0.045, du / L * 0.045
        poly([(p[0] - nu, p[1] - nv), (q[0] - nu, q[1] - nv), (q[0] + nu, q[1] + nv), (p[0] + nu, p[1] + nv)],
             2, 'paint_blue')
    return parts


def harmika():
    w = HARMIKA_W
    box(0, 0, HARMIKA_Z0 - 0.6, w + 0.8, w + 0.8, HARMIKA_Z0 + 0.8, 'whitewash')
    box(0, 0, HARMIKA_Z0 + 0.8, w, w, EYES_Z1, 'gold')
    # painted eyes on all four faces (south face built, then turned)
    d = w / 2
    parts = eye_parts()
    for q in range(4):
        ang = q * math.pi / 2
        for (pts, layer, mat) in parts:
            off = d + 0.015 * layer
            B.face([(*rot(u, -off, ang), v) for (u, v) in pts], mat)
    # cloth valance: big red band, then thin coloured stripes
    bands = [(EYES_Z1, EYES_Z1 + 0.95, 'cloth_red', 0.35),
             (EYES_Z1 + 0.95, EYES_Z1 + 1.15, 'cloth_green', 0.3),
             (EYES_Z1 + 1.15, EYES_Z1 + 1.3, 'cloth_yellow', 0.28),
             (EYES_Z1 + 1.3, EYES_Z1 + 1.45, 'cloth_red', 0.26),
             (EYES_Z1 + 1.45, VALANCE_Z1, 'cloth_blue', 0.24)]
    for (z0, z1, mat, grow) in bands:
        box(0, 0, z0, w + grow, w + grow, z1, mat)


def spire():
    h = SPIRE_H / SPIRE_TIERS
    for i in range(SPIRE_TIERS):
        t = i / (SPIRE_TIERS - 1)
        wi = SPIRE_W0 + (SPIRE_W1 - SPIRE_W0) * t
        z0 = VALANCE_Z1 + i * h
        box(0, 0, z0, wi, wi, z0 + h * 0.82, 'gold')
        box(0, 0, z0 + h * 0.82, wi + 0.12, wi + 0.12, z0 + h, 'gold')
    z = VALANCE_Z1 + SPIRE_H
    # crown: gilded ring, cloth bands, canopy, pinnacle
    lathe([(0.0, z), (1.9, z), (2.0, z + 0.35), (0.0, z + 0.35)], 32, 'gold')
    z += 0.35
    for (dz, mat) in ((1.05, 'cloth_saffron'), (0.22, 'cloth_blue'), (0.16, 'cloth_white'), (0.2, 'cloth_red')):
        lathe([(2.05, z), (2.05, z + dz)], 32, mat, smooth=True)
        z += dz
    lathe([(2.05, z), (2.35, z + 0.15), (1.7, z + 0.55), (1.0, z + 0.9), (0.0, z + 0.95)], 32, 'gold', smooth=True)
    z += 0.9
    lathe([(0.35, z), (0.55, z + 0.25), (0.6, z + 0.6), (0.4, z + 0.95), (0.18, z + 1.15), (0.3, z + 1.35),
           (0.25, z + 1.55), (0.08, z + 2.2), (0.0, z + 2.6)], 16, 'gold', smooth=True)
    # four gilded struts of the canopy frame
    for q in range(4):
        a = math.pi / 4 + q * math.pi / 2
        x, y = 1.2 * math.cos(a), 1.2 * math.sin(a)
        lathe([(0.06, z - 0.4), (0.04, z + 1.2)], 6, 'gold', x * 0.8, y * 0.8)
    return z + 2.6


def flags(z_top):
    """Prayer flag lines from the crown cloth down to small poles on the enclosure wall."""
    a, b, c = ENC
    z_anchor = VALANCE_Z1 + SPIRE_H + 1.1
    targets = []
    for q in range(4):
        ang = q * math.pi / 2
        for (x, y) in ((-0.5 * c, -a + 0.45), (0.5 * c, -a + 0.45), (-c + 0.45, -a + 0.45), (c - 0.45, -a + 0.45),
                       (b - 0.45, -b + 0.45)):
            targets.append(rot(x, y, ang))
    z_end = ENC_H + 2.6
    k = 0
    for (tx, ty) in targets:
        # pole on the wall top
        box(tx, ty, ENC_H, 0.14, 0.14, z_end + 0.1, 'niche')
        L2 = math.hypot(tx, ty)
        ux, uy = tx / L2, ty / L2
        sx, sy, sz = ux * 2.1, uy * 2.1, z_anchor
        ex, ey, ez = tx, ty, z_end
        length = math.dist((sx, sy, sz), (ex, ey, ez))
        sag = 0.03 * length
        n = int(length / 0.55)
        # perpendicular (horizontal) direction of the line, for the flag plane
        for i in range(1, n):
            t0 = (i - 0.32) / n
            t1 = (i + 0.32) / n

            def at(t):
                return (sx + (ex - sx) * t, sy + (ey - sy) * t, sz + (ez - sz) * t - 4 * sag * t * (1 - t))
            p0, p1 = at(t0), at(t1)
            hgt = 0.42
            mat = FLAG_CYCLE[k % len(FLAG_CYCLE)]
            k += 1
            B.face([(p0[0], p0[1], p0[2] - hgt), (p1[0], p1[1], p1[2] - hgt), p1, p0], mat)


# --------------------------------------------------------------------------
# build and export
# --------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(coll):
            coll.remove(item)


def build():
    reset_scene()
    B.verts.clear()
    B.faces.clear()
    mats = make_materials()

    enclosure()
    z0 = 0.0
    for (outline, z1) in LEVELS:
        terrace(outline, z0, z1)
        z0 = z1
    # stairs on the south axis: courtyard -> L1 -> L2 -> L3 -> drum
    stairs(-LEVELS[0][0][0], 0.12, LEVELS[0][1], 4.0)
    stairs(-LEVELS[1][0][0], LEVELS[0][1], LEVELS[1][1], 3.6)
    stairs(-LEVELS[2][0][0], LEVELS[1][1], LEVELS[2][1], 3.2)
    stairs(-DRUM[0][0], TOP, DOME_Z, 2.4)
    # corner chortens on the first two levels
    for (outline, z1), inset in zip(LEVELS[:2], (2.0, 1.8)):
        b = outline[1] - inset
        for (sx, sy) in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            chorten(sx * b, sy * b, z1, 1.0)
    drum()
    dome()
    harmika()
    z_top = spire()
    flags(z_top)

    names = sorted({m for (_, m, _) in B.faces})
    slot = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new(SLUG)
    me.from_pydata(B.verts, [], [f for (f, _, _) in B.faces])
    for n in names:
        me.materials.append(mats[n])
    for poly, (_, m, smooth) in zip(me.polygons, B.faces):
        poly.material_index = slot[m]
        poly.use_smooth = smooth
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(SLUG, me)
    bpy.context.scene.collection.objects.link(ob)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    zmax = max(v[2] for v in B.verts)
    print(f'{SLUG}: {tris} triangles, {len(names)} materials, height {zmax:.2f} m')
    return tris


def export(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              use_selection=False, export_extras=False, export_cameras=False, export_lights=False)
    print(f'{SLUG}: wrote {path}')


if __name__ == '__main__':
    build()
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--out' in argv:
        export(argv[argv.index('--out') + 1])
