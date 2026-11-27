"""Trees: three Kathmandu street/temple trees as faceted low-poly crowns on forked trunks, vertex colours only.

  tree_peepal       Ficus religiosa: tall, very wide dense crown, ~10 m
  tree_bottlebrush  Callistemon: smaller weeping crown with red flower brushes, ~6.5 m
  tree_jacaranda    Jacaranda: airy spreading crown with lilac flower clusters, ~8.5 m

Each is under 600 triangles. The renderer picks a variant per instance from the position hash.
"""
import math
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Mesh, hexcol, export, hash01

BARK = hexcol('#5a4636')
BARK_D = hexcol('#43362a')


def trunk(m, base_r, height, forks):
    """Tapered trunk with `forks` branches: list of (x, y, z) tips."""
    m.cyl(0, 0, 0, 0.45, base_r * 1.25, base_r, 7, BARK_D)
    m.cyl(0, 0, 0.45, height, base_r, base_r * 0.6, 7, BARK)
    for tip in forks:
        m.frustum((0, height * 0.85, 0), tip, base_r * 0.5, base_r * 0.2, 5, BARK, caps=False)


def peepal():
    m = Mesh()
    trunk(m, 0.32, 3.4, [(-2.2, 6.0, 0.4), (2.4, 6.2, -0.5), (0.2, 6.6, 2.2)])
    g = [hexcol('#5a7a34'), hexcol('#4b6a2b'), hexcol('#678a3a'), hexcol('#3f5e27')]
    # (x, y, z, rx, ry, rz, detail)
    blobs = [(0, 7.6, 0, 3.6, 2.0, 3.6, 1), (-3.4, 6.5, 0.4, 2.6, 1.6, 2.6, 1), (3.5, 6.8, -0.6, 2.7, 1.7, 2.6, 1),
             (0.3, 6.5, 3.3, 2.5, 1.5, 2.4, 1), (-0.4, 6.4, -3.3, 2.5, 1.5, 2.4, 1),
             (-1.8, 8.8, 1.2, 1.7, 1.0, 1.7, 0), (2.0, 8.9, -0.8, 1.6, 1.0, 1.6, 0), (0.0, 5.4, 0, 3.0, 0.8, 3.0, 0)]
    for i, (x, y, z, rx, ry, rz, d) in enumerate(blobs):
        m.blob(x, y, z, rx, ry, rz, g[i % 4], detail=d, jitter=0.16, seed=i + 1, shade=0.28)
    return m


def bottlebrush():
    m = Mesh()
    trunk(m, 0.16, 2.2, [(-0.9, 3.6, 0.2), (0.9, 3.8, -0.3)])
    g = [hexcol('#58704a'), hexcol('#4a6340'), hexcol('#66804f')]
    for i, (x, y, z, rx, ry, rz) in enumerate([(0, 4.0, 0, 1.9, 2.3, 1.9), (-1.3, 3.1, 0.5, 1.3, 1.9, 1.3), (1.3, 3.2, -0.4, 1.4, 1.9, 1.3)]):
        m.blob(x, y, z, rx, ry, rz, g[i], detail=1, jitter=0.14, seed=20 + i, shade=0.3)
    red, red2 = hexcol('#a8191f'), hexcol('#c8352a')
    for i in range(10):
        a = i * 2.399
        r = 1.95 + 0.5 * hash01(i + 60)
        m.blob(r * math.cos(a), 2.3 + 2.4 * hash01(i + 80), r * math.sin(a), 0.3, 0.26, 0.3, red if i % 2 else red2, detail=0)
    return m


def jacaranda():
    m = Mesh()
    trunk(m, 0.2, 3.0, [(-1.7, 5.2, 0.5), (1.8, 5.4, -0.4), (0.2, 5.8, 1.7)])
    g = [hexcol('#7a9a48'), hexcol('#6a8a3e'), hexcol('#88a652')]
    for i, (x, y, z, rx, ry, rz) in enumerate([(0, 6.6, 0, 3.2, 1.6, 3.2), (-2.3, 5.5, 0.5, 2.0, 1.2, 2.0), (2.4, 5.7, -0.5, 2.0, 1.3, 2.0)]):
        m.blob(x, y, z, rx, ry, rz, g[i], detail=1, jitter=0.2, seed=40 + i, shade=0.25)
    lilac, lilac2 = hexcol('#9b79c9'), hexcol('#b79bdc')
    for i, (x, y, z, rx, ry, rz) in enumerate([(-0.8, 7.5, 0.6, 1.9, 0.8, 1.8), (1.4, 7.3, -0.8, 1.7, 0.8, 1.6), (-2.6, 6.2, -0.6, 1.3, 0.6, 1.2),
                                              (2.7, 6.4, 0.7, 1.3, 0.6, 1.2), (0.4, 6.9, 2.0, 1.2, 0.6, 1.1)]):
        m.blob(x, y, z, rx, ry, rz, lilac if i % 2 == 0 else lilac2, detail=1 if i < 2 else 0, jitter=0.22, seed=50 + i, shade=0.18)
    return m


def scaled(mesh, s):
    out = Mesh()
    out.merge(mesh, scale=s)
    return out


# Street/temple trees stand 6-8 m; the generator also scales each instance by 0.8-1.4.
export(scaled(peepal(), 0.72), 'tree_peepal', roughness=0.95)
export(scaled(bottlebrush(), 0.9), 'tree_bottlebrush', roughness=0.95)
export(scaled(jacaranda(), 0.85), 'tree_jacaranda', roughness=0.95)
