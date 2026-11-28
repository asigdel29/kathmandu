#!/bin/sh
# Rebuild every vehicle GLB (apps/game/public/models/vehicles/*.glb). VEHICLE_PREVIEW=<dir> also writes preview renders.
set -e
cd "$(dirname "$0")/../.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
for t in taxi tempo motorbike micro bus truck; do
  "$BLENDER" -b -P "tools/vehicles/$t.py" 2>&1 | grep -E "triangles|wrote|Error|Traceback" || true
done
