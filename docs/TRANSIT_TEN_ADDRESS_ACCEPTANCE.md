# Ten-address transit acceptance — 2026-10-21

10 fixed public Tokyo addresses: PASS for a readable line and selected gateways at both ends of every RIDE in the first canonical itinerary. Phone/G2 display replay: 10/10 PASS, including 43 itinerary text pages. This is provider-backed data and browser/native-bridge replay, not hardware or lockscreen acceptance. It does not guarantee all alternative itineraries or all Tokyo addresses.

| Address | Destination | Lines / gateways | Display replay |
|---|---|---|---|
| 東京都墨田区押上1丁目1番2号 | Tokyo Skytree | PASS | PASS |
| 東京都台東区雷門2丁目18番9号 | Asakusa Culture Tourist Information Center | PASS | PASS |
| 東京都港区六本木7丁目22番2号 | National Art Center | PASS | PASS |
| 東京都江東区三好4丁目1番1号 | Museum of Contemporary Art Tokyo | PASS | PASS |
| 東京都豊島区東池袋3丁目1番3号 | Sunshine Aquarium | PASS | PASS |
| 東京都台東区上野公園13番9号 | Tokyo National Museum | PASS | PASS |
| 東京都江東区青海2丁目3番6号 | Miraikan | PASS | PASS |
| 東京都新宿区西新宿2丁目8番1号 | Tokyo Metropolitan Government Building | PASS | PASS |
| 東京都江東区豊洲2丁目2番18号 | Toyosu Cultural Center | PASS | PASS |
| 東京都渋谷区代々木神園町1番1号 | Meiji Jingu | PASS | PASS |

## Evidence and repaired failures

- Initial deployed Worker run: only 03/05/07/09 passed. Each address had one Google geocode and one initial Transitous query. Original failures remain in ignored `.local/transit-ten/`.
- Cases 01/02/08/10 reused retained first itineraries and actual NAVITIME responses, acquiring missing responses after repair. Cases 04/06 had zero raw Transitous itineraries; increasing only the post-transit walk limit from 900 to 1800 seconds returned routes for the same addresses. Chronology validation still rejected a case 06 raw itinerary departing before the request. Acceptance uses the first valid canonical itinerary, not a metadata-complete alternative chosen from the app's results.
- Repairs cover through-running operator versus physical-line operator, reviewed bilingual/operator/station aliases, large-station coordinate differences, multiple common lines and near-equal gateway distances. Full ordered station lists and, where necessary, a unique exact headsign station resolve shared lines. Ambiguity remains unresolved; no numeric-ID lookup table or invented platform/gateway.
- Three-ride enrichment exceeded 15 requests. Ceiling is now 20, retaining six seconds, no automatic retry, monthly/rolling 450 and 45/minute limits. One case 04 attempt timed out; successful responses were reused and only missing responses acquired. This is not claimed as one uninterrupted live query.
- Gateway recommendation uses straight-line distance to adjacent walking endpoints. It does not verify opening hours, accessibility, indoor transfers or a walkable path through the entrance. Route geometry remains unchanged.
- Worker `45055675-62c6-48f2-9e07-21be96bc067e` deployed. Fresh deployed queries for fixed cases 04/08 both returned HTTP200, named lines and selected gateways. Other evidence is explicitly reused.
- Browser replay uses each accepted route unchanged, with synthetic basemap/native bridge. Phone overview/navigation and all G2 itinerary pages are checked; physical optics and actual GPS movement are not tested here.
- 481 unit tests and TypeScript PASS. Exact-head CI covers final build, full browser suite, replay and privacy. Frontend unchanged: private Beta 0.1.24 uses the backend fix without reinstalling or pairing again. No public release or paid upgrade.

Raw provider responses, coordinates, secrets and screenshots remain ignored. Only public test addresses and aggregate results are published. Per-case reports distinguish initial live calls, reused responses, display replay and fresh deployment checks.
