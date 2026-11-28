"""Rubbish pile: a low dark mound of bags and scraps, 1.6 m across and 0.5 m tall (origin at the ground, centre of the mound)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

m = Mesh()
DARK = [hexcol('#2a2824'), hexcol('#1d1c1a'), hexcol('#3a352c'), hexcol('#454038')]
m.blob(0.0, 0.1, 0.0, 0.75, 0.38, 0.65, DARK[0], detail=1, jitter=0.15, seed=3, shade=0.3)
for i, (x, z, r) in enumerate([(0.55, 0.25, 0.32), (-0.5, -0.4, 0.28), (0.1, -0.55, 0.24), (-0.35, 0.4, 0.3), (0.0, 0.05, 0.3)]):
    y = 0.05 if i < 4 else 0.4
    m.blob(x, y, z, r, r * 0.7, r, DARK[(i + 1) % 4], detail=1, jitter=0.18, seed=i + 11, shade=0.25)
m.box(0.35, 0.1, -0.15, 0.55, 0.14, 0.15, hexcol('#c9c2b4'))   # a flattened carton
export(m, 'rubbish_pile', roughness=1.0)
