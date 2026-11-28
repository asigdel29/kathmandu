"""Shrine: small Newari brick shrine (chaitya-style niche), 1.5 m plinth, hip roof, brass bell, tika-stained deity stone,
marigold garland and a candle. Front (the niche) faces +Z.

The candle flame is the emissive part (`_lamp`), driven by the night uniform.
"""
import math
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

BRICK = hexcol('newari_brick')
BRICK_D = hexcol('newari_brick', 0.75)
STONE = hexcol('#6c6a66')
STONE_D = hexcol('#4e4d4a')
WOOD = hexcol('old_wood')
TILE = hexcol('tile_roof')
BRASS = hexcol('#c0953a')
BRASS_D = hexcol('#8f6c25')
RED = hexcol('#b3261e')
ORANGE = hexcol('saffron')
MARIGOLD = hexcol('marigold')
WAX = hexcol('#efe6c8')
FLAME = (1.0, 0.82, 0.45)
DARK = hexcol('#1a1512')

m = Mesh()
# plinth and two steps
m.box(-0.85, 0, -0.75, 0.85, 0.12, 0.95, STONE)
m.box(-0.75, 0.12, -0.65, 0.75, 0.25, 0.8, STONE_D)
# body: back, sides, two front pillars and a lintel around a niche
FY0, FY1 = 0.25, 1.55
m.box(-0.55, FY0, -0.5, 0.55, FY1, -0.1, BRICK)           # back mass
m.box(-0.55, FY0, -0.1, -0.3, FY1, 0.45, BRICK_D)         # left pillar
m.box(0.3, FY0, -0.1, 0.55, FY1, 0.45, BRICK_D)           # right pillar
m.box(-0.3, 1.2, -0.1, 0.3, FY1, 0.45, BRICK)             # lintel
m.box(-0.3, FY0, -0.1, 0.3, 0.3, 0.45, STONE_D)           # niche sill
# niche interior (dark) is the gap; deity stone
m.box(-0.12, 0.3, -0.06, 0.12, 0.78, 0.07, STONE)
m.box(-0.09, 0.78, -0.04, 0.09, 0.88, 0.05, STONE)
# wooden cornice under the roof
m.box(-0.62, FY1, -0.57, 0.62, FY1 + 0.08, 0.52, WOOD)
# hip roof in tiles with a brass pinnacle
m.frustum((0, FY1 + 0.08, -0.03), (0, FY1 + 0.7, -0.03), 0.95, 0.12, 4, TILE, twist=math.pi / 4)
m.cyl(0, -0.03, FY1 + 0.7, FY1 + 0.86, 0.08, 0.02, 6, BRASS)
m.blob(0, FY1 + 0.9, -0.03, 0.06, 0.07, 0.06, BRASS, detail=0)
# brass bell hung from the front of the cornice
m.frustum((0.0, FY1 + 0.08, 0.5), (0.0, FY1 - 0.2, 0.5), 0.012, 0.012, 4, BRASS_D)
m.frustum((0.0, FY1 - 0.2, 0.5), (0.0, FY1 - 0.1, 0.5), 0.11, 0.035, 8, BRASS)
m.blob(0.0, FY1 - 0.215, 0.5, 0.015, 0.015, 0.015, BRASS_D, detail=0)
# tika stains: red and orange daubs on the deity stone, lintel, pillars and plinth step
def daub(x0, y0, x1, y1, z, col):
    m.quad((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), col)

daub(-0.07, 0.52, 0.07, 0.70, 0.075, RED)
daub(-0.04, 0.46, 0.04, 0.54, 0.078, ORANGE)
daub(-0.05, 0.72, 0.05, 0.78, 0.078, ORANGE)
daub(-0.28, 1.24, -0.05, 1.32, 0.452, RED)
daub(0.06, 1.3, 0.24, 1.4, 0.452, ORANGE)
daub(-0.5, 0.7, -0.35, 0.82, 0.452, ORANGE)
daub(0.34, 0.95, 0.5, 1.05, 0.452, RED)
daub(-0.4, 0.45, -0.32, 0.58, 0.452, RED)
daub(-0.25, 0.25, 0.2, 0.27, 0.8, ORANGE)  # offering daub on the lower step
m.quad((-0.3, 0.255, 0.55), (0.25, 0.255, 0.55), (0.25, 0.255, 0.78), (-0.3, 0.255, 0.78), RED)
# marigold garland: a sagging row of flower blobs across the niche, plus a drop on each pillar
for i in range(7):
    t = i / 6
    x = -0.3 + 0.6 * t
    y = 1.2 - 0.12 * 4 * t * (1 - t) - 0.0
    m.blob(x, y, 0.5, 0.045, 0.045, 0.045, MARIGOLD if i % 2 == 0 else ORANGE, detail=0)
for x in (-0.42, 0.42):
    for j in range(3):
        m.blob(x, 1.1 - j * 0.1, 0.5, 0.04, 0.04, 0.04, MARIGOLD if j % 2 == 0 else ORANGE, detail=0)
# candle and two diyas on the niche sill
m.cyl(0.18, 0.2, 0.3, 0.4, 0.02, 0.02, 6, WAX)
m.frustum((0.18, 0.4, 0.2), (0.18, 0.47, 0.2), 0.016, 0.0, 5, FLAME, lamp=1.0, caps=False)
m.blob(0.18, 0.43, 0.2, 0.02, 0.035, 0.02, FLAME, detail=0, lamp=1.0)
for x in (-0.2, 0.0):
    m.frustum((x, 0.3, 0.3), (x, 0.34, 0.3), 0.03, 0.045, 6, ORANGE)
# the back-wall niche gets a dark recess quad so the shrine reads as hollow
m.quad((-0.3, 0.3, -0.099), (0.3, 0.3, -0.099), (0.3, 1.2, -0.099), (-0.3, 1.2, -0.099), DARK)
export(m, 'shrine', roughness=0.9, lamp=True)
