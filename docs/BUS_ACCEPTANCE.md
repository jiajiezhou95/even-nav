# Bus routing — 2026-10-22

## 0.1.28 — Minato Chiibus supplement

The reported private journey was not covered by the 0.1.27 public bus examples. This release supplements Transitous with the operator's official GTFS-JP for 赤坂ルート and 青山ルート, obtained from https://gtfs-jp.buskita.com/fxc/gtfs.zip and published at https://bus.fujikyu.co.jp/rosen/gtfs/. The retained feed contains 75 Akasaka and 226 Aoyama trips, valid through 2026-12-31. Data is refreshed at most daily within a warm Worker cache; expired feeds are rejected.

Fresh final deployed Worker `40c9faef-3685-438b-b9c9-4238670831f0`, using the reported private OD and 2026-10-23 09:00 JST departure: HTTP 200 in 3.8 seconds; both 赤坂ルート and 青山ルート plus one rail alternative returned. All three have valid chronological legs. Both buses contain official vehicle-path geometry, intermediate stops, named boarding/alighting stops and timetable times. Both access and egress use real Google WALK geometry/steps. Private responses remain ignored under `.local/chiibus/`; no private location data is included here.

Two failures were retained and repaired before final acceptance: Cloudflare rejects fetch redirect mode `error` (now uses `manual` and rejects redirect statuses), and valid Google single-point walking steps were incorrectly rejected (now accepted; positive-distance missing geometry remains rejected). Final query ran from the complete request boundary after both repairs. Temporary authenticated diagnosis endpoint was removed.

Cost counters for this delta: three Transitous queries, eight Google Routes Essentials walking reservations (including one isolated diagnostic), and 21 NAVITIME reservations for baseline rail enrichment. Final successful request used one Transitous, four Google walking and seven NAVITIME reservations. Counters are not invoices; no subscription upgrade. Other concurrent map usage is not attributed to these probes.

549 deterministic tests, TypeScript, formatting, package build and privacy scan (152 files) PASS. Focused mock HTTP/GPS browser flow PASS for two bus tabs plus rail, distinct map rendering, bus identity, departure/countdown and shared G2 route-overview content. Real G2, boarding/alighting inference and lockscreen on a bus were NOT RUN.

Scope is bounded direct Chiibus rides with walking at both ends, maximum two distinct bus lines and three combined choices. It does not construct bus-to-bus/rail transfers from GTFS or supply realtime bus delays. Actual walking duration plus a boarding buffer selects the reachable scheduled departure. Feed or walking failure preserves baseline routes. Each supplement has an eight-second maximum within the remaining 13-second request budget and at most four quota-checked walking calls. The already-existing transit navigation, missed-service refresh and automatic reroute consume the resulting standard route model.

The prior adapter explicitly requested only rail modes and rejected every other ride mode. BUS is now included alongside rail in query construction, itinerary validation, waiting and ride normalization. The optional BUS/RAIL discriminator is preserved into phone/G2 presentation; bus route numbers are not treated as opaque rail IDs. Train-only NAVITIME metadata does not run for bus stops.

The [official MOTIS API schema](https://raw.githubusercontent.com/motis-project/motis/refs/tags/v2.10.2/openapi.yaml) distinguishes BUS from long-distance COACH. This change enables local BUS only, not coaches, ferries or all possible transit modes. [Transitous sources](https://transitous.org/sources/) lists Toei Bus; coverage is not universal and only the provider's top three itineraries are shown.

## Fresh deployed verification

Worker version: `43dfeb50-4231-4a2b-b92e-9792505ba4ca`. Two sequential public-landmark requests for 2026-10-23 09:00 JST, no retries. These are explicit public test locations, not user fixtures.

| Public test | Actual returned itineraries | Result |
|---|---|---|
| Tokyo Station to Harumi waterfront | Two Toei 都05-1 bus itineraries; one JR Yamanote + 都03 bus itinerary | HTTP 200; bus-only and mixed rail/bus retained |
| Shibuya to Nishi-Azabu | Three Toei 都01(T01) bus itineraries | HTTP 200; bus retained |

All six itineraries have valid chronology. Bus lines, boarding/alighting stops, departure/arrival times and intermediate stops are present. No bus leg has invented station gateway metadata. Raw responses are retained locally under ignored `.local/bus-probe/`; no private fixture was used.

Usage: two Transitous itinerary requests, zero Google requests. Existing NAVITIME enrichment remains capped for rail legs; bus legs skip it. This probe did not meter exact NAVITIME upstream request count, so no exact count is claimed. No subscription or paid upgrade.

Provider availability and local/browser validation do not establish actual bus boarding inference, bus delay accuracy, G2 hardware display or lockscreen acceptance. These remain unverified for this delta.
