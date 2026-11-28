"""Vendor cart: a two-wheel handcart piled with produce under a marigold umbrella, 2.2 m long; handles toward +Z."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

WOOD = hexcol('old_wood')
WOOD_L = hexcol('#6b4a2e')
TYRE = hexcol('#1a1a1a')
UMB = hexcol('marigold')
UMB_B = hexcol('saffron')
POLE = hexcol('#4a4a4a')
FRUIT = [hexcol('#c4281c'), hexcol('#e07a1f'), hexcol('#f2a81d'), hexcol('#4f7a35')]

m = Mesh()
m.box(-0.6, 0.8, -0.8, 0.6, 0.88, 0.8, WOOD)                       # bed
for sx in (-0.6, 0.55):
    m.box(sx, 0.88, -0.8, sx + 0.05, 1.05, 0.8, WOOD_L)             # side boards
m.box(-0.6, 0.88, -0.8, 0.6, 1.05, -0.75, WOOD_L)
for sx in (-0.7, 0.7):
    m.frustum((sx - 0.04, 0.42, 0.0), (sx + 0.04, 0.42, 0.0), 0.42, 0.42, 12, TYRE)
m.box(-0.04, 0.4, -0.8, 0.04, 0.8, -0.7, WOOD_L)                    # leg
for sx in (-0.3, 0.3):
    m.box(sx - 0.03, 0.82, 0.8, sx + 0.03, 0.9, 1.5, WOOD)          # handles
# heaps of produce
for i in range(7):
    x = -0.4 + 0.27 * (i % 4); z = -0.5 + 0.45 * (i // 4) + 0.1 * hash01(i)
    m.blob(x, 1.12, z, 0.17, 0.14, 0.17, FRUIT[i % 4], detail=1, jitter=0.1, seed=i, shade=0.25)
# umbrella
m.cyl(0.0, -0.55, 0.88, 2.0, 0.025, 0.025, 5, POLE)
for k in range(8):
    a0 = k * 3.14159 / 4; a1 = (k + 1) * 3.14159 / 4
    import math
    r = 1.15
    m.face([(0, 2.35, -0.55), (r * math.cos(a0), 2.0, -0.55 + r * math.sin(a0)), (r * math.cos(a1), 2.0, -0.55 + r * math.sin(a1))], UMB if k % 2 == 0 else UMB_B, center=(0, 1.9, -0.55))
    m.face([(0, 2.35, -0.55), (r * math.cos(a1), 2.0, -0.55 + r * math.sin(a1)), (r * math.cos(a0), 2.0, -0.55 + r * math.sin(a0))], UMB if k % 2 == 0 else UMB_B, center=(0, 3.0, -0.55))
export(m, 'vendor_cart', roughness=0.8)
