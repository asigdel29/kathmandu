"""Transformer: a three-drum pole-mounted bank on the back (-Z) side of a power pole, with a cross bracket and cables.

The prop shares the pole's origin: it stands exactly where a `powerpole` stands, on every 6th pole, and adds the heavy bank
(the pole model itself carries one small drum on its front).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

BODY = hexcol('#6f7a72')
FIN = hexcol('#5a645d')
BRACKET = hexcol('#55524c')
INSUL = hexcol('#6b4a36')
CABLE = hexcol('#161616')

m = Mesh()
# bracket: a cross beam strapped to the pole behind it
m.box(-0.75, 4.55, -0.42, 0.75, 4.63, -0.1, BRACKET)
m.box(-0.2, 4.4, -0.2, 0.2, 5.3, -0.1, BRACKET)
for x in (-0.55, 0.0, 0.55):
    m.cyl(x, -0.46, 4.63, 5.35, 0.22, 0.22, 10, BODY)
    m.cyl(x, -0.46, 5.35, 5.43, 0.22, 0.14, 10, BODY)
    for k in range(5):
        a = 0.3 + k * 1.2566
        import math
        m.box(x + 0.22 * math.cos(a) - 0.012, 4.72, -0.46 + 0.22 * math.sin(a) - 0.03, x + 0.22 * math.cos(a) + 0.012, 5.25, -0.46 + 0.22 * math.sin(a) + 0.03, FIN)
    m.cyl(x, -0.46, 5.43, 5.62, 0.03, 0.02, 5, INSUL)
    m.path([(x, 5.62, -0.46), (x * 0.4, 6.4, -0.3), (x * 0.1, 7.1, -0.05)], 0.012, 4, CABLE)
export(m, 'transformer', roughness=0.6, metallic=0.4)
