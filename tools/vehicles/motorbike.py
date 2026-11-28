"""Motorbike: a red and black commuter bike with a rider seat node.  blender -b -P tools/vehicles/motorbike.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as c  # noqa: E402

c.reset()
c.std_materials()
c.material('red', 0xb3201f, 0.35, 0.15)
c.material('seat', 0x151517, 0.85)
c.material('engine', 0x2c2d31, 0.55, 0.5)
c.material('trim', 0x16161a, 0.6)

WHEEL_R, WHEEL_W = 0.30, 0.11
FRONT_Z, REAR_Z = 0.62, -0.62

b = c.Mesh('bike')
# engine and frame
b.box(0, 0.42, 0.0, 0.2, 0.3, 0.42, 'engine', top_scale=0.9)
b.box(0, 0.33, -0.2, 0.17, 0.12, 0.3, 'engine')
b.rod((0, 0.62, 0.34), (0, 0.5, -0.5), 0.03, 'trim')  # backbone
b.rod((0, 0.3, 0.1), (0, 0.4, -0.62), 0.03, 'trim')  # swing arm centre
for sx in (-1, 1):
    b.rod((sx * 0.07, 0.3, -0.62), (sx * 0.07, 0.4, 0.05), 0.022, 'trim')  # swing arms
# tank and seat
b.box(0, 0.88, 0.2, 0.28, 0.2, 0.46, 'red', top_scale=0.78)
b.box(0, 0.7, 0.2, 0.2, 0.14, 0.36, 'engine')
b.box(0, 0.79, -0.18, 0.26, 0.1, 0.6, 'seat', top_scale=0.92)
b.box(0, 0.86, 0.1, 0.22, 0.05, 0.16, 'seat')  # rider bump
for sx in (-1, 1):
    b.box(sx * 0.12, 0.6, -0.2, 0.05, 0.2, 0.36, 'red')  # side covers
    b.box(sx * 0.115, 0.7, 0.2, 0.04, 0.12, 0.3, 'red')  # tank knee pads
# rear: cowl, grab rail, fender, lamp, plate
b.box(0, 0.86, -0.6, 0.2, 0.08, 0.3, 'red', top_scale=0.85)
b.rod((-0.1, 0.9, -0.2), (-0.1, 0.9, -0.75), 0.014, 'chrome')
b.rod((0.1, 0.9, -0.2), (0.1, 0.9, -0.75), 0.014, 'chrome')
b.rod((-0.1, 0.9, -0.75), (0.1, 0.9, -0.75), 0.014, 'chrome')
b.box(0, 0.68, -0.8, 0.12, 0.04, 0.4, 'seat', top_scale=0.8)
b.box(0, 0.8, -0.82, 0.18, 0.07, 0.04, 'light_tail')
for sx in (-1, 1):
    b.box(sx * 0.16, 0.8, -0.82, 0.05, 0.05, 0.04, 'light_amber')
b.box(0, 0.56, -0.88, 0.17, 0.11, 0.012, 'plate')
# rear shocks
for sx in (-1, 1):
    b.rod((sx * 0.1, 0.4, -0.58), (sx * 0.1, 0.78, -0.42), 0.02, 'chrome')
# front end: fork, fender, bars, headlamp, mirrors
for sx in (-1, 1):
    b.rod((sx * 0.07, 0.3, FRONT_Z), (sx * 0.07, 0.94, 0.46), 0.022, 'chrome')
    b.box(sx * 0.18, 1.02, 0.46, 0.2, 0.03, 0.03, 'seat')
    b.rod((sx * 0.3, 1.02, 0.46), (sx * 0.35, 1.2, 0.43), 0.012, 'trim')  # mirror stem
    b.box(sx * 0.35, 1.22, 0.43, 0.1, 0.06, 0.02, 'trim')
    b.box(sx * 0.3, 0.97, 0.52, 0.05, 0.04, 0.05, 'light_amber')
b.box(0, 0.7, 0.62, 0.11, 0.035, 0.46, 'red', top_scale=0.9)  # front fender over the wheel
b.cylinder(0, 0.93, 0.56, 0.095, 0.1, 'light_head', 'z', 12, cap_mat='light_head')
b.cylinder(0, 0.93, 0.5, 0.105, 0.08, 'chrome', 'z', 12)
b.box(0, 1.05, 0.44, 0.14, 0.07, 0.07, 'trim')  # instrument pod
b.box(0, 0.98, 0.46, 0.1, 0.1, 0.1, 'trim')
# exhaust on the left
b.rod((0.115, 0.3, 0.2), (0.15, 0.3, -0.25), 0.03, 'chrome')
b.rod((0.15, 0.31, -0.25), (0.16, 0.36, -0.85), 0.055, 'chrome', radius_b=0.045)
# footpegs
for sx in (-1, 1):
    b.box(sx * 0.18, 0.34, -0.05, 0.12, 0.03, 0.05, 'trim')

wheels = [
    c.wheel('wheel_f', (0, WHEEL_R, FRONT_Z), WHEEL_R, WHEEL_W, segs=18),
    c.wheel('wheel_r', (0, WHEEL_R, REAR_Z), WHEEL_R, WHEEL_W, segs=18),
]
rider = c.empty('rider', (0, 0.85, -0.12))
c.finish('motorbike', [b.to_object()], wheels, extra=[rider])
