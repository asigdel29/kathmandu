"""Billboard: two steel posts, a braced frame and a blank 6 m x 3 m face (toward +Z), top at 7.6 m, with a catwalk and lamp arms."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

STEEL = hexcol('#5b5f62')
STEEL_D = hexcol('#3e4144')
FACE = hexcol('plaster_white', 0.95)
BACK = hexcol('#6f7173')

m = Mesh()
y0, y1 = 4.6, 7.6
# posts (box columns) with footings
for x in (-2.2, 2.2):
    m.box(x - 0.3, 0, -0.55, x + 0.3, 0.25, 0.1, hexcol('rcc_grey', 0.85))
    m.box(x - 0.1, 0.25, -0.35, x + 0.1, y0 + 1.2, -0.15, STEEL)
# board: frame, face, backing panel
m.box(-3.1, y0 - 0.1, -0.12, 3.1, y1 + 0.1, 0.0, STEEL_D)
m.quad((-2.95, y0, 0.002), (2.95, y0, 0.002), (2.95, y1, 0.002), (-2.95, y1, 0.002), FACE)
m.quad((-2.95, y1, -0.122), (2.95, y1, -0.122), (2.95, y0, -0.122), (-2.95, y0, -0.122), BACK)
# frame trim on the face
for (a, b, c, d) in [(-3.1, y1, 3.1, y1 + 0.1), (-3.1, y0 - 0.1, 3.1, y0), (-3.1, y0, -2.95, y1), (2.95, y0, 3.1, y1)]:
    m.box(a, b, 0.0, c, d, 0.06, STEEL)
# back bracing: horizontal rails and diagonals between the posts
for y in (y0 + 0.3, (y0 + y1) / 2, y1 - 0.3):
    m.box(-2.3, y - 0.04, -0.4, 2.3, y + 0.04, -0.12, STEEL)
m.frustum((-2.2, y0 + 0.3, -0.25), (2.2, y1 - 0.3, -0.25), 0.03, 0.03, 4, STEEL)
m.frustum((2.2, y0 + 0.3, -0.25), (-2.2, y1 - 0.3, -0.25), 0.03, 0.03, 4, STEEL)
# catwalk under the board
m.box(-3.0, y0 - 0.35, 0.0, 3.0, y0 - 0.3, 0.6, STEEL_D)
m.box(-3.0, y0 - 0.3, 0.57, 3.0, y0 + 0.5, 0.6, STEEL_D, bottom=False)
# lamp arms on top
for x in (-2.0, 0.0, 2.0):
    m.frustum((x, y1 + 0.1, 0.0), (x, y1 + 0.55, 0.7), 0.02, 0.02, 4, STEEL)
    m.box(x - 0.15, y1 + 0.5, 0.55, x + 0.15, y1 + 0.6, 0.85, STEEL_D)
export(m, 'billboard', roughness=0.7, metallic=0.2)
