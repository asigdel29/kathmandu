#!/bin/sh
# Rebuild every prop GLB into apps/game/public/models/props/ and check the budgets.
#   sh tools/props/build.sh            # all models
#   sh tools/props/build.sh tree sign  # selected scripts
set -e
cd "$(dirname "$0")/../.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
if [ "$#" -eq 0 ]; then set -- streetlight powerpole wires water_tank rebar awning sign billboard shrine prayer_flags shutter tree banner transformer rooftop_clutter parapet_pots parked_bike vendor_cart rubbish_pile puddle; fi
for t in "$@"; do "$BLENDER" -b -P "tools/props/$t.py" 2>&1 | grep -E '^prop |Error|Traceback|line [0-9]+' || true; done
python3 tools/props/check.py
