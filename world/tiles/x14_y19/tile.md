# x14_y19 — नयाँ बजार (Naya Bazar)

- Naya Bazar is a dense residential and office district in the Paknajol ward of Kathmandu, next to the Thamel tourist quarter and east of the Bishnumati river; the riverside road (Bishnumati kinar) clips the north-west corner of the tile.
- The street grid is made of four- and five-storey RCC houses pressed against lanes a few metres wide, with a few taller hotels and institutional blocks standing above them.
- It is a working neighbourhood of small offices: the named buildings in the OSM data are mostly trekking and travel companies, homestays and software firms, which is the same trade as neighbouring Thamel.
- Education and health are a large share of the footprints: People's Dental College & Hospital (Nayabazar, founded 1997) stands on Ropeway Sadak, and OSM tags dozens of footprints as schools, colleges or kindergartens, including a college block east of Lekhnath Sadak.
- The through roads meet at a junction near (596, 614): Lekhnath Sadak runs east from it, Paknajol runs south-west, Ropeway Sadak runs west towards the river, and the Balaju–Sourkhutte Sadak arrives from the north.

Data notes: the zone stays `suburb` but the tile default is raised to four storeys to match the visible density. School, college and hospital footprints are restyled `institutional`; hotels are `rcc_plaster_white`; the two party palaces are `commercial_glass`. Kathmandu Model School is tagged 10 levels on an 80 m² footprint, which looks like a data error, so it is set to four. No footprint crosses a road centreline, so nothing is removed. Siddhi Ganasthan sits inside a 110 m² footprint, which is restyled as a brick shrine.

## POIs

- n943246318 — मनमोहन मेमोरियल अस्पताल (Manmohan Memorial Hospital) — hospital point in the east of the tile
- n1349697739 — Nischal Cinema Hall — cinema at the south edge
- n1956163053 — सिद्धि गणस्थान (Siddhi Ganasthan) — Hindu shrine, drawn as a two-storey brick building beside Lekhnath Sadak
- n2127168044 — Shree Shiva mandir — small roadside Shiva temple at the east edge
- n4453596452 — Fourth Eye Movies Pvt. Ltd. — film company tagged as a cinema, west edge
- n4615993995 — पीपुल्स डेंटल कलेज र अस्पताल (People's Dental College & Hospital) — seven-storey teaching hospital on Ropeway Sadak
- n5185321924 — बाहती पोखरी (Bahati Pokhari) — pond with a multifaith shrine in the north-east
- n9366440993 — Heaven Himalaya — tourism attraction on Dathu Sadak in the west

## Mission hooks

- Taxi fare picked up on Lekhnath Sadak (x 651, z 691) and dropped at the entrance of People's Dental College on Ropeway Sadak (x 531, z 582) before visiting hours end.
- Photo: the shrine beside Bahati Pokhari (x 596, z 366), then the small Shiva temple at the east edge (x 777, z 693).
- Delivery run on foot from Heaven Himalaya on Dathu Sadak (x 149, z 552) east along Ropeway Sadak, then down Paknajol to Nischal Cinema (x 698, z 771).
