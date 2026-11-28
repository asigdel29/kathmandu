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

## Vehicle models

No third-party models. `apps/game/public/models/vehicles/*.glb` (tempo, taxi, motorbike, micro, bus, truck) are original work, built by the Blender Python scripts in `tools/vehicles/` and released under the same licence as this repository. Shapes follow the vehicles seen on Kathmandu roads (Safa tempo, Maruti-style taxi, commuter motorbike, microbus, Sajha-style bus, Tata-style lorry); they carry no brand names, logos or text. Documented in `docs/vehicles.md`.
