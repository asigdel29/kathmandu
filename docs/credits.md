# Credits

Third-party assets shipped with the game. Map and terrain data attributions are in the README under "Data and credits".

## Audio

All sounds are released under the Creative Commons CC0 1.0 Universal public domain dedication (https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; the authors are listed here anyway. Files live in `apps/game/public/audio/`, mono MP3 at 96 kbps, 44.1 kHz. Freesound sounds were taken from the public high-quality preview of each page.

| File | Description | Source | Author | Licence | Changes |
|---|---|---|---|---|---|
| `ambience-market.mp3` | Old-core market murmur: an afternoon in Basantapur, Kathmandu, near Freak Street | https://freesound.org/people/__O/sounds/325899/ ("Durbar.wav") | __O | CC0 1.0 | 0–9 s excerpt, 8 s seamless loop (1 s crossfade), loudness normalised, mono |
| `ambience-traffic.mp3` | Suburb traffic hum: a traffic jam in Nepal | https://freesound.org/people/isohoo/sounds/501820/ ("traffic jam.wav") | isohoo | CC0 1.0 | 53.5–62.5 s excerpt, 8 s seamless loop (1 s crossfade), loudness normalised, mono |
| `ambience-wind.mp3` | Hills wind: wind in the bush on the top of Kitt Peak, Arizona | https://freesound.org/people/felix.blume/sounds/135193/ | felix.blume | CC0 1.0 | 37–46 s excerpt, 8 s seamless loop (1 s crossfade), loudness normalised, mono |
| `engine-loop.mp3` | Car engine loop; playback rate follows vehicle speed | https://opengameart.org/content/racing-car-engine-sound-loops (`loop_0.wav`) | domasx2 (cut from a public-domain pdsounds.org recording) | CC0 1.0 | loudness normalised, re-encoded |
| `horn.mp3` | Car horn, double honk | https://freesound.org/people/DeVern/sounds/349922/ ("Car Horn Honk.wav") | DeVern | CC0 1.0 | 1.42–3.10 s excerpt, short fades, loudness normalised, mono |
| `temple-bell.mp3` | Temple bell at the Pashupatinath old-age home, Kathmandu | https://freesound.org/people/pashupati_007/sounds/199901/ ("bell_rings.mp3") | pashupati_007 | CC0 1.0 | single strike from 11.0 s, 7 s with 2 s fade-out, loudness normalised |

## Ground textures

Surface photographs from Poly Haven, released under the Creative Commons CC0 1.0 Universal public domain dedication (https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; the authors are listed here anyway. Files live in `apps/game/public/textures/`; each is the 1k (1024 × 1024) diffuse map, re-encoded as progressive JPEG at quality 84. They are sampled in `apps/game/src/materials/terrain.ts` and `road.ts`.

| File | Used for | Source | Author | Licence |
|---|---|---|---|---|
| `terrain-dust.jpg` | dusty valley ground (default) | https://polyhaven.com/a/dry_ground_01 | Rob Tuytel | CC0 1.0 |
| `terrain-grass.jpg` | grass, parks, scrub | https://polyhaven.com/a/rocky_terrain_02 | Amal Kumar | CC0 1.0 |
| `terrain-farm.jpg` | farmland | https://polyhaven.com/a/farm_soil | Amal Kumar | CC0 1.0 |
| `terrain-forest.jpg` | forest floor | https://polyhaven.com/a/forest_ground_04 | Rob Tuytel (photography, processing), Rico Cilliers (minor adjustment) | CC0 1.0 |
| `terrain-rock.jpg` | slopes steeper than 35° | https://polyhaven.com/a/rock_face_03 | Dario Barresi (photography), Rico Cilliers (processing) | CC0 1.0 |
| `road-asphalt.jpg` | asphalt roads | https://polyhaven.com/a/asphalt_02 | Rob Tuytel | CC0 1.0 |
| `road-dirt.jpg` | unpaved roads, paths outside the `*-core` zones | https://polyhaven.com/a/dirt_floor | eye-candy.xyz | CC0 1.0 |
| `road-cobble.jpg` | paths in the `*-core` zones | https://polyhaven.com/a/cobblestone_floor_01 | Rob Tuytel | CC0 1.0 |
