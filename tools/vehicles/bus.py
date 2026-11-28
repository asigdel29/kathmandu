"""Sajha-style green city bus: long flat-fronted single-deck bus, split windscreen, destination box, no logos.

blender -b -P tools/vehicles/bus.py
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as c  # noqa: E402

c.reset()
c.std_materials()
c.material('green', 0x1f7a3c, 0.55)
c.material('cream', 0xeae6d6, 0.5)
c.material('bumper', 0x2b2b2d, 0.7)

R, WIDTH_TYRE = 0.5, 0.28
X_TRACK = 1.10
Z_FRONT, Z_REAR = 3.3, -2.7

W = 1.20        # body half width (sides)
WB = 1.10       # half width of the underside
YB = 0.55       # underside height
SILL = 1.55     # bottom of the window band
BELT = 2.60     # top of the window band
ROOF = 3.10     # roof height
RW = 1.05       # roof half width
Z_END = 4.9     # front / rear faces

# 10 points, counter-clockwise seen from +z (x to the viewer's right, y up)
section = [
    (-WB, YB), (WB, YB), (W, YB + 0.12), (W, SILL), (W, BELT),
    (RW, ROOF), (-RW, ROOF), (-W, BELT), (-W, SILL), (-W, YB + 0.12),
]
# edge k runs from point k to point k+1
EDGE_MAT = {0: 'dark', 1: 'dark', 2: 'green', 3: 'glass', 4: 'cream',
            5: 'cream', 6: 'cream', 7: 'glass', 8: 'green', 9: 'dark'}

body = c.Mesh('body')
body.loft([(-Z_END, section), (Z_END, section)], 'cream',
          mat_fn=lambda i, k, n, s: EDGE_MAT[k], cap_mat='cream')


def ring(m, cx, cy, cz, r_out, r_in, x0, x1, mat, segs=16):
    """Flat annular arch (hole = wheel opening) in the plane of the axle, spanning x0..x1."""
    sx = 1 if x1 > x0 else -1
    for i in range(segs):
        a0 = 2 * math.pi * i / segs
        a1 = 2 * math.pi * (i + 1) / segs
        am = (a0 + a1) / 2

        def p(r, a, x):
            return (x, cy + r * math.cos(a), cz + r * math.sin(a))
        # outer wall, inner wall (the wheel opening)
        m.poly([p(r_out, a0, x0), p(r_out, a0, x1), p(r_out, a1, x1), p(r_out, a1, x0)], mat,
               (0, math.cos(am), math.sin(am)))
        m.poly([p(r_in, a0, x0), p(r_in, a0, x1), p(r_in, a1, x1), p(r_in, a1, x0)], mat,
               (0, -math.cos(am), -math.sin(am)))
        # annular faces at both ends
        m.poly([p(r_out, a0, x1), p(r_out, a1, x1), p(r_in, a1, x1), p(r_in, a0, x1)], mat, (sx, 0, 0))
        m.poly([p(r_out, a0, x0), p(r_in, a0, x0), p(r_in, a1, x0), p(r_out, a1, x0)], mat, (-sx, 0, 0))


# arches: dark rings around each wheel, flush with the sides
for sx in (-1, 1):
    for wz in (Z_FRONT, Z_REAR):
        ring(body, 0, R + 0.09, wz, R + 0.09, R + 0.02, sx * (W - 0.01), sx * (W + 0.05), 'dark')

# cream stripe below the windows, both sides
for sx in (-1, 1):
    body.box(sx * (W + 0.005), 1.44, 0, 0.02, 0.12, 9.6, 'cream')

# window pillars (thin dark strips on the glass band)
for sx in (-1, 1):
    for z in (-4.0, -2.4, -0.8, 0.8, 2.4):
        body.box(sx * (W + 0.01), 2.08, z, 0.03, BELT - SILL, 0.09, 'dark')

# front face: cream cap, green lower panel, split windscreen, destination box
body.box(0, 1.1, Z_END + 0.03, 2.2, 1.0, 0.03, 'green')
body.box(0.52 - 0.0, 2.2, Z_END + 0.03, 0.92, 1.05, 0.03, 'glass')
body.box(-0.52, 2.2, Z_END + 0.03, 0.92, 1.05, 0.03, 'glass')
body.box(0, 2.2, Z_END + 0.035, 0.1, 1.1, 0.04, 'dark')
body.box(0, 2.95, Z_END + 0.04, 1.4, 0.26, 0.06, 'dark')  # destination board, no text
body.box(0, 0.7, Z_END + 0.05, 2.3, 0.2, 0.1, 'bumper')    # front bumper
body.box(0, 1.05, Z_END + 0.035, 0.9, 0.36, 0.03, 'dark')  # grille
for sx in (-1, 1):
    body.cylinder(sx * 0.78, 1.05, Z_END + 0.05, 0.11, 0.05, 'light_head', 'z', 14)
    body.box(sx * 1.0, 1.85, Z_END + 0.03, 0.14, 0.1, 0.04, 'light_amber')

# rear face: cream cap, green lower panel, dark engine door, rear window, lamps, bumper
body.box(0, 1.1, -Z_END - 0.03, 2.2, 1.0, 0.03, 'green')
body.box(0, 1.05, -Z_END - 0.04, 1.6, 0.8, 0.03, 'dark')
body.box(0, 2.2, -Z_END - 0.04, 1.7, 0.8, 0.03, 'glass')
body.box(0, 0.7, -Z_END - 0.05, 2.3, 0.2, 0.1, 'bumper')
for sx in (-1, 1):
    body.box(sx * 1.02, 2.4, -Z_END - 0.05, 0.12, 0.25, 0.04, 'light_tail')

# front door on the kerb side (-x)
body.box(-(W + 0.01), 1.6, 3.85, 0.02, 1.9, 1.1, 'dark')
body.box(-(W + 0.025), 1.95, 3.85, 0.02, 1.2, 0.85, 'glass')
body.box(-(W + 0.02), 0.6, 3.85, 0.1, 0.06, 1.1, 'dark')   # door step

# mirrors on stalks, front corners
for sx in (-1, 1):
    body.box(sx * 1.24, 2.55, 4.35, 0.12, 0.05, 0.05, 'dark')
    body.box(sx * 1.3, 2.55, 4.35, 0.06, 0.35, 0.22, 'dark')

# roof vents
for z in (-2.5, 0.5, 2.5):
    body.box(0, ROOF + 0.05, z, 1.0, 0.1, 0.6, 'dark')

parts = [body.to_object()]
wheels = [
    c.wheel('wheel_fl', (X_TRACK, R, Z_FRONT), R, WIDTH_TYRE),
    c.wheel('wheel_fr', (-X_TRACK, R, Z_FRONT), R, WIDTH_TYRE),
    c.wheel('wheel_rl', (X_TRACK, R, Z_REAR), R, WIDTH_TYRE),
    c.wheel('wheel_rr', (-X_TRACK, R, Z_REAR), R, WIDTH_TYRE),
]
c.finish('bus', parts, wheels)
