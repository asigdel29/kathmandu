"""Parapet pots: a row of four terracotta pots with green plants, 2 m long, standing on the roof edge (origin on the roof, row along local X)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

m = Mesh()
POT = hexcol('#b5562f')
POT_D = hexcol('#8f4222')
GREEN = hexcol('#4f6b35')
GREEN_L = hexcol('#6f8a45')
for i in range(4):
    x = (i - 1.5) * 0.5
    r = 0.17 + 0.03 * hash01(i + 40)
    m.cyl(x, 0, 0.0, 0.32, 0.12, r, 8, POT if i % 2 == 0 else POT_D)
    m.cyl(x, 0, 0.32, 0.35, r + 0.02, r + 0.02, 8, POT_D, caps=False)
    m.blob(x, 0.5, 0, 0.2, 0.17, 0.2, GREEN if i % 3 else GREEN_L, detail=1, jitter=0.12, seed=i + 7, shade=0.3)
export(m, 'parapet_pots', roughness=0.9)
