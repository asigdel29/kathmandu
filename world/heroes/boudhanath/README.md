# Boudhanath Stupa (बौद्धनाथ स्तूप)

Tier A landmark on tile `x21_y19`. `build.py` is a pure `bpy` script with no external assets. The model is 31,734 triangles and 1.1 MB as GLB.

## Placement

- The anchor is the centroid of the OpenStreetMap outline of the stupa (way 113376590, `building=temple`, `name=Baudhanath`): lat 27.7214711, lon 85.3619721. That is 4 m from the Appendix A anchor (27.7215, 85.3620).
- `rotationDeg` is 9.5. The mandala's axes are turned 9.5° clockwise from true north. That was measured from the long edges of the OSM outline (8.9°–10.4°).
- `footprint` is the OSM outline itself: the 20-sided stepped square of the enclosure, about 81 m across.

## Dimensions (meters)

| Part | Size |
|---|---|
| Enclosure wall with the prayer-wheel ring | 20-sided outline, half widths 40 / 33.5 / 21 (OSM, symmetrised), 2.1 high; gate on the south axis |
| Mandala plinth, three levels | half widths 34 / 28.5 / 23.5, floors at 2.4 / 4.6 / 6.6 |
| Drum | two circular steps, r 16.7 and 16.0, 108 niches |
| Dome | 30.8 across, 9.6 high (low and wide), saffron lotus arcs |
| Harmika | 7.2 square, gilded, painted eyes on all four faces, red and striped cloth valance |
| Spire | 13 gilded tiers, 6.6 → 3.4 wide, 7.4 high |
| Crown, canopy and pinnacle | top at 36.3 (published height 36 m) |

Prayer-flag lines run from the crown cloth to 20 poles on the enclosure wall.

## Model frame

While building, Blender's +X is east, +Y north and +Z up, in the stupa's own axes. The glTF export (`export_yup=True`) maps north to −Z, which is the world frame. The model's origin is at ground level, and foundations reach 1.5 m below it so that sloped ground does not show a gap.

## Build

```
bun run heroes build boudhanath
# or directly
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P world/heroes/boudhanath/build.py -- --out dist/heroes/boudhanath/model.glb
```

Both paths produce the same file (sha256 `2d65eeb3…c8667a`).

## References

Wikimedia Commons; the URLs are listed in `hero.json`.
