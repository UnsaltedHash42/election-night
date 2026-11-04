# Map geometry

`public/map-shapes.json` contains projected SVG paths, centroids and bounds for 50 states, D.C., 435 voting House districts and D.C.'s delegate district. It contains no election results. The browser needs no map library or tile service.

## Sources

- State outlines: [us-atlas 3.0.1](https://github.com/topojson/us-atlas), `states-10m.json`, from the Census Bureau's 2017 cartographic state boundaries. The package uses the ISC license; its complete notice is retained in the JSON asset's source metadata. The state outlines are background geography, not congressional district boundaries.
- House districts: [watch.vote's national district snapshot](https://watch.vote/api/elections/2026/districts/national), documented in its [2026 election API](https://watch.vote/docs/api-reference/elections). The response identifies Census TIGERweb's 120th Congress layer and the snapshot date **2026-09-11T03:47:13.852Z**. The provider documents Missouri's use of the 119th Congress layer for the November 3 ballot. The Census geometry is public U.S. government data.
- The district response reports its national-map simplification: Douglas–Peucker tolerance 0.012 degrees, rings below 0.0006 square degrees omitted, coordinates rounded to four decimal places. This build adds no geographic simplification; it rounds projected SVG coordinates to two decimal places.
- [D3's Albers USA projection](https://d3js.org/d3-geo/conic#geoAlbersUsa) fits a 960 × 620 view box, with Alaska and Hawaii as insets. Alaska is reduced to 0.35 of its relative scale. [D3 geoPath](https://d3js.org/d3-geo/path) produces the SVG path strings.

The source uses Census district code `DC-98`; the build maps it to the dashboard's `dc-house-00` delegate record. Census GeoJSON rings are reversed where needed to match D3's spherical winding convention. State and district IDs must match the public race directory before output is written.

## Rebuild

From the repository root, install build tools in a temporary directory rather than adding browser dependencies:

```sh
map_build="$(mktemp -d /tmp/election-map-build.XXXXXX)"
npm install --prefix "$map_build" --ignore-scripts --no-audit --no-fund d3-geo@3.1.1 topojson-client@3.1.0 us-atlas@3.0.1
curl --fail --silent --show-error --max-time 30 --dump-header "$map_build/districts.headers" --output "$map_build/districts.json" https://watch.vote/api/elections/2026/districts/national
node scripts/build-map-shapes.mjs "$map_build" "$map_build/districts.json" "$map_build/districts.headers"
```

The source hashes for this build are:

| Input | SHA-256 |
| --- | --- |
| us-atlas 3.0.1 `states-10m.json` | `d76b391ccfa8bff601d51e3e3da5d43a89fa46cd5caca72ce731b383be5596d0` |
| National district response | `3dd7a24a6ffa0197e51c623bc129e1508db6695b25d9f2b29cd38e25a3f1c988` |

The script records these hashes in the generated file. A later source response may change; review its vintage and geometry before replacing the committed asset. Identical inputs and the pinned tool versions produce identical output.

Build tools are `d3-geo` 3.1.1, `topojson-client` 3.1.0 and `us-atlas` 3.0.1, all ISC licensed. Their code is used only during generation and is not copied into the public bundle. Their license files remain in the temporary install; the redistributed us-atlas data notice also remains in the generated asset.

## Checks

The generator rejects missing or duplicate IDs, a district absent from the race directory, non-finite SVG coordinates, empty shapes, inverted whole-map polygons, and bounds outside the view box. This generated-data change uses structural and rendered inspection rather than a test that merely repeats the generator.
