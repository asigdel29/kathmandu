"""Outfit definitions for the character build (see build.py, dress.py).

Masks are small expression trees over the rest-pose position (T-pose, metres, front = -Y), evaluated numerically (to
inflate the mesh) or turned into shader nodes (to bake the colour texture), so one definition drives both.
"""


class Mk:
    def __init__(self, kind, *args):
        self.kind, self.args = kind, args

    def __and__(self, o): return Mk("and", self, o)
    def __or__(self, o): return Mk("or", self, o)
    def __invert__(self): return Mk("not", self)


def gt(axis, t, w=0.004): return Mk("gt", axis, t, w)   # axis: 'x' (|x|), 'y', 'z'
def lt(axis, t, w=0.004): return Mk("lt", axis, t, w)
def band(axis, lo, hi, w=0.004): return gt(axis, lo, w) & lt(axis, hi, w)
def lin(ax, az, c, w=0.004): return Mk("lin", ax, az, c, w)   # 1 where ax*|x| + az*z + c > 0


def _ramp(v, lo, hi):
    if hi <= lo: return 1.0 if v >= hi else 0.0
    return min(1.0, max(0.0, (v - lo) / (hi - lo)))


def ev(m, x, y, z, widen=1.0):
    k = m.kind
    if k in ("gt", "lt"):
        axis, t, w = m.args
        v = abs(x) if axis == "x" else (y if axis == "y" else z)
        s = _ramp(v, t - w * widen, t + w * widen)
        return s if k == "gt" else 1.0 - s
    if k == "lin":
        ax, az, c, w = m.args
        return _ramp(ax * abs(x) + az * z + c, -w * widen, w * widen)
    if k == "and": return ev(m.args[0], x, y, z, widen) * ev(m.args[1], x, y, z, widen)
    if k == "or": return max(ev(m.args[0], x, y, z, widen), ev(m.args[1], x, y, z, widen))
    if k == "not": return 1.0 - ev(m.args[0], x, y, z, widen)
    raise ValueError(k)


class NodeBuilder:
    def __init__(self, nt, X, Y, Z):
        self.nt, self.axes = nt, {"x": X, "y": Y, "z": Z}

    def math(self, op, a, b=None, c=None):
        n = self.nt.nodes.new("ShaderNodeMath"); n.operation = op
        for i, v in enumerate((a, b, c)):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: self.nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    def ramp(self, sock, lo, hi, invert=False):
        n = self.nt.nodes.new("ShaderNodeMapRange"); n.clamp = True
        self.nt.links.new(sock, n.inputs[0])
        n.inputs[1].default_value = lo; n.inputs[2].default_value = hi
        n.inputs[3].default_value = 1.0 if invert else 0.0
        n.inputs[4].default_value = 0.0 if invert else 1.0
        return n.outputs[0]

    def build(self, m):
        k = m.kind
        if k in ("gt", "lt"):
            axis, t, w = m.args
            return self.ramp(self.axes[axis], t - w, t + w, invert=(k == "lt"))
        if k == "lin":
            ax, az, c, w = m.args
            s = self.math("ADD", self.math("MULTIPLY", self.axes["x"], ax), self.math("MULTIPLY", self.axes["z"], az))
            return self.ramp(self.math("ADD", s, c), -w, w)
        if k == "and": return self.math("MULTIPLY", self.build(m.args[0]), self.build(m.args[1]))
        if k == "or": return self.math("MAXIMUM", self.build(m.args[0]), self.build(m.args[1]))
        if k == "not": return self.math("SUBTRACT", 1.0, self.build(m.args[0]))
        raise ValueError(k)


# Rest-pose measurements of the two bodies (see the bone head positions of the base models).
BODY = {
    "Male": dict(collar=1.515, shoulder=0.22, elbow=0.46, wrist=0.70, armz=1.456, army=0.068, legx=0.114, legy=0.045, headz=1.60),
    "Female": dict(collar=1.485, shoulder=0.153, elbow=0.39, wrist=0.64, armz=1.418, army=0.055, legx=0.111, legy=0.045, headz=1.55),
}


