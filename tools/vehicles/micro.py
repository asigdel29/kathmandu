"""Micro: a white HiAce-style microbus, blue and red side stripes, no text.  blender -b -P tools/vehicles/micro.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as c  # noqa: E402

c.reset()
c.std_materials()
c.material('paint', 0xeeece6, 0.42, 0.08)
c.material('bumper', 0x2b2b2d, 0.7)
c.material('trim', 0x16161a, 0.6)
c.material('stripe_blue', 0x1f3b73, 0.45)
c.material('stripe_red', 0xb3261e, 0.45)

WHEEL_R, WHEEL_W = 0.33, 0.2
FRONT_Z, REAR_Z, TRACK_X = 1.5, -1.3, 0.725
BELT_Y = 0.96

# (z, bottom y, top y, bottom half width, belt half width, top half width, role)
rows = [
    (-2.30, 0.44, 1.92, 0.74, 0.84, 0.78, ''),
    (-2.27, 0.38, 1.95, 0.78, 0.85, 0.80, 'c_pillar'),
    (-1.95, 0.36, 1.97, 0.78, 0.86, 0.80, ''),
    (-0.05, 0.36, 1.97, 0.78, 0.86, 0.80, 'b_pillar'),
    (0.12, 0.36, 1.97, 0.78, 0.86, 0.80, ''),
    (0.95, 0.36, 1.97, 0.78, 0.86, 0.80, 'screen'),
    (1.62, 0.36, 1.14, 0.76, 0.85, 0.82, ''),
    (2.18, 0.38, 0.99, 0.74, 0.83, 0.80, ''),
    (2.30, 0.46, 0.80, 0.66, 0.76, 0.72, ''),
]
stations = []
for z, yb, yt, wb, wm, wt, _ in rows:
    ym = min(BELT_Y, yt - 0.04)
    stations.append((z, [(-wb, yb), (wb, yb), (wm, ym), (wt, yt), (-wt, yt), (-wm, ym)]))


def pick(i, k, n, size):
    role = rows[i][6]
    if k in (2, 4):
        h = stations[i][1][3][1] - stations[i][1][2][1]
        return 'glass' if role not in ('c_pillar', 'b_pillar') and h > 0.3 else None
    if k == 3 and n[1] > 0.3 and n[2] > 0.45:
        return 'glass'
    return None


body = c.Mesh('shell')
body.loft(stations, 'paint', mat_fn=pick, cap_mat='paint')
# side stripes
for sx in (-1, 1):
    body.box(sx * 0.82, 0.66, 0.1, 0.03, 0.09, 4.3, 'stripe_blue')
    body.box(sx * 0.815, 0.56, 0.1, 0.03, 0.05, 4.3, 'stripe_red')
# bumpers, lamps, grille, plates
body.box(0, 0.5, 2.28, 1.56, 0.2, 0.14, 'bumper')
body.box(0, 0.5, -2.3, 1.56, 0.2, 0.14, 'bumper')
for sx in (-1, 1):
    body.box(sx * 0.58, 0.74, 2.3, 0.3, 0.16, 0.05, 'light_head')
    body.box(sx * 0.77, 0.9, -2.31, 0.14, 0.34, 0.05, 'light_tail')
    body.box(sx * 0.95, 1.25, 1.5, 0.14, 0.2, 0.07, 'trim')  # mirror
    body.box(sx * 0.9, 1.2, 1.5, 0.12, 0.03, 0.03, 'trim')
body.box(0, 0.68, 2.31, 0.7, 0.14, 0.04, 'trim')  # grille
body.box(0, 1.5, -2.31, 1.0, 0.45, 0.02, 'glass')  # rear window
for z, sign in ((2.375, 1), (-2.395, -1)):
    body.box(0, 0.5, z, 0.5, 0.15, 0.012, 'trim')
    body.box(0, 0.5, z + sign * 0.008, 0.44, 0.1, 0.012, 'plate')
# wheel arches
for z in (FRONT_Z, REAR_Z):
    for sx in (-1, 1):
        body.cylinder(sx * 0.835, WHEEL_R + 0.06, z, WHEEL_R + 0.06, 0.03, 'trim', 'x', 16)
# sliding door on the kerb (right, -x) side: shut lines and a handle
for z in (0.06, -1.35):
    body.box(-0.845, 0.72, z, 0.03, 0.68, 0.015, 'trim')
body.box(-0.865, 0.85, 0.0 - 0.15, 0.03, 0.04, 0.2, 'chrome')

wheels = [
    c.wheel('wheel_fl', (TRACK_X, WHEEL_R, FRONT_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_fr', (-TRACK_X, WHEEL_R, FRONT_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_rl', (TRACK_X, WHEEL_R, REAR_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_rr', (-TRACK_X, WHEEL_R, REAR_Z), WHEEL_R, WHEEL_W),
]
c.finish('micro', [body.to_object()], wheels)
