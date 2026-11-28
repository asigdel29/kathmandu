"""Rebar: four rusty rods rising from a concrete column stub, bent slightly out of true, with two cross ties."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

CONCRETE = hexcol('rcc_grey', 0.85)
RUSTS = [hexcol('#7a4a2a'), hexcol('#8a5230'), hexcol('#6c3f24'), hexcol('#93603a')]
TIE = hexcol('#5e3a22')

m = Mesh()
H = 0.28
m.box(-0.22, 0, -0.22, 0.22, H, 0.22, CONCRETE)
m.box(-0.25, H - 0.04, -0.25, 0.25, H, 0.25, hexcol('rcc_grey', 0.7))  # rough cap
corners = [(-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15)]
tops = []
for i, (x, z) in enumerate(corners):
    lean_x = (hash01(i + 7) - 0.5) * 0.14
    lean_z = (hash01(i + 19) - 0.5) * 0.14
    top = (x + lean_x, 1.3 + hash01(i + 3) * 0.2, z + lean_z)
    m.frustum((x, H, z), top, 0.0125, 0.0125, 4, RUSTS[i])
    tops.append((x, z, lean_x, lean_z, top[1]))
# square ties around the rods at two heights (thin flat bars)
for ty in (0.62, 0.98):
    f = (ty - H) / (1.3 - H)
    c = [(x + lx * f, z + lz * f) for x, z, lx, lz, _ in tops]
    c = [c[0], c[1], c[3], c[2], c[0]]
    pts = [(x, ty, z) for x, z in c]
    m.path(pts, 0.007, 4, TIE, caps=False)
export(m, 'rebar', roughness=0.9, metallic=0.3)
