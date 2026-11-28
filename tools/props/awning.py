"""Awning: striped canvas on a steel frame, 2.5 m wide, reaching 1.3 m out from the wall (wall at z = 0, street toward +Z).

Stripes are white and a mid tone so the renderer's per-instance tint turns them into light/dark bands of any palette colour.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

LIGHT = (0.78, 0.78, 0.76)
DARK = (0.22, 0.22, 0.22)
STEEL = hexcol('#4a4c4e')

m = Mesh()
W = 1.25           # half width
N = 10             # stripes
Y_WALL, Y_FRONT, D = 2.95, 2.38, 1.3
for i in range(N):
    x0, x1 = -W + 2 * W * i / N, -W + 2 * W * (i + 1) / N
    c = LIGHT if i % 2 == 0 else DARK
    # canvas top slope, seen from above and from below (two-sided)
    m.quad((x0, Y_WALL, 0.02), (x0, Y_FRONT, D), (x1, Y_FRONT, D), (x1, Y_WALL, 0.02), c, double=True)
    # valance: the hanging front flap
    m.quad((x0, Y_FRONT, D), (x0, Y_FRONT - 0.26, D + 0.03), (x1, Y_FRONT - 0.26, D + 0.03), (x1, Y_FRONT, D), c, double=True)
# frame: wall rail, front rail and four arms with diagonal braces
m.box(-W - 0.03, Y_WALL - 0.03, 0.0, W + 0.03, Y_WALL + 0.03, 0.05, STEEL)
m.box(-W - 0.03, Y_FRONT - 0.03, D - 0.02, W + 0.03, Y_FRONT + 0.03, D + 0.03, STEEL)
for x in (-W, -W / 3, W / 3, W):
    m.frustum((x, Y_WALL - 0.02, 0.03), (x, Y_FRONT - 0.02, D), 0.015, 0.015, 4, STEEL)
    m.frustum((x, Y_WALL - 0.55, 0.03), (x, Y_FRONT - 0.04, D - 0.1), 0.012, 0.012, 4, STEEL)  # diagonal brace
export(m, 'awning', roughness=0.8)
