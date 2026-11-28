"""Streetlight: tapered grey steel pole, 7 m, swept arm and a cobra-head luminaire pointing toward -X.

Roads place lights on the left of the direction of travel; rotY is the road heading, so the road lies
toward local -X and the arm reaches that way. The luminaire's lens is the emissive part (`_lamp`).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

STEEL = hexcol('#8a8b88')
DARK = hexcol('#5d5e5c')
HOUSING = hexcol('#a3a29d')
LENS = hexcol('#fff0c4')

m = Mesh()
# plinth and tapered 8-sided pole
m.cyl(0, 0, 0, 0.35, 0.17, 0.17, 8, DARK)
m.cyl(0, 0, 0.35, 6.8, 0.105, 0.065, 8, STEEL)
# swept arm: three segments curving out and up, ending at the luminaire
arm = [(0, 6.7, 0), (-0.25, 6.95, 0), (-0.75, 7.1, 0), (-1.35, 7.1, 0)]
m.path(arm, 0.045, 6, STEEL)
# cobra head: long tapered housing with a flat lens underneath
x0, x1 = -1.2, -2.0
m.hexa([(x0, 6.98, -0.14), (x0, 6.98, 0.14), (x1 + 0.1, 6.98, 0.09), (x1 + 0.1, 6.98, -0.09),
        (x0, 7.2, -0.12), (x0, 7.2, 0.12), (x1, 7.14, 0.07), (x1, 7.14, -0.07)], HOUSING)
m.quad((x0 - 0.03, 6.975, -0.12), (x1 + 0.12, 6.975, -0.08), (x1 + 0.12, 6.975, 0.08), (x0 - 0.03, 6.975, 0.12), LENS, lamp=1.0)
m.quad((x0 - 0.03, 6.975, 0.12), (x1 + 0.12, 6.975, 0.08), (x1 + 0.12, 6.975, -0.08), (x0 - 0.03, 6.975, -0.12), LENS, lamp=1.0)
# small cap on the pole top
m.cyl(0, 0, 6.8, 6.95, 0.065, 0.0, 8, DARK)
export(m, 'streetlight', roughness=0.55, metallic=0.5, lamp=True)
