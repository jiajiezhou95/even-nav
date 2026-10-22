# Bus routing — 2026-10-22

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
