"""Water tank: black Sintex-style roof tank, 1.2 m diameter, 1.35 m tall, with ribs, a domed shoulder and a screw lid."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

BLACK = hexcol('#1b1c1d')
RIB = hexcol('#141516')
LID = hexcol('#2a2c2e')
BLOCK = hexcol('rcc_grey', 0.8)
PIPE = hexcol('#3a5a7a')

m = Mesh()
S = 10
R = 0.6
# three concrete blocks it stands on
for a in (0.0, 2.09, 4.19):
    import math
    m.box(0.38 * math.cos(a) - 0.12, 0, 0.38 * math.sin(a) - 0.12, 0.38 * math.cos(a) + 0.12, 0.12, 0.38 * math.sin(a) + 0.12, BLOCK)
y0 = 0.12
m.cyl(0, 0, y0, y0 + 0.08, R * 0.96, R, S, BLACK)               # chamfered foot
m.cyl(0, 0, y0 + 0.08, y0 + 0.95, R, R, S, BLACK, caps=False)    # body
for y in (y0 + 0.3, y0 + 0.62):                                  # moulded ribs
    m.cyl(0, 0, y, y + 0.06, R + 0.018, R + 0.018, S, RIB, caps=False)
m.cyl(0, 0, y0 + 0.95, y0 + 1.1, R, R * 0.8, S, BLACK, caps=False)    # shoulder
m.cyl(0, 0, y0 + 1.1, y0 + 1.2, R * 0.8, R * 0.45, S, BLACK)          # dome
m.cyl(0, 0, y0 + 1.2, y0 + 1.27, R * 0.34, R * 0.34, 10, LID)         # screw lid
m.cyl(0, 0, y0 + 1.27, y0 + 1.3, R * 0.3, R * 0.3, 10, LID)
m.box(-0.14, y0 + 1.3, -0.03, 0.14, y0 + 1.33, 0.03, LID)             # lid handle
# inlet pipe up the side
m.cyl(0.5, 0.0, 0, y0 + 1.0, 0.025, 0.025, 6, PIPE)
export(m, 'water_tank', roughness=0.45)
