"""Banner: a cloth strip hung across a street, 6 m wide and 0.9 m tall, 5.4-6.3 m above the ground.

Local X runs across the street (the prop's rotY is the road heading, +Z), so the strip spans from kerb to kerb. The cloth is
near-white with a darker band along each edge, so the per-instance tint gives a saffron, marigold or red banner. Two thin
tie ropes run up to the wall fixings at either end.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export

CLOTH = (0.86, 0.86, 0.84)
EDGE = (0.5, 0.5, 0.48)
ROPE = hexcol('#2c2a27')

m = Mesh()
W, Y0, Y1 = 3.0, 5.4, 6.3
SEG = 6


def sag(x): return 0.35 * (1 - (x / W) ** 2)


def billow(x): return 0.12 * (1 - (x / W) ** 2)


for i in range(SEG):
    x0 = -W + 2 * W * i / SEG
    x1 = -W + 2 * W * (i + 1) / SEG
    m.quad((x0, Y0 - sag(x0), billow(x0)), (x1, Y0 - sag(x1), billow(x1)), (x1, Y1 - sag(x1), billow(x1)), (x0, Y1 - sag(x0), billow(x0)), CLOTH, double=True)
    m.quad((x0, Y1 - sag(x0) - 0.1, billow(x0) + 0.003), (x1, Y1 - sag(x1) - 0.1, billow(x1) + 0.003), (x1, Y1 - sag(x1), billow(x1) + 0.003), (x0, Y1 - sag(x0), billow(x0) + 0.003), EDGE, double=True)
    m.quad((x0, Y0 - sag(x0), billow(x0) + 0.003), (x1, Y0 - sag(x1), billow(x1) + 0.003), (x1, Y0 - sag(x1) + 0.1, billow(x1) + 0.003), (x0, Y0 - sag(x0) + 0.1, billow(x0) + 0.003), EDGE, double=True)
for s in (-1, 1):
    m.frustum((s * W, Y1 + 0.35, 0.0), (s * W, Y1 - 0.05, 0.1), 0.02, 0.02, 4, ROPE)
    m.frustum((s * W, Y0 - 0.1, 0.0), (s * W, Y0 + 0.1, 0.1), 0.02, 0.02, 4, ROPE)
export(m, 'banner', roughness=0.9)
