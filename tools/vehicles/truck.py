"""Tata-style lorry: forward-control cab, bright painted body, wooden plank load body; no brand text.

blender -b -P tools/vehicles/truck.py
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as c  # noqa: E402

c.reset()
c.std_materials()
c.material('blue', 0x2b5fa8, 0.45, 0.05)
c.material('cream', 0xeae6d6, 0.5)
c.material('wood_dark', 0x6b4423, 0.85)
c.material('wood_ochre', 0xb98a4a, 0.85)
c.material('band_yellow', 0xf2c200, 0.5)
c.material('band_red', 0xc2281f, 0.5)

R, WIDTH_TYRE = 0.5, 0.30
X_TRACK = 1.05
Z_FRONT, Z_REAR = 2.5, -1.5

DECK = 1.16      # top of the bed floor
RAIL_TOP = 2.66  # top of the side boards (~1.5 m above the bed)
CAB_Z0, CAB_Z1 = 1.6, 3.6
Z_BED0 = -3.6

# --- cab: 6-point section, counter-clockwise seen from +z; edge k runs point k -> k+1
yb, ym, yt = 0.9, 1.95, 3.0
wb, wm, wt = 1.1, 1.1, 0.95
cab_section = [(-wb, yb), (wb, yb), (wm, ym), (wt, yt), (-wt, yt), (-wm, ym)]


def cab_mat(i, k, n, size):
    if k in (2, 4):
        return 'glass'
    if k == 3:
        return 'cream'
    return None


body = c.Mesh('body')
body.loft([(CAB_Z0, cab_section), (CAB_Z1, cab_section)], 'blue', mat_fn=cab_mat, cap_mat='blue')


def ring(m, cy, cz, r_out, r_in, x0, x1, mat, segs=16):
    """Flat annular arch (wheel opening) in the axle plane, spanning x0..x1."""
    sx = 1 if x1 > x0 else -1
    for i in range(segs):
        a0 = 2 * math.pi * i / segs
        a1 = 2 * math.pi * (i + 1) / segs
        am = (a0 + a1) / 2

        def p(r, a, x):
            return (x, cy + r * math.cos(a), cz + r * math.sin(a))
        m.poly([p(r_out, a0, x0), p(r_out, a0, x1), p(r_out, a1, x1), p(r_out, a1, x0)], mat,
               (0, math.cos(am), math.sin(am)))
        m.poly([p(r_in, a0, x0), p(r_in, a0, x1), p(r_in, a1, x1), p(r_in, a1, x0)], mat,
               (0, -math.cos(am), -math.sin(am)))
        m.poly([p(r_out, a0, x1), p(r_out, a1, x1), p(r_in, a1, x1), p(r_in, a0, x1)], mat, (sx, 0, 0))
        m.poly([p(r_out, a0, x0), p(r_in, a0, x0), p(r_in, a1, x0), p(r_out, a1, x0)], mat, (-sx, 0, 0))


# arches around each wheel
for sx in (-1, 1):
    for wz in (Z_FRONT, Z_REAR):
        ring(body, R + 0.09, wz, R + 0.09, R + 0.02, sx * 1.08, sx * 1.19, 'dark')

# chassis rails and cross members under the deck
for sx in (-1, 1):
    body.box(sx * 0.6, 0.8, -0.35, 0.16, 0.16, 6.7, 'dark')
for z in (-3.0, -1.2, 0.6, 2.6):
    body.box(0, 0.8, z, 1.1, 0.12, 0.12, 'dark')

# fuel tank on the kerb side, step under the cab door
body.cylinder(-0.95, 0.78, 0.2, 0.2, 1.4, 'dark', 'z', 16)
body.box(-1.2, 0.8, 1.8, 0.14, 0.08, 0.3, 'dark')

# bed floor
body.box(0, 1.1, -1.0, 2.2, 0.12, 5.2, 'dark')

# plank side boards with alternating colours, 0.2 m boards
BOARD = 0.2
n_boards = int(round((CAB_Z0 - Z_BED0) / BOARD))
for sx in (-1, 1):
    for j in range(n_boards):
        zc = Z_BED0 + BOARD * (j + 0.5)
        mat = 'wood_dark' if j % 2 == 0 else 'wood_ochre'
        body.box(sx * 1.13, (DECK + RAIL_TOP) / 2, zc, 0.06, RAIL_TOP - DECK, BOARD * 0.96, mat)
    # painted decorative band across the boards
    body.box(sx * 1.17, 1.80, -1.0, 0.02, 0.16, 5.2, 'band_yellow')
    body.box(sx * 1.17, 1.64, -1.0, 0.02, 0.05, 5.2, 'band_red')
    # wooden side rail along the top of the boards
    body.box(sx * 1.14, RAIL_TOP - 0.05, -1.0, 0.08, 0.1, 5.2, 'wood_dark')

# tailgate of planks, handle, front board behind the cab
for i in range(11):
    xc = -1.0 + i * 0.2
    body.box(xc, (DECK + RAIL_TOP) / 2, Z_BED0, 0.19, RAIL_TOP - DECK, 0.06,
             'wood_dark' if i % 2 == 0 else 'wood_ochre')
body.box(0, 1.4, Z_BED0 - 0.06, 0.25, 0.04, 0.03, 'dark')
body.box(0, (DECK + RAIL_TOP) / 2, CAB_Z0, 2.2, RAIL_TOP - DECK, 0.06, 'wood_ochre')

# cab front: grille, round headlamps, indicators, windscreen split by a pillar, bumper
body.box(0, 1.3, CAB_Z1 + 0.01, 1.42, 0.8, 0.03, 'dark')
body.box(0, 1.3, CAB_Z1 + 0.025, 1.3, 0.7, 0.03, 'dark')
for sx in (-1, 1):
    body.cylinder(sx * 0.9, 1.55, CAB_Z1 + 0.02, 0.13, 0.04, 'light_head', 'z', 14)
    body.box(sx * 1.02, 1.05, CAB_Z1 + 0.02, 0.12, 0.1, 0.04, 'light_amber')
    # mirror on a stalk
    body.box(sx * 1.2, 2.45, 3.25, 0.08, 0.05, 0.05, 'dark')
    body.box(sx * 1.3, 2.45, 3.25, 0.05, 0.3, 0.2, 'dark')
body.box(-0.5, 2.35, CAB_Z1 + 0.02, 0.92, 0.9, 0.03, 'glass')
body.box(0.5, 2.35, CAB_Z1 + 0.02, 0.92, 0.9, 0.03, 'glass')
body.box(0, 2.35, CAB_Z1 + 0.03, 0.08, 0.9, 0.03, 'blue')
body.box(0, 0.8, CAB_Z1 + 0.11, 2.4, 0.2, 0.14, 'dark')

# tail lamps and rear bumper
for sx in (-1, 1):
    body.box(sx * 0.98, 2.3, Z_BED0 - 0.06, 0.16, 0.2, 0.04, 'light_tail')
body.box(0, 0.78, Z_BED0 - 0.12, 2.4, 0.2, 0.14, 'dark')

parts = [body.to_object()]
wheels = [
    c.wheel('wheel_fl', (X_TRACK, R, Z_FRONT), R, WIDTH_TYRE),
    c.wheel('wheel_fr', (-X_TRACK, R, Z_FRONT), R, WIDTH_TYRE),
    c.wheel('wheel_rl', (X_TRACK, R, Z_REAR), R, WIDTH_TYRE),
    c.wheel('wheel_rr', (-X_TRACK, R, Z_REAR), R, WIDTH_TYRE),
]
c.finish('truck', parts, wheels)