def neck(b, drop=0.0):
    """Below the collar line; shoulders reach a little higher than the neck base."""
    c = b["collar"] - drop
    return lt("z", c) | (gt("x", 0.13) & lt("z", c + 0.045))


def upper(b, hem, sleeve_end, drop=0.0):
    """Upper garment: above `hem`, below the collar, out to `sleeve_end` along the arm."""
    return gt("z", hem) & neck(b, drop) & lt("x", sleeve_end)


def legs(top, bottom=0.0):
    return lt("z", top) & gt("z", bottom) & lt("x", 0.30)


def shoes(colour, sole, height=0.095):
    return [(colour, lt("z", height) & lt("x", 0.4)), (sole, lt("z", 0.028) & lt("x", 0.4))]


# --------------------------------------------------------------------------------------------------------------------
# Variants
# --------------------------------------------------------------------------------------------------------------------
def player(b):
    jacket, rib, tee, jeans = "#6a7040", "#3f4526", "#d9d4c7", "#2f425f"
    hem = 0.84
    return dict(
        skin=(0.80, 0.66, 0.55), slim=1.35,
        layers=[
            (jeans, legs(1.0)),
            ("#22324b", band("z", 0.93, 0.975, 0.004) & lt("x", 0.3)),
            (tee, upper(b, 0.9, b["elbow"] + 0.005)),
            (jacket, upper(b, hem, b["wrist"] - 0.01)),
            (tee, upper(b, 1.0, 0.06, 0.02) & lt("y", -0.03) & lin(-1, 0.12, -0.132)),
            (rib, gt("z", hem) & lt("z", hem + 0.045) & lt("x", 0.3)),
            (rib, gt("z", b["collar"] - 0.03) & lt("z", b["collar"] + 0.02) & lt("x", 0.085)),
            (rib, lt("x", 0.006) & lt("y", -0.04) & band("z", hem, 1.42)),
            (rib, gt("x", b["wrist"] - 0.07) & lt("x", b["wrist"] - 0.01)),
        ] + shoes("#e9e4d8", "#2c2c2c"),
        inflate=[(upper(b, hem, b["wrist"] - 0.01), 0.022), (legs(0.99, 0.13), 0.012), (lt("z", 0.10) & lt("x", 0.4), 0.012)],
        hair=("Hair_SimpleParted", "#17120f"), hair_extra=[("Hair_Beard", "#17120f")],
        pieces=[dict(kind="tunic", z_top=0.97, z_bot=hem - 0.005, top=(0.19, 0.125), bot=(0.215, 0.14), follow=0.3,
                     bands=[(0.88, jacket), (1.0, rib)])],
    )


def ped_daura(b):
    cream, vest, suruwal = "#ebe3d0", "#262524", "#d9d0bb"
    hem = 0.72
    return dict(
        skin=(0.74, 0.58, 0.46), decimate=0.45, slim=1.35,
        layers=[
            (suruwal, legs(1.0)),
            (cream, gt("z", 0.20) & lt("z", 0.26) & lt("x", 0.3)),
            (cream, upper(b, hem, b["wrist"] - 0.01)),
            (vest, upper(b, 0.93, 0.185, 0.015)),
            (cream, lt("y", -0.02) & upper(b, 1.0, 0.2, 0.015) & lt("x", 0.2) & lin(-1, 0.22, -0.23)),
            (cream, gt("x", b["wrist"] - 0.07) & lt("x", b["wrist"] - 0.01)),
        ] + shoes("#4a2e1c", "#222222"),
        inflate=[(upper(b, hem, b["wrist"] - 0.01), 0.012), (band("z", 0.42, 1.0, 0.02) & lt("x", 0.3), 0.028), (lt("z", 0.10) & lt("x", 0.4), 0.010)],
        hair=("Hair_Buzzed", "#2a2420"),
        pieces=[dict(kind="topi", palette=["#b3262e", "#f2a81d", "#2a5ca8", "#e8e2d6"]),
                dict(kind="tunic", z_top=0.98, z_bot=hem, top=(0.19, 0.125), bot=(0.27, 0.22), follow=0.6, bands=[(1.0, cream)])],
    )


