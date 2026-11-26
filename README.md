# Kathmandu

The Kathmandu Valley as an explorable world in the browser. Walk, ride and drive through Kathmandu, Lalitpur and Bhaktapur, built from open map data one 800 m tile at a time.

Status: early construction. The pipeline, runtime and world tiles are under active build. See `docs/contracts.md` for the coordinate frame, tile grid, artifact formats and art direction that every part of the project shares.

## How it is built

- Bulk layers (buildings, roads, water, land use) come from OpenStreetMap and are turned into per-tile 3D artifacts by a deterministic pipeline.
- Terrain comes from the AWS Terrain Tiles dataset.
- Landmarks are modelled by hand from photographs.
- The runtime is a Three.js application that streams tiles around the player.
- Every tile is curated in its own pull request. Continuous integration builds, validates and screenshots the changed tile before it can merge.

## Data and credits

- Map data © OpenStreetMap contributors, available under the Open Database License (ODbL). https://www.openstreetmap.org/copyright
- Terrain data: Mapzen Terrain Tiles, hosted by AWS Open Data. https://registry.opendata.aws/terrain-tiles/

## License

Code in this repository is released under the MIT License. World data derived from OpenStreetMap remains under ODbL.
