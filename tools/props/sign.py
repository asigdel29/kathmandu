"""Sign: shop board, 2.0 m x 0.6 m, plain face (no lettering), on two wall brackets. Centre height 3.0 m, wall at z = 0, face toward +Z.

The face is near-white so the per-instance tint supplies the board colour.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

FACE = (0.82, 0.82, 0.80)
FRAME = (0.30, 0.30, 0.30)
STEEL = hexcol('#4a4c4e')

m = Mesh()
cy = 3.0
m.box(-1.0, cy - 0.3, 0.1, 1.0, cy + 0.3, 0.16, FRAME)                       # frame / thickness
m.quad((-0.94, cy - 0.24, 0.165), (0.94, cy - 0.24, 0.165), (0.94, cy + 0.24, 0.165), (-0.94, cy + 0.24, 0.165), FACE)
for x in (-0.7, 0.7):
    m.box(x - 0.02, cy - 0.2, 0.0, x + 0.02, cy - 0.16, 0.1, STEEL)
    m.box(x - 0.02, cy + 0.16, 0.0, x + 0.02, cy + 0.2, 0.1, STEEL)
export(m, 'sign', roughness=0.7)
