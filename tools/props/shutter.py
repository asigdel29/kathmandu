"""Shutter: a ground-floor shop front with a corrugated rolling shutter pulled up half way (2.4 m wide, 2.6 m tall).

Wall plane is z = 0, the street is toward +Z. Slats are near-white / mid grey so the per-instance tint
gives each shop its own shutter colour. Below the bottom rail there is a dark shop interior.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

SLAT_A = (0.72, 0.72, 0.70)
SLAT_B = (0.50, 0.50, 0.49)
STEEL = hexcol('#4b4e50')
STEEL_D = hexcol('#34373a')
DARK = hexcol('#161412')
FLOOR = hexcol('rcc_grey', 0.75)
HOUSE = hexcol('#6e7174')

m = Mesh()
W = 1.2
TOP = 2.45   # underside of the coil housing
BOTTOM = 1.2  # bottom rail of the half-open shutter
# interior behind the shutter and the doorstep
m.quad((-W, 0.0, 0.06), (W, 0.0, 0.06), (W, TOP, 0.06), (-W, TOP, 0.06), DARK)
m.box(-W - 0.1, 0.0, 0.0, W + 0.1, 0.1, 0.3, FLOOR)
# side guide channels and the coil housing
for sx in (-W - 0.08, W):
    m.box(sx, 0.1, 0.0, sx + 0.08, 2.75, 0.2, STEEL_D)
m.box(-W - 0.1, TOP, 0.0, W + 0.1, 2.75, 0.3, HOUSE)
m.box(-W - 0.1, 2.75, 0.0, W + 0.1, 2.8, 0.32, STEEL_D)
# corrugated slats: a zig-zag profile (y, z) extruded across the width
ys = []
y = TOP
n = 0
while y > BOTTOM + 0.01:
    ys.append((y, 0.2 if n % 2 == 0 else 0.235))
    y -= 0.075
    n += 1
ys.append((BOTTOM, 0.2))
for i in range(len(ys) - 1):
    (ya, za), (yb, zb) = ys[i], ys[i + 1]
    m.quad((-W, ya, za), (-W, yb, zb), (W, yb, zb), (W, ya, za), SLAT_A if i % 2 == 0 else SLAT_B)
# bottom rail with a lock handle
m.box(-W, BOTTOM - 0.07, 0.18, W, BOTTOM, 0.27, STEEL)
m.box(-0.05, BOTTOM - 0.05, 0.27, 0.05, BOTTOM - 0.02, 0.33, STEEL_D)
export(m, 'shutter', roughness=0.6, metallic=0.4)
