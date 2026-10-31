# Paris transit routes and entrances

## Entrances

Source: [OpenStreetMap](https://www.openstreetmap.org/copyright), queried through Overpass. Source snapshot: 2026-10-31.

`entrances.geojson` contains one feature per OSM node tagged `railway=subway_entrance` or `railway=train_station_entrance` for the supported networks in Île-de-France. Each feature retains its OSM node ID, original longitude/latitude, and a link to the source node. Coordinates are never averaged or replaced with station centers.

OSM `public_transport=stop_area` membership and transit route relations supply station names, line names, and network associations. Unassociated subway entrances fall back to the Métro network. Unassociated train entrances and entrances associated only with other train networks are excluded. Surface tram stops without mapped entrances do not receive fabricated entrance dots.

`stationId` identifies the station used for display grouping. Stop areas that share an actual entrance are linked into a single station complex. Unassociated entrances have their own IDs and remain separate. The UI groups close entrances only within the same station, using small dots without counts. Different stations never share a display group. Zooming in separates the entrances; clicking a group at maximum zoom spreads overlapping entrances apart.

Refresh with `node scripts/update-entrances.mjs`. The Overpass query is in `scripts/transit-entrances.overpass`. An existing Overpass JSON response can be processed with `node scripts/update-entrances.mjs --from path/to/response.json`.

## Routes

Source: [Île-de-France Mobilités GTFS route shapes](https://data.iledefrance-mobilites.fr/explore/dataset/traces-des-lignes-de-transport-en-commun-idfm/). Retrieved 2026-10-31.

`metro.geojson`, `rer.geojson`, and `tram.geojson` contain only route geometry and official colors: Métro, RER A–E, and T-prefixed tramways. They contain no station-center points.

Refresh with `node scripts/update-transit-data.mjs`.

## Routes and stations under construction

Sources: [Île-de-France Mobilités transport projects](https://data.iledefrance-mobilites.fr/explore/dataset/projets_lignes_idf/) and [project station locations](https://data.iledefrance-mobilites.fr/explore/dataset/projets_arrets_idf/). Retrieved 2026-10-31.

`metro-construction.geojson`, `rer-construction.geojson`, and `tram-construction.geojson` contain project segments whose source status is `Travaux`, limited to new lines and extensions (`creation = 1` or `prolong = 1`). Earlier study phases and projects marked as in service are excluded. The source snapshot includes Métro 15, 16, 17, and 18, the western extension of RER E, and tramway extensions. Status is taken from the project dataset and may lag actual commissioning.

Line geometry and colors come from the route dataset. Each route feature retains its operation name and source link. Multiple segments can share a source project ID and are preserved. The app renders construction routes with dashes alongside operating routes, controlled together by the existing network checkboxes.

Route tooltips show the expected opening from the published `mes_off_tx` field,
preserving its precision (for example, a year or "fin 2028"). Missing or unknown
dates show "Not announced". Dates are specific to each route section and remain
provisional; internal estimated dates are not converted into exact opening days.

Point features come from the project station dataset and are matched to construction routes by project ID and operation ID within the same network. Original station coordinates are preserved. Duplicate records at the same named station and exact coordinates are combined, retaining their line names. These dots represent project station locations, not surveyed street entrances. They are displayed above route lines with station names and construction status on hover/click. OSM entrance markers for operating stations are unchanged.

Refresh with `node scripts/update-construction-data.mjs`.

## Walking streets

`walking/index.json` and the GeoJSON chunks under `walking/{metro,rer,tram}/`
contain street/path segments reached within 5 and 10 minutes at 4.8 km/h, from
operating station access points and construction station estimates. Geometry and
connectivity come from the Geofabrik Île-de-France OSM PBF, processed by
`scripts/compute-walking-streets.py`. Green segments represent 0–5 minutes; blue
segments represent 5–10 minutes. Colors follow the shortest walk from any station
in the selected networks. These files contain lines only, with no coverage polygons.

See [the walking generator documentation](../../scripts/WALKING.md) for setup,
refresh commands, inputs, routing assumptions, and limitations. The generated
manifest records access points that could not be connected to a public path.

## Licenses

Entrance and operating-route sources are licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Construction projects are licensed under the [Etalab Open Licence](https://www.etalab.gouv.fr/licence-ouverte-open-licence/). Attribution is displayed on the map. Snapshots are served locally, so loading overlays does not require a live external API call.
