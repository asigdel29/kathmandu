"""Powerpole: 8 m concrete pole, two crossarms with insulators, a pole-mounted transformer, a junction
box and loose cable loops hanging from the pole (the Kathmandu tangle).

Crossarms run along local X; the road heading is local +Z, so span wires leave along +Z.
Insulator tips used by wires.py: top arm y = 7.80 (x = +-0.80, +-0.40), lower arm y = 7.15 (x = +-0.60, +-0.20).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

CONCRETE = hexcol('rcc_grey', 0.95)
CONCRETE_D = hexcol('rcc_grey', 0.7)
ARM = hexcol('#55524c')
INSUL = hexcol('#6b4a36')
TRANSFORMER = hexcol('#6f7a72')
FIN = hexcol('#5a645d')
BOX = hexcol('#8c8f8a')
CABLE = hexcol('#161616')
STAIN = hexcol('#7d776c')

m = Mesh()
# pole: slightly tapered 8-sided concrete shaft on a thicker foot, with a darker weathered band
m.cyl(0, 0, 0, 0.5, 0.19, 0.18, 8, CONCRETE_D)
m.cyl(0, 0, 0.5, 4.0, 0.18, 0.14, 8, CONCRETE)
m.cyl(0, 0, 4.0, 8.0, 0.14, 0.10, 8, CONCRETE)
m.cyl(0, 0, 3.2, 3.6, 0.158, 0.152, 8, STAIN, caps=False)

def crossarm(y, half, tips):
    m.box(-half, y - 0.045, -0.07, half, y + 0.045, 0.07, ARM)
    m.box(-0.1, y - 0.14, -0.08, 0.1, y + 0.14, 0.08, ARM)  # clamp plate
    for x in tips:
        m.cyl(x, 0, y + 0.045, y + 0.17, 0.045, 0.028, 5, INSUL)

crossarm(7.62, 1.0, (-0.8, -0.4, 0.4, 0.8))
crossarm(6.97, 0.8, (-0.6, -0.2, 0.2, 0.6))
# pole-top insulator
m.cyl(0, 0, 8.0, 8.2, 0.05, 0.03, 5, INSUL)

# transformer on a bracket at the front (+Z), drum with fins and bushings
m.box(-0.28, 5.62, 0.1, 0.28, 5.7, 0.42, ARM)
m.cyl(0, 0.52, 5.7, 6.45, 0.30, 0.30, 10, TRANSFORMER)
m.cyl(0, 0.52, 6.45, 6.55, 0.30, 0.2, 10, TRANSFORMER)
for k in range(6):
    a = k * 3.14159 / 3 * 1.0 + 0.2
    import math
    m.box(0.3 * math.cos(a) - 0.015, 5.8, 0.52 + 0.3 * math.sin(a) - 0.04, 0.3 * math.cos(a) + 0.015, 6.35, 0.52 + 0.3 * math.sin(a) + 0.04, FIN)
for x in (-0.12, 0, 0.12):
    m.cyl(x, 0.52, 6.55, 6.78, 0.025, 0.02, 5, INSUL)
# strap clamps to the pole
m.box(-0.2, 5.82, 0.0, 0.2, 5.9, 0.12, ARM)
m.box(-0.2, 6.3, 0.0, 0.2, 6.38, 0.12, ARM)

# service junction box on the pole at head height
m.box(-0.16, 2.3, -0.30, 0.16, 2.95, -0.17, BOX)
m.box(-0.14, 2.45, -0.31, 0.14, 2.8, -0.30, CONCRETE_D)

# cable loops: black bights hanging from the lower arm, a service drop to the box, a stray cable
def loop(x0, y0, x1, y1, drop, z, n=6, r=0.016):
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - drop * 4 * t * (1 - t), z))
    m.path(pts, r, 3, CABLE)

loop(-0.6, 7.1, 0.0, 6.0, 0.35, 0.16)
loop(0.6, 7.1, 0.0, 5.4, 0.55, 0.18)
loop(0.2, 6.95, -0.05, 3.0, 0.9, -0.2)
loop(-0.2, 6.95, 0.1, 2.9, 0.6, 0.2)
loop(0.0, 5.5, -0.2, 2.9, 0.5, -0.24)
loop(-0.3, 4.2, 0.35, 4.6, 0.5, 0.2)  # sagging stray span
export(m, 'powerpole', roughness=0.9, metallic=0.1)
