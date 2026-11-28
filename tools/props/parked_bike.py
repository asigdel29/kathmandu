"""Parked bike: a motorbike on its stand, 2 m long, 1.1 m tall to the handlebars; heading +Z (front wheel toward +Z)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

TYRE = hexcol('#141414')
FRAME = hexcol('#2a2a2c')
TANK = hexcol('#8a1f1f')
SEAT = hexcol('#1d1d1d')
CHROME = hexcol('#8d9094')

m = Mesh()
for z in (0.7, -0.7):
    m.frustum((-0.07, 0.3, z), (0.07, 0.3, z), 0.3, 0.3, 10, TYRE)
    m.frustum((-0.03, 0.3, z), (0.03, 0.3, z), 0.12, 0.12, 6, CHROME)
m.box(-0.12, 0.38, -0.55, 0.12, 0.62, 0.25, FRAME)            # engine block
m.box(-0.16, 0.7, -0.15, 0.16, 0.9, 0.35, TANK)               # fuel tank
m.box(-0.15, 0.72, -0.75, 0.15, 0.82, -0.12, SEAT)            # seat
m.box(-0.1, 0.55, -0.95, 0.1, 0.65, -0.55, FRAME)             # rear fender / carrier
m.path([(0, 0.3, 0.7), (0, 0.75, 0.55), (0, 1.0, 0.48)], 0.03, 5, CHROME)  # front fork
m.box(-0.32, 0.97, 0.43, 0.32, 1.02, 0.5, FRAME)              # handlebar
m.box(-0.1, 0.95, 0.5, 0.1, 1.08, 0.58, CHROME)               # headlamp
m.box(-0.04, 0.0, -0.02, 0.04, 0.3, 0.06, FRAME)              # stand
export(m, 'parked_bike', roughness=0.55, metallic=0.3)
