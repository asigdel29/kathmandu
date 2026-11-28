"""Rooftop clutter: a 3 m x 2.6 m patch of what sits on a Kathmandu flat roof - stacked boxes, a satellite dish and a clothes line.

Origin on the roof surface at the centre of the patch; the clothes line runs along local X at the +Z side.
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

m = Mesh()
GREY = [hexcol('#8a8884'), hexcol('#b0aea8'), hexcol('#6c6a66')]
# stacked boxes and a bucket
m.box(-1.4, 0.0, -0.9, -0.6, 0.5, -0.3, GREY[0])
m.box(-0.8, 0.0, -1.2, -0.3, 0.35, -0.7, GREY[1])
m.box(-1.5, 0.0, 0.0, -0.8, 0.6, 0.4, GREY[2])
m.box(-1.2, 0.6, 0.05, -0.9, 0.75, 0.35, GREY[0])
m.cyl(-0.2, -0.9, 0.0, 0.3, 0.18, 0.15, 8, hexcol('#3b6ea5'))
# satellite dish on a post, tilted up and to the south
m.cyl(0.8, -0.5, 0.0, 0.9, 0.03, 0.03, 6, hexcol('#555555'))
m.frustum((0.8, 1.0, -0.4), (0.8, 1.14, -0.25), 0.5, 0.1, 12, hexcol('#d8d8d4'), caps=False)
m.cyl(0.8, -0.35, 0.9, 1.1, 0.02, 0.02, 4, hexcol('#444444'))
# clothes line: two posts, a line and cloths
for x in (-0.7, 1.1):
    m.cyl(x, 0.95, 0.0, 1.55, 0.025, 0.025, 5, hexcol('#4a4a4a'))
m.path([(-0.7, 1.5, 0.95), (0.2, 1.43, 0.95), (1.1, 1.5, 0.95)], 0.008, 4, hexcol('#303030'))
for i, (x, w, h, c) in enumerate([(-0.35, 0.32, 0.55, '#e3cfc0'), (0.1, 0.34, 0.5, '#3b6ea5'), (0.55, 0.3, 0.6, '#e07a1f'), (0.85, 0.25, 0.4, '#f2a81d')]):
    top = 1.45 - 0.04 * (1 - abs(x - 0.2) / 0.9)
    m.quad((x - w / 2, top - h, 0.95), (x + w / 2, top - h, 0.95), (x + w / 2, top, 0.95), (x - w / 2, top, 0.95), hexcol(c), double=True)
export(m, 'rooftop_clutter', roughness=0.85)
