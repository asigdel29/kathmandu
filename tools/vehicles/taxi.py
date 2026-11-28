"""Taxi: a small white Maruti-style hatchback, black-on-yellow plates, no logos.  blender -b -P tools/vehicles/taxi.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as c  # noqa: E402

c.reset()
c.std_materials()
c.material('paint', 0xe9e7e1, 0.42, 0.08)
c.material('bumper', 0x2b2b2d, 0.7)
c.material('trim', 0x16161a, 0.6)

WHEEL_R, WHEEL_W = 0.32, 0.2
FRONT_Z, REAR_Z, TRACK_X = 1.25, -1.2, 0.725
BELT_Y = 0.88

# (z, bottom y, top y, bottom half width, belt half width, top half width, role)
rows = [
    (-1.99, 0.40, 1.02, 0.66, 0.78, 0.76, ''),
    (-1.97, 0.34, 1.04, 0.72, 0.81, 0.76, ''),
    (-1.62, 0.32, 1.48, 0.72, 0.82, 0.60, 'c_pillar'),
    (-1.50, 0.32, 1.49, 0.72, 0.82, 0.60, ''),
    (-0.82, 0.30, 1.50, 0.72, 0.82, 0.61, 'b_pillar'),
    (-0.70, 0.30, 1.50, 0.72, 0.82, 0.61, ''),
    (-0.05, 0.30, 1.48, 0.72, 0.82, 0.61, 'screen'),
    (0.52, 0.30, 0.99, 0.72, 0.82, 0.76, ''),
    (1.55, 0.32, 0.91, 0.72, 0.82, 0.77, ''),
    (1.94, 0.36, 0.80, 0.70, 0.80, 0.76, ''),
    (1.99, 0.42, 0.70, 0.64, 0.74, 0.72, ''),
]
stations = []
for z, yb, yt, wb, wm, wt, _ in rows:
    ym = min(BELT_Y, yt - 0.04)
    stations.append((z, [(-wb, yb), (wb, yb), (wm, ym), (wt, yt), (-wt, yt), (-wm, ym)]))


def pick(i, k, n, size):
    role = rows[i][6]
    if k in (2, 4):  # upper side faces: windows, except at pillars and where the cabin is not deep enough
        h = stations[i][1][3][1] - stations[i][1][2][1]
        return 'glass' if role not in ('c_pillar', 'b_pillar') and h > 0.2 else None
    if k == 3:  # top: windscreen and rear window are the steep ones
        if n[1] > 0.3 and abs(n[2]) > 0.45:
            return 'glass'
    return None


body = c.Mesh('shell')
body.loft(stations, 'paint', mat_fn=pick, cap_mat='paint')
# bumpers, lamps, grille, plates
for z, sign in ((1.97, 1), (-1.99, -1)):
    body.box(0, 0.46, z, 1.5, 0.2, 0.14, 'bumper')
for sx in (-1, 1):
    body.box(sx * 0.5, 0.67, 1.995, 0.34, 0.14, 0.05, 'light_head')
    body.box(sx * 0.6, 0.78, -2.0, 0.2, 0.2, 0.05, 'light_tail')
    body.box(sx * 0.82, 1.02, 0.42, 0.12, 0.09, 0.07, 'paint')  # mirror
    body.box(sx * 0.77, 0.98, 0.42, 0.1, 0.03, 0.03, 'trim')
body.box(0, 0.62, 2.0, 0.46, 0.1, 0.04, 'trim')  # grille
for z, sign in ((2.045, 1), (-2.065, -1)):
    body.box(0, 0.46, z, 0.5, 0.15, 0.012, 'trim')
    body.box(0, 0.46, z + sign * 0.008, 0.44, 0.1, 0.012, 'plate')
# wheel arches: a dark ring behind each tyre
for z in (FRONT_Z, REAR_Z):
    for sx in (-1, 1):
        body.cylinder(sx * 0.805, WHEEL_R + 0.06, z, WHEEL_R + 0.06, 0.03, 'trim', 'x', 16)
# shut line under the doors
for sx in (-1, 1):
    body.box(sx * 0.795, 0.4, -0.1, 0.03, 0.04, 2.3, 'bumper')

parts = [body.to_object()]
wheels = [
    c.wheel('wheel_fl', (TRACK_X, WHEEL_R, FRONT_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_fr', (-TRACK_X, WHEEL_R, FRONT_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_rl', (TRACK_X, WHEEL_R, REAR_Z), WHEEL_R, WHEEL_W),
    c.wheel('wheel_rr', (-TRACK_X, WHEEL_R, REAR_Z), WHEEL_R, WHEEL_W),
]
c.finish('taxi', parts, wheels)
