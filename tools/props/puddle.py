"""Puddle: a flat dark irregular disc, 1 m across, a few millimetres above the ground; the renderer gives it a glossy material so it reflects the sky.

Origin at the ground in the centre; the disc is a 12-sided ring of triangles facing up.
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

m = Mesh()
C = hexcol('#1b1d20')
EDGE = hexcol('#2c2a27')
N = 12
H = 0.02
ring = []
for i in range(N):
    a = 2 * math.pi * i / N
    r = 0.5 * (0.78 + 0.4 * hash01(i + 60))
    ring.append((r * math.cos(a) * 1.15, H, r * math.sin(a)))
for i in range(N):
    j = (i + 1) % N
    m.face([(0, H, 0), ring[j], ring[i]], C)
    # a slightly wetter, lighter rim blends with the road
    m.face([ring[i], ring[j], (ring[j][0] * 1.12, H - 0.005, ring[j][2] * 1.12), (ring[i][0] * 1.12, H - 0.005, ring[i][2] * 1.12)], EDGE)
export(m, 'puddle', roughness=0.08, metallic=0.0)
