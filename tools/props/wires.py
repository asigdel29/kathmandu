"""Wires: a bundle of nine black cables hanging between two powerpoles, 40 m span along local +Z.

Origin is the upper-arm insulator height (powerpole.py: y = 7.80), so `y` of a wires prop is the
ground height of the first pole plus WIRE_H = 7.8 and the instance is rotated by `rotY` (heading toward
the next pole) and `pitch` (slope). The span is rescaled along Z by the renderer (scale = span / 40).
Eight cables run insulator to insulator (four on the upper arm, four on the lower arm, 0.65 m
lower); a ninth is a slack service line that droops twice as far.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

CABLE = hexcol('#141414')
SPAN = 40.0
SEGS = 10

m = Mesh()
wires = [(x, 0.0, 0.0) for x in (-0.8, -0.4, 0.4, 0.8)] + [(x, -0.65, 0.0) for x in (-0.6, -0.2, 0.2, 0.6)]
for i, (x, y, _) in enumerate(wires):
    sag = 0.8 + 0.25 * hash01(i + 3)          # each cable sags a little differently
    sway = (hash01(i + 40) - 0.5) * 0.25      # and wanders sideways
    pts = []
    for k in range(SEGS + 1):
        t = k / SEGS
        pts.append((x + sway * 4 * t * (1 - t), y - sag * 4 * t * (1 - t), SPAN * t))
    m.path(pts, 0.022, 3, CABLE)
# slack service cable from the lower arm, sagging hard and swaying
pts = []
for k in range(SEGS + 1):
    t = k / SEGS
    pts.append((0.0 + 0.5 * 4 * t * (1 - t), -0.65 - 1.9 * 4 * t * (1 - t), SPAN * t))
m.path(pts, 0.02, 3, CABLE)
export(m, 'wires', roughness=0.6, metallic=0.3)
