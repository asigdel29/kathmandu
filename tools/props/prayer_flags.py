"""Prayer flags: a five-colour string of 26 flags between two bamboo poles 8 m apart (along local X), sagging 0.4 m.

Colour order is the traditional blue, white, red, green, yellow.
"""
import math
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

COLORS = [hexcol('#1d4fa0'), hexcol('#f1efe8'), hexcol('#c4281c'), hexcol('#2f7a3a'), hexcol('marigold')]
BAMBOO = hexcol('#9c8a4a')
STRING = hexcol('#d8d0bc')
HALF = 4.0
TOP = 3.5
SAG = 0.4

def string_y(x):
    t = (x + HALF) / (2 * HALF)
    return TOP - SAG * 4 * t * (1 - t)

m = Mesh()
for sx, lean in ((-HALF, -0.06), (HALF, 0.06)):
    m.frustum((sx, 0, 0), (sx + lean * 3.6, 3.6, 0), 0.04, 0.025, 5, BAMBOO)
    m.blob(sx + lean * 3.6, 3.62, 0, 0.05, 0.035, 0.05, hexcol('#c4281c'), detail=0)  # small pennant tuft
pts = [(-HALF + 2 * HALF * i / 10, string_y(-HALF + 2 * HALF * i / 10), 0) for i in range(11)]
m.path(pts, 0.008, 3, STRING)
N = 26
W = 0.27
FH = 0.21
x = -HALF + 0.35
step = (2 * HALF - 0.7) / N
for i in range(N):
    x0, x1 = x + i * step, x + i * step + W
    zw = (hash01(i + 5) - 0.5) * 0.06   # a little flutter
    m.quad((x0, string_y(x0) - 0.01, 0), (x0, string_y(x0) - FH, zw), (x1, string_y(x1) - FH, zw * -1), (x1, string_y(x1) - 0.01, 0), COLORS[i % 5], double=True)
export(m, 'prayer_flags', roughness=0.9)
