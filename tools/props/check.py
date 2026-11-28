"""Budget check for the prop GLBs: triangles, bounding box, attributes, bytes.

    python3 tools/props/check.py [dir]

Exits non-zero when a model breaks a rule: >= 1500 triangles (trees: >= 600), pivot not at ground,
more than one mesh/material, an image texture bigger than 512 px, or a file over 1 MB.
"""
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'apps', 'game', 'public', 'models', 'props')


def read(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, _, _ = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF', path
    n, kind = struct.unpack('<I4s', data[12:20])
    assert kind == b'JSON'
    return json.loads(data[20:20 + n])


def main():
    bad = 0
    total = 0
    for name in sorted(os.listdir(DIR)):
        if not name.endswith('.glb'):
            continue
        path = os.path.join(DIR, name)
        j = read(path)
        size = os.path.getsize(path)
        total += size
        tris = 0
        lo = [1e9] * 3
        hi = [-1e9] * 3
        attrs = set()
        for mesh in j['meshes']:
            for p in mesh['primitives']:
                attrs.update(p['attributes'])
                tris += j['accessors'][p['indices']]['count'] // 3 if 'indices' in p else j['accessors'][p['attributes']['POSITION']]['count'] // 3
                acc = j['accessors'][p['attributes']['POSITION']]
                lo = [min(a, b) for a, b in zip(lo, acc['min'])]
                hi = [max(a, b) for a, b in zip(hi, acc['max'])]
        limit = 600 if name.startswith('tree') else 1500
        problems = []
        if tris >= limit: problems.append(f'{tris} tris >= {limit}')
        if abs(lo[1]) > 0.06 and not name.startswith(('wires', 'prayer_flags', 'awning', 'sign', 'transformer', 'banner', 'rubbish_pile')): problems.append(f'pivot not at ground (min y {lo[1]:.2f})')
        if len(j['meshes']) != 1 or len(j.get('materials', [])) > 1: problems.append('needs exactly one mesh and one material')
        if size > 1_000_000: problems.append('over 1 MB')
        for img in j.get('images', []): problems.append('has an image texture')
        print(f'{name:28s} {tris:5d} tris  {size:7d} B  bbox x[{lo[0]:.2f},{hi[0]:.2f}] y[{lo[1]:.2f},{hi[1]:.2f}] z[{lo[2]:.2f},{hi[2]:.2f}]  {",".join(sorted(attrs))}' + ('  !! ' + '; '.join(problems) if problems else ''))
        bad += bool(problems)
    print(f'total {total} B')
    sys.exit(1 if bad else 0)


main()
