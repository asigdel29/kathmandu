"""Tempo: Safa-style three-wheeler, green and white, rounded cab with a single front wheel and an open back under a canopy.
blender -b -P tools/vehicles/tempo.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as c  # noqa: E402

c.reset()
c.std_materials()
c.material('green', 0x2f7d46, 0.5, 0.05)
c.material('white', 0xe9e6dc, 0.45, 0.05)
c.material('seat', 0x1d3a26, 0.8)
c.material('floor', 0x3a3a3c, 0.9)
c.material('trim', 0x16161a, 0.6)

WHEEL_R, WHEEL_W = 0.28, 0.16
FRONT_Z, REAR_Z, REAR_X = 1.2, -0.75, 0.525
BELT_Y = 0.92

# (z, bottom y, top y, bottom half width, belt half width, top half width, role of the segment that follows)
rows = [
    (1.64, 0.62, 0.74, 0.28, 0.36, 0.32, 'hood'),
    (1.48, 0.60, 1.00, 0.46, 0.58, 0.48, 'hood'),
    (0.95, 0.60, 1.08, 0.52, 0.62, 0.54, 'hood'),
    (0.66, 0.42, 1.10, 0.54, 0.62, 0.55, 'screen'),
    (0.46, 0.36, 1.72, 0.54, 0.62, 0.50, 'quarter'),
    (-0.14, 0.36, 1.74, 0.54, 0.62, 0.50, 'roof'),
]
stations = []
for z, yb, yt, wb, wm, wt, _ in rows:
    ym = min(BELT_Y, yt - 0.04)
    stations.append((z, [(-wb, yb), (wb, yb), (wm, ym), (wt, yt), (-wt, yt), (-wm, ym)]))


def pick(i, k, n, size):
    role = rows[i][6]
    if k == 3:
        if role == 'screen':
            return 'glass'
        if role in ('roof', 'quarter'):
            return 'white'
        return 'green'
    if k in (2, 4):
        return 'glass' if role == 'quarter' else 'green'
    return 'green'


body = c.Mesh('shell')
body.loft(stations, 'green', mat_fn=pick, cap_mat='green')
# canopy over the passenger bench, open at the sides and the back
body.box(0, 1.76, -0.9, 1.22, 0.07, 1.54, 'white', top_scale=0.92)
for sx in (-1, 1):
    for z in (-0.3, -1.6):
        body.box(sx * 0.57, 1.2, z, 0.05, 1.12, 0.05, 'trim')
    body.box(sx * 0.57, 0.96, -0.95, 0.04, 0.05, 1.3, 'green')  # side rail
    body.box(sx * 0.58, 0.5, -0.9, 0.04, 0.22, 1.5, 'green')  # sill
    body.box(sx * 0.4, 0.62, -0.95, 0.36, 0.1, 1.2, 'seat')  # bench
    body.box(sx * 0.54, 0.86, -0.95, 0.06, 0.34, 1.2, 'seat')  # backrest
    # rear fenders over the driving wheels
    body.box(sx * REAR_X, 0.64, REAR_Z, 0.24, 0.05, 0.66, 'green')
    body.box(sx * (REAR_X + 0.09), 0.52, REAR_Z, 0.05, 0.2, 0.66, 'green')
body.box(0, 0.42, -0.9, 1.1, 0.06, 1.56, 'floor')
body.box(0, 0.52, -1.64, 1.16, 0.2, 0.04, 'green')  # tailboard
# front: fender over the wheel, lamp, indicators, grille
body.box(0, 0.66, FRONT_Z, 0.4, 0.05, 0.62, 'green')
body.box(0, 0.62, 1.2, 0.3, 0.04, 0.62, 'green')
body.cylinder(0, 0.82, 1.66, 0.11, 0.06, 'light_head', 'z', 12)
body.box(-0.3, 0.7, 1.58, 0.08, 0.06, 0.08, 'light_amber')
body.box(0.3, 0.7, 1.58, 0.08, 0.06, 0.08, 'light_amber')
body.box(0, 0.7, 1.63, 0.24, 0.07, 0.04, 'trim')  # grille slot
body.box(0, 0.64, 1.7, 0.36, 0.06, 0.06, 'trim')  # bumper
# rear lamps and plate
for sx in (-1, 1):
    body.box(sx * 0.5, 0.56, -1.67, 0.1, 0.14, 0.04, 'light_tail')
body.box(0, 0.52, -1.67, 0.22, 0.09, 0.012, 'plate')
# wing mirrors
for sx in (-1, 1):
    body.box(sx * 0.7, 1.12, 0.55, 0.08, 0.14, 0.04, 'trim')

wheels = [
    c.wheel('wheel_f', (0, WHEEL_R, FRONT_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_rl', (REAR_X, WHEEL_R, REAR_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_rr', (-REAR_X, WHEEL_R, REAR_Z), WHEEL_R, WHEEL_W),
]
c.finish('tempo', [body.to_object()], wheels)
