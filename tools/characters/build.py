"""Build the player and pedestrian character GLBs.

Run headless:

    sh tools/characters/fetch.sh <cache dir>
    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/characters/build.py -- --src <cache dir> --out apps/game/public/models/characters [--only player,ped_0] [--preview <dir>]

Bodies are the Quaternius Universal Base Characters (CC0), animation clips are the Quaternius Universal Animation
Library (CC0); both share one 65-bone skeleton, so the clips bind to the bodies by bone name. Everything else (clothes,
topi, shoes, skin tones) is made here: the body texture is re-baked per variant from procedural masks, accessories are
plain vertex-coloured geometry skinned to the same skeleton.
"""
import bpy, bmesh, sys, os, math, json, argparse
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import outfits  # noqa: E402
import dress  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--only", default="")
ap.add_argument("--preview", default="")
args = ap.parse_args(argv)

UBC = os.path.join(args.src, "ubc", "Universal Base Characters[Standard]")
UAL = os.path.join(args.src, "ual", "Animation Library[Standard]")
TEX = 1024
HEIGHT_SCALE = 0.93   # the base bodies are 1.77-1.81 m; Kathmandu street crowds are shorter
# game clip name -> UAL action name
PLAYER_CLIPS = {
    "idle": "Idle_Loop", "walk": "Walk_Loop", "run": "Jog_Fwd_Loop", "sprint": "Sprint_Loop",
    "jump_start": "Jump_Start", "jump_loop": "Jump_Loop", "jump_land": "Jump_Land",
    "enter": "Sitting_Enter", "drive": "Driving_Loop", "sit": "Sitting_Idle_Loop",
}
PED_CLIPS = {"idle": "Idle_Loop", "walk": "Walk_Loop"}


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


def import_base(sex):
    bpy.ops.import_scene.gltf(filepath=os.path.join(UBC, "Base Characters", "Godot - UE", f"Superhero_{sex}_FullBody.gltf"))
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.lower().startswith("superhero")][0]
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o is not body:
            bpy.data.objects.remove(o)
    return arm, body


def import_clips(arm, wanted):
    """Import the library's Unreal-skeleton FBX, keep the wanted actions (renamed to game clip names) on NLA tracks."""
    before = set(bpy.data.actions)
    before_objs = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(UAL, "Unreal Engine", "AL_Standard.fbx"))
    for o in list(bpy.data.objects):
        if o not in before_objs:
            bpy.data.objects.remove(o)
    new = [a for a in bpy.data.actions if a not in before]
    by_short = {a.name.split("|")[-1]: a for a in new}
    arm.animation_data_create()
    info = {}
    for clip, src in wanted.items():
        act = by_short[src]
        act.name = clip
        track = arm.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 0, act)
        strip.extrapolation = 'NOTHING'
        strip.blend_type = 'REPLACE'
        try:
            strip.action_slot = act.slots[0]
        except Exception:
            pass
        info[clip] = {"frames": [act.frame_range[0], act.frame_range[1]]}
    for a in new:
        if a.name not in wanted:
            bpy.data.actions.remove(a)
    arm.animation_data.action = None
    return info


