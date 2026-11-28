"""Blender side of the character build: dress a base body from an outfit definition (see outfits.py and build.py)."""
import math, os
from outfits import BODY, NodeBuilder, ev


def _lerp(a, b, t): return a + (b - a) * t


def _smooth(v, lo, hi):
    t = min(1.0, max(0.0, (v - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


def slim(co, b, k=1.0):
    """The base bodies are built like athletes: draw torso, arms and legs in towards their bone lines."""
    x, y, z = co
    ax = abs(x)
    # arms (T-pose, along X): radial scale about the arm axis, fading out into the shoulder and at the wrist
    r = math.hypot(y - b["army"], z - b["armz"])
    w_arm = _smooth(ax, 0.17, 0.27) * (1 - _smooth(ax, b["wrist"] - 0.02, b["wrist"] + 0.06)) * (1 - _smooth(r, 0.10, 0.17))
    s = _lerp(1.0, 1.0 - 0.24 * k, w_arm)
    y = b["army"] + (y - b["army"]) * s
    z = b["armz"] + (z - b["armz"]) * s
    # torso: narrower across the chest, a little shallower
    w_t = (1 - _smooth(ax, 0.17, 0.27)) * _smooth(z, 0.95, 1.10) * (1 - _smooth(z, 1.46, 1.58))
    x = x * _lerp(1.0, 1.0 - 0.18 * k, w_t)
    y = y * _lerp(1.0, 1.0 - 0.08 * k, w_t)
    # legs: radial scale about the leg axis
    sgn = 1.0 if x >= 0 else -1.0
    dx = ax - b["legx"]
    rl = math.hypot(dx, y - b["legy"])
    w_leg = (1 - _smooth(z, 0.80, 0.98)) * (1 - _smooth(rl, 0.14, 0.22)) * _smooth(z, 0.06, 0.16)
    sl = _lerp(1.0, 1.0 - 0.08 * k, w_leg)
    x = sgn * (b["legx"] + dx * sl)
    y = b["legy"] + (y - b["legy"]) * sl
    return (x, y, z)


def _new_piece(bpy, bmesh, name, verts, faces, face_colors, weights):
    """Mesh object with per-face colours (CORNER domain 'Color') and vertex-group weights {vertex index: {group: w}}."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    bm.to_mesh(me); bm.free()
    attr = me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
    for poly, col in zip(me.polygons, face_colors):
        for li in poly.loop_indices:
            attr.data[li].color = (col[0], col[1], col[2], 1.0)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for vi, ws in weights.items():
        for g, w in ws.items():
            vg = obj.vertex_groups.get(g) or obj.vertex_groups.new(name=g)
            vg.add([vi], w, "REPLACE")
    for p in me.polygons:
        p.use_smooth = True
    return obj


def make_tunic(bpy, bmesh, name, z_top, z_bot, top, bot, cy, colors, thigh_follow=0.6, segs=24, flare_pow=1.4):
    """Flared tube around the hips (kurta, daura skirt, school skirt). top/bot = (rx, ry). colors = [(t_end, rgb)] bands."""
    rings = 6
    ts = [i / rings for i in range(rings + 1)]
    verts, weights, faces, fcols = [], {}, [], []
    for j, t in enumerate(ts):
        tt = t ** flare_pow
        z = _lerp(z_top, z_bot, t)
        rx = _lerp(top[0], bot[0], tt); ry = _lerp(top[1], bot[1], tt)
        for s in range(segs):
            a = 2 * math.pi * s / segs
            x, y = rx * math.cos(a), cy + ry * math.sin(a)
            verts.append((x, y, z))
            tw = t * thigh_follow
            sx = min(1.0, max(0.0, 0.5 + x / 0.12))
            weights[len(verts) - 1] = {"pelvis": 1.0 - tw, "thigh_l": tw * sx, "thigh_r": tw * (1 - sx)}
    for j in range(rings):
        t_mid = (ts[j] + ts[j + 1]) / 2
        col = next(c for e, c in colors if t_mid <= e)
        for s in range(segs):
            a, b = j * segs + s, j * segs + (s + 1) % segs
            faces.append((a, b, b + segs, a + segs)); fcols.append(col)
    return _new_piece(bpy, bmesh, name, verts, faces, fcols, weights)


def make_topi(bpy, bmesh, name, head, palette, segs=32):
    """Dhaka topi: slanted-front cap with a diamond pattern; head = (cx, cy, rx, ry, z_brim)."""
    cx, cy, rx, ry, zb = head
    verts, faces, fcols, weights = [], [], [], {}
    rows = [(0.0, 1.00), (0.3, 1.05), (0.65, 1.10), (1.0, 1.10)]
    for r, (t, k) in enumerate(rows):
        for s in range(segs):
            a = 2 * math.pi * s / segs
            front = max(0.0, -math.sin(a))   # front is -Y
            h = _lerp(0.108, 0.152, front)
            verts.append((cx + rx * k * math.cos(a), cy + ry * k * math.sin(a), zb + h * t))
            weights[len(verts) - 1] = {"Head": 1.0}
    centre = len(verts)
    verts.append((cx, cy, zb + 0.135)); weights[centre] = {"Head": 1.0}
    red, gold, blue, cream = palette
    for r in range(len(rows) - 1):
        for s in range(segs):
            a, b = r * segs + s, r * segs + (s + 1) % segs
            faces.append((a, b, b + segs, a + segs))
            if r == 0:
                c = red
            else:
                k = (s // 2 + r) % 4
                c = [gold, red, blue, red][k] if (s % 2 == 0) else [red, cream, red, gold][k]
            fcols.append(c)
    last = (len(rows) - 1) * segs
    for s in range(segs):
        faces.append((last + s, last + (s + 1) % segs, centre)); fcols.append(red)
    return _new_piece(bpy, bmesh, name, verts, faces, fcols, weights)


def import_hair(bpy, src, style, color, offset=(0, 0, 0)):
    path = os.path.join(src, "ubc", "Universal Base Characters[Standard]", "Hairstyles", "Origin at 0", "glTF (Godot)", style + ".gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    out = []
    for o in meshes:
        o.parent = None
        me = o.data
        for t in list(me.uv_layers)[1:]:
            me.uv_layers.remove(t)
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        attr = me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
        for li in range(len(me.loops)):
            attr.data[li].color = (color[0], color[1], color[2], 1.0)
        o.location = offset
        vg = o.vertex_groups.new(name="Head")
        vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
        me.materials.clear()
        out.append(o)
    return out


def dress(bpy, arm, body, spec, hexlin, TEX, src):
    import bmesh
    from mathutils import Vector
    b = BODY[spec["sex"]]
    o = spec["make"](b)
    me = body.data
    # clean the base mesh: first UV set only, no colour attributes
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    skin_img = None
    for n in me.materials[0].node_tree.nodes:
        if n.type == "TEX_IMAGE" and not any(k in n.image.name for k in ("Normal", "Rough")):
            skin_img = n.image
    # decimate (pedestrians)
    arm_mod = body.modifiers.get("Armature")
    if arm_mod: body.modifiers.remove(arm_mod)
    ratio = o.get("decimate")
    if ratio:
        bpy.context.view_layer.objects.active = body
        d = body.modifiers.new("dec", "DECIMATE"); d.ratio = ratio; d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
    # slim the muscular base proportions, then inflate garments
    me.update()
    for v in me.vertices:
        v.co = Vector(slim(v.co, b, o.get("slim", 1.0)))
    me.update()
    normals = [Vector(n.vector) for n in me.vertex_normals]
    for v, n in zip(me.vertices, normals):
        amt = 0.0
        for mk, a in o.get("inflate", []):
            amt = max(amt, a * ev(mk, v.co.x, v.co.y, v.co.z, widen=8.0))
        if amt > 0: v.co += n * amt
    me.update()
    # bake the colour texture from the masks
    mat = bpy.data.materials.new("bake_" + spec["name"]); mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Position"], sep.inputs[0])
    absx = nt.nodes.new("ShaderNodeMath"); absx.operation = "ABSOLUTE"; nt.links.new(sep.outputs[0], absx.inputs[0])
    nb = NodeBuilder(nt, absx.outputs[0], sep.outputs[1], sep.outputs[2])
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = skin_img
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = "RGBA"; tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = 1.0; nt.links.new(tex.outputs[0], tint.inputs[6])
    tint.inputs[7].default_value = (*o["skin"], 1.0)
    col = tint.outputs[2]
    for hexc, mk in o["layers"]:
        m = nt.nodes.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = "MIX"
        nt.links.new(nb.build(mk), m.inputs[0]); nt.links.new(col, m.inputs[6])
        m.inputs[7].default_value = (*hexlin(hexc), 1.0)
        col = m.outputs[2]
    em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(col, em.inputs[0])
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], out.inputs[0])
    img = bpy.data.images.new("T_" + spec["name"], TEX, TEX)
    target = nt.nodes.new("ShaderNodeTexImage"); target.image = img
    nt.nodes.active = target; target.select = True
    me.materials.clear(); me.materials.append(mat)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 1
    bpy.ops.object.select_all(action="DESELECT"); body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.bake(type="EMIT", margin=6, use_clear=True)
    tmp = os.path.join(os.environ.get("TMPDIR", "/tmp"), "ktm_%s.png" % spec["name"])
    img.filepath_raw = tmp; img.file_format = "PNG"; img.save()
    # final body material: baked colour only
    fm = bpy.data.materials.new("Body_" + spec["name"]); fm.use_nodes = True
    ft = fm.node_tree
    bsdf = ft.nodes["Principled BSDF"]
    t2 = ft.nodes.new("ShaderNodeTexImage"); t2.image = img
    ft.links.new(t2.outputs[0], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    me.materials.clear(); me.materials.append(fm)
    mod = body.modifiers.new("Armature", "ARMATURE"); mod.object = arm
    body.name = "Body"
    # accessories, merged into one vertex-coloured mesh
    pieces = []
    if o.get("hair"):
        style, hc = o["hair"]
        pieces += import_hair(bpy, src, style, hexlin(hc), o.get("hair_offset", (0, 0, 0)))
    for style, hc in o.get("hair_extra", []):
        pieces += import_hair(bpy, src, style, hexlin(hc), o.get("hair_offset", (0, 0, 0)))
    head_vs = [v.co for v in me.vertices if v.co.z > b["headz"] + 0.1]
    zt = max(v.z for v in head_vs)
    ring = [v for v in head_vs if abs(v.z - (zt - 0.12)) < 0.02]
    hcx = (min(v.x for v in ring) + max(v.x for v in ring)) / 2; hrx = (max(v.x for v in ring) - min(v.x for v in ring)) / 2
    hcy = (min(v.y for v in ring) + max(v.y for v in ring)) / 2; hry = (max(v.y for v in ring) - min(v.y for v in ring)) / 2
    for sp in o.get("pieces", []):
        if sp["kind"] == "tunic":
            p = make_tunic(bpy, bmesh, "tunic", sp["z_top"], sp["z_bot"], sp["top"], sp["bot"], sp.get("cy", 0.03),
                           [(e, hexlin(c)) for e, c in sp["bands"]], sp.get("follow", 0.6))
        elif sp["kind"] == "topi":
            p = make_topi(bpy, bmesh, "topi", (hcx, hcy, hrx + 0.012, hry + 0.012, zt - 0.115), [hexlin(c) for c in sp["palette"]])
        pieces.append(p)
    mats = bpy.data.materials.new("Outfit"); mats.use_nodes = True
    mt = mats.node_tree
    vc = mt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Color"
    mt.links.new(vc.outputs[0], mt.nodes["Principled BSDF"].inputs["Base Color"])
    mt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    mats.use_backface_culling = False
    for p in pieces:
        p.data.materials.clear(); p.data.materials.append(mats)
    bpy.ops.object.select_all(action="DESELECT")
    for p in pieces: p.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    if len(pieces) > 1:
        bpy.ops.object.join()
    outfit = bpy.context.view_layer.objects.active
    outfit.name = "Outfit"
    m2 = outfit.modifiers.new("Armature", "ARMATURE"); m2.object = arm
    outfit.parent = arm; body.parent = arm
    return [body, outfit]


def preview(bpy, arm, prefix, spec):
    import preview as pv
    pv.setup_world(); pv.add_sun()
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    act = bpy.data.actions["walk"]
    arm.animation_data.action = act; arm.animation_data.action_slot = act.slots[0]
    for i, (frame, loc) in enumerate([(1, (0, -3.4, 1.0)), (1, (0, 3.4, 1.0)), (9, (-3.4, 0, 1.0)), (1, (2.2, -2.8, 1.1))]):
        sc.frame_set(frame)
        pv.render(f"{prefix}_{i}.png", loc, (0, 0, 0.88), res=(420, 760), lens=50)
    arm.animation_data.action = None
