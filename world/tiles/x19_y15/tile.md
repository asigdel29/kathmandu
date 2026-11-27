# x19_y15 — गैरी गाउँ (Gairi Gaun)

- The tile is Gairi Gaun, a dense residential quarter of east Kathmandu near Tinkune, Shantinagar and Sinamangal. Almost every plot carries a multi-storey RCC house, packed in rows along narrow lanes on a gently sloping terrace; the mapped footprints number close to 2,800.
- The Kathmandu Ring Road (four lanes, about 14 m wide) cuts the south-east corner. The lanes that run off it carry names such as Kareshwor Marg, Prayag Marg, Jagriti Marg and Shakti Binayak Marg.
- The Bagmati River crosses the eastern half of the tile; footpaths follow its bank in the south-east, and the ground there is the lowest in the tile.
- Schools and colleges are scattered through the tile: Baneswor Campus in the south, Greyfort International School in the north-west, and a belt of school blocks on the middle terrace. Offices (NAXA, TechYatra Labs), hostels, small workshops and snack houses sit between the houses.
- The OpenStreetMap polygon for Tribhuvan International Airport reaches into the area, which is why the default zone guess was airport. The ground-level character is residential, so the zone is set to suburb.
- Sensory detail: school bells, scooter horns on the lanes and the occasional aircraft passing low on approach.

Data notes: two footprints under 8 m² are removed as slivers. The Administrative Block footprint (about 1,165 m²) sits across a 4.6 m slope, so it is raised to two storeys to keep its uphill wall above ground. Colleges are tagged `building=college`, which the default style picker does not know, so they are set to the institutional style by id.

## POIs

- n3071249788 — करेश्वर मन्दिर (Kareshwor Mandir) — Hindu temple in the north half of the tile; shrine prop at the POI
- n3071249789 — कात्यायनी मन्दिर (Katyayani Mandir) — small Hindu temple at the north edge of the tile; shrine prop at the POI
- n8187573014 — कल्याणी मन्दिर (Kalyani Mandir) — Hindu temple; the footprint a1835069104 is styled as a brick temple
- a384105210 — Administrative Block — long gabled college block on the middle terrace
- a438716810 — Academic Block — six-storey college building
- a446185062 — Baneswor Campus — four-building campus at the south edge of the tile
- a440639078 — Greyfort International School — school in the north-west corner
- a1294308754 — NAXA (Block 1) — office block with Block 2 and TechYatra Labs beside it
- a452793854 — Kshamadevi Polyclinic — four-storey clinic near the central lanes
- a1295179830 — Dolkhali Khaja Ghar — snack and tea house in the centre of the tile

## Mission hooks

- Taxi fare from the Ring Road kerb at (763, 669) to the Baneswor Campus at (360, 705); the last stretch is a narrow residential lane.
- Delivery: parcels from the NAXA office (360, 245) to the Kalyani Mandir (148, 25) before the school traffic starts.
- Photo: the Kareshwor Mandir at (367, 161), then the Administrative Block at (601, 461).