def ped_kurta(b):
    kurta, trim, churidar = "#2f6b57", "#f2a81d", "#ebe3d0"
    hem = 0.62
    return dict(
        skin=(0.84, 0.68, 0.57), decimate=0.45,
        layers=[
            (churidar, legs(1.0)),
            (kurta, upper(b, hem, b["elbow"] + 0.17, 0.03)),
            (trim, gt("x", b["elbow"] + 0.10) & lt("x", b["elbow"] + 0.17) & gt("z", 1.3)),
            (trim, upper(b, 1.44, 0.06, 0.0) & gt("z", b["collar"] - 0.06)),
        ] + shoes("#7a4f2e", "#2c2c2c"),
        inflate=[(upper(b, hem, b["elbow"] + 0.17, 0.03), 0.010), (legs(0.99, 0.13), 0.006)],
        hair=("Hair_Long", "#17120f"),
        pieces=[dict(kind="tunic", z_top=0.97, z_bot=hem, top=(0.185, 0.125), bot=(0.26, 0.22), follow=0.6,
                     bands=[(0.86, kurta), (1.0, trim)])],
    )


def ped_jacket(b):
    jacket, jeans, tee, rib = "#3e4147", "#4f6f96", "#8b3a2a", "#2b2d31"
    hem = 0.86
    return dict(
        skin=(0.77, 0.62, 0.50), decimate=0.45, slim=1.35,
        layers=[
            (jeans, legs(1.0)),
            (tee, upper(b, 0.9, b["elbow"] + 0.005)),
            (jacket, upper(b, hem, b["wrist"] - 0.01)),
            (tee, upper(b, 1.0, 0.07, 0.02) & lt("y", -0.03) & lin(-1, 0.12, -0.132)),
            (rib, gt("z", hem) & lt("z", hem + 0.04) & lt("x", 0.3)),
            (rib, gt("z", b["collar"] - 0.03) & lt("z", b["collar"] + 0.02) & lt("x", 0.085)),
            (rib, gt("x", b["wrist"] - 0.07) & lt("x", b["wrist"] - 0.01)),
        ] + shoes("#2a2a2c", "#d9d4c8"),
        inflate=[(upper(b, hem, b["wrist"] - 0.01), 0.020), (legs(0.99, 0.13), 0.012), (lt("z", 0.10) & lt("x", 0.4), 0.012)],
        hair=("Hair_Buzzed", "#1a1511"), hair_extra=[("Hair_Beard", "#1a1511")],
        pieces=[dict(kind="tunic", z_top=0.97, z_bot=hem - 0.005, top=(0.19, 0.125), bot=(0.212, 0.138), follow=0.3,
                     bands=[(0.86, jacket), (1.0, rib)])],
    )


def ped_school(b):
    shirt, skirt, tie = "#b9d4ea", "#23306b", "#23306b"
    hem = 0.70
    return dict(
        skin=(0.88, 0.72, 0.62), decimate=0.45,
        layers=[
            ("#f0efe9", lt("z", 0.30) & lt("x", 0.3)),
            (skirt, gt("z", 0.66) & lt("z", 1.0) & lt("x", 0.3)),
            (shirt, upper(b, 0.97, b["shoulder"] + 0.12)),
            (tie, lt("x", 0.024) & lt("y", -0.03) & band("z", 1.14, 1.43, 0.006)),
            ("#f0efe9", lt("x", 0.07) & gt("z", b["collar"] - 0.04) & lt("z", b["collar"] + 0.015)),
        ] + shoes("#1c1c1e", "#101010", 0.075),
        inflate=[(upper(b, 0.97, b["shoulder"] + 0.12), 0.007)],
        hair=("Hair_Buns", "#17120f"),
        pieces=[dict(kind="tunic", z_top=1.03, z_bot=hem, top=(0.19, 0.13), bot=(0.285, 0.25), follow=0.75, bands=[(0.88, skirt), (1.0, "#1a2352")])],
    )


VARIANTS = {
    "player": dict(sex="Male", make=player),
    "ped_0": dict(sex="Male", make=ped_daura),
    "ped_1": dict(sex="Female", make=ped_kurta),
    "ped_2": dict(sex="Male", make=ped_jacket),
    "ped_3": dict(sex="Female", make=ped_school),
}
