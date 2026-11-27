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

## Facade textures

PBR texture sets from Poly Haven, released under the Creative Commons CC0 1.0 Universal public domain dedication (https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; the authors are listed here anyway. Files live in `apps/game/public/textures/facades/`: per building style one `<style>_diff.jpg` (colour, 1024², JPEG), `<style>_nor.jpg` (tangent-space normal, OpenGL convention) and `<style>_rough.jpg` (roughness, 512²). All three come from the 1k JPG downloads of the listed set. The facade material tints the colour map per style; the flat roofs of every style reuse the `rcc_unfinished` set.

| Style | Source | Author | Licence | Changes |
|---|---|---|---|---|
| `newari_brick` | https://polyhaven.com/a/brick_wall_006 (Brick Wall 006) | Jan Burghardt | CC0 1.0 | re-encoded JPEG, roughness map halved to 512² |
| `rcc_plaster_white` | https://polyhaven.com/a/white_stucco (White Stucco) | Amal Kumar | CC0 1.0 | re-encoded JPEG, roughness map halved to 512² |
| `rcc_plaster_pastel` | https://polyhaven.com/a/painted_plaster_wall (Painted Plaster Wall) | Amal Kumar | CC0 1.0 | re-encoded JPEG, roughness map halved to 512²; tinted per style at runtime |
| `rcc_unfinished` | https://polyhaven.com/a/concrete_layers_02 (Concrete Layers 02) | Rob Tuytel | CC0 1.0 | re-encoded JPEG, roughness map halved to 512² |
| `commercial_glass` | https://polyhaven.com/a/rectangular_facade_tiles (Rectangular Facade Tiles) | Charlotte Baglioni | CC0 1.0 | re-encoded JPEG, roughness map halved to 512²; tinted blue at runtime |
| `tin_shed` | https://polyhaven.com/a/corrugated_iron (Corrugated Iron) | Dimitrios Savva, Jenelle van Heerden | CC0 1.0 | re-encoded JPEG, roughness map halved to 512²; tinted blue at runtime |
| `temple_brick` | https://polyhaven.com/a/church_bricks_02 (Church Bricks 02) | Rob Tuytel | CC0 1.0 | colour map converted from PNG to JPEG, re-encoded JPEG, roughness map halved to 512² |
| `institutional` | https://polyhaven.com/a/beige_wall_001 (Beige Wall 001) | Dimitrios Savva, Rico Cilliers | CC0 1.0 | re-encoded JPEG, roughness map halved to 512²; tinted per style at runtime |
| `tile_roof` | https://polyhaven.com/a/clay_roof_tiles_03 (Clay Roof Tiles 03) | Amal Kumar | CC0 1.0 | re-encoded JPEG, roughness map halved to 512² |