def clip_speed(arm, clip):
    """Ground speed (m/s) an in-place clip is authored for: the planted foot slides back at this speed in the character frame.

    Contact frames are those where the ball of the foot is within 2 cm of its lowest point in the cycle; the speed is the
    least-squares slope of the ball's position along the facing axis (-Y) over each contact run, averaged over runs.
    """
    act = bpy.data.actions[clip]
    arm.animation_data.action = act
    arm.animation_data.action_slot = act.slots[0]
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    fps = bpy.context.scene.render.fps
    series = {"ball_l": [], "ball_r": []}
    root = []
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        for s in series:
            p = arm.matrix_world @ arm.pose.bones[s].head
            series[s].append((f / fps, p.y, p.z))
        root.append(arm.matrix_world @ arm.pose.bones["pelvis"].head)
    slopes = []
    for s, pts in series.items():
        pts = pts[:-1]   # the last frame repeats the first in a loop
        n = len(pts)
        low = min(p[2] for p in pts)
        contact = [p[2] < low + 0.02 for p in pts]
        if all(contact) or not any(contact):
            continue
        # rotate so the cycle starts on a non-contact frame, then collect the contact runs
        start = contact.index(False)
        order = [(start + i) % n for i in range(n)]
        t_unwrapped = []
        for i, k in enumerate(order):
            t_unwrapped.append(pts[k][0] + (duration_s(pts, n, fps) if k < start else 0.0))
        run = []
        for i, k in enumerate(order + [None]):
            if k is not None and contact[k]:
                run.append((t_unwrapped[i], pts[k][1]))
                continue
            if len(run) >= 3:
                m = len(run); mt = sum(r[0] for r in run) / m; my = sum(r[1] for r in run) / m
                den = sum((r[0] - mt) ** 2 for r in run)
                if den > 0:
                    slopes.append((abs(sum((r[0] - mt) * (r[1] - my) for r in run) / den), m))
            run = []
    arm.animation_data.action = None
    duration = (f1 - f0) / fps
    root_travel = (root[-1] - root[0]).length
    total = sum(m for _, m in slopes)
    speed = sum(v * m for v, m in slopes) / max(1, total)
    return {"stance_speed": speed, "slopes": [round(v, 3) for v, _ in slopes], "duration": duration, "stride": speed * duration, "root_travel": root_travel}


def duration_s(pts, n, fps):
    return n / fps


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def scaler_of(arm):
    return arm.parent


def export(path, arm, objs):
    # export from the rest pose: park the timeline outside every strip and clear the pose
    bpy.context.scene.frame_set(-1000)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    select_only([scaler_of(arm), arm] + objs)
    kw = dict(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True, export_morph=False,
        export_image_format='JPEG', export_jpeg_quality=88, export_vertex_color='ACTIVE',
        export_active_vertex_color_when_no_material=True, export_cameras=False, export_lights=False,
        export_optimize_animation_size=True,
    )
    bpy.ops.export_scene.gltf(**kw)


def build(name, spec):
    reset()
    arm, body = import_base(spec["sex"])
    clips = import_clips(arm, spec["clips"])
    parts = dress.dress(bpy, arm, body, spec, hexlin, TEX, args.src)
    scaler = bpy.data.objects.new("Character", None)
    bpy.context.scene.collection.objects.link(scaler)
    scaler.scale = (HEIGHT_SCALE,) * 3
    arm.parent = scaler
    for p in parts: p.parent = arm
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        dress.preview(bpy, arm, os.path.join(args.preview, name), spec)
    out = os.path.join(args.out, name + ".glb")
    os.makedirs(args.out, exist_ok=True)
    export(out, arm, parts)
    speeds = {c: clip_speed(arm, c) for c in ("walk", "run", "sprint") if c in clips}
    return {"file": os.path.basename(out), "bytes": os.path.getsize(out), "speeds": speeds}


if __name__ == "__main__":
    only = [s for s in args.only.split(",") if s]
    report = {}
    for name, spec in outfits.VARIANTS.items():
        if only and name not in only:
            continue
        spec = dict(spec)
        spec["name"] = name
        spec["clips"] = PLAYER_CLIPS if name == "player" else PED_CLIPS
        report[name] = build(name, spec)
        print("BUILT", name, json.dumps(report[name]))
    if not only:
        with open(os.path.join(args.out, "characters.json"), "w") as fh:
            json.dump({"heightScale": HEIGHT_SCALE, "fps": 30, "models": {
                n: {"bytes": r["bytes"], "clips": {c: {"speed": round(v["stance_speed"], 3), "duration": round(v["duration"], 4)} for c, v in r["speeds"].items()}}
                for n, r in report.items()}}, fh, indent=2)
            fh.write("\n")
    print("REPORT", json.dumps(report))
