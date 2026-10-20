# iPhone / G2 continuous navigation

Status: **NOT RUN**. The user reports Beta 0.1.0 installed and owner tester status is Active. Physical G2 display and locked-screen operation have not been observed. Browser UI tests and SDK submission results are not lockscreen or optical-display evidence.

## Implemented slice

- Official `@evenrealities/even_hub_sdk` 0.0.16 (minimum Even App 2.2.10), native `getAppLocation`, `startAppLocationUpdates`, `onAppLocationChanged`, `stopAppLocationUpdates`.
- One 288 × 144 map image plus native instruction, absolute GPS time and attribution containers on the 576 × 288 display. The official current image template specifies PNG/JPEG encoded input; the native host converts PNG to 4-bit grayscale. Physical host decode and legibility remain **NOT RUN**. This supersedes older generic reference wording suggesting raw grayscale pixels.
- GPS timestamps follow the official SDK reference's Unix milliseconds. Missing, out-of-range or future timestamps are not replaced by reception time. Browser Geolocation is a separately labelled development adapter.
- Navigation progress is shared with the phone through `NavigationSession`. Single in-flight image send plus one latest pending frame, invalidated on route version changes. Native submission metadata is retained only in session memory and does not prove optical appearance.
- The displayed basemap bitmap remains only while its exact viewport is active. Source tiles are decoded, composited, immediately closed and never cached; moving to a new viewport refetches its tiles (`cache: no-store`) and discards the previous base image. GPS overlay updates do not refetch the unchanged view or trigger routes. Expired sessions, absent copyright, missing backend or unavailable tiles are explicit failures.
- Pause stops location updates; end clears resources and requests immediate native exit. Returning to the page checks location and route age. Restart does not restore private routes; version 0.1.1 restores only device authorization through app-scoped SDK storage, separately from navigation continuity.
- No audio keepalive, fake call, screen-on substitute or browser-timer claim of lockscreen continuity.
- Stale-location warning replaces precise turn instructions at > 3 seconds for DRIVE and > 5 seconds for WALK/TRANSIT. These software thresholds are implemented; the real p95 age targets remain untested.
- Phone attribution uses Google's unmodified official logo; the G2 native text uses the current Tiles policy's limited-space “Google Maps” allowance, alongside viewport copyright and separately identified route sources. No claim of special Google approval is made.

## Required physical matrix

| Mode | 5 minutes | 30 minutes | 60 minutes |
| --- | --- | --- | --- |
| WALK | NOT RUN | NOT RUN | NOT RUN |
| DRIVE, passenger observation | NOT RUN | NOT RUN | NOT RUN |
| TRANSIT, walking / ride / transfers | NOT RUN | NOT RUN | NOT RUN |

Separate `RESUME` status: **NOT RUN**. Resuming after unlock must not count as continuous background operation.

Record locally under ignored `.local/evidence/`: iPhone model, iOS version, Even App version, G2 firmware, SDK version, build SHA/package hash, personal Beta group/install channel, location permission, network and low-power state. Do not publish private traces or location screenshots.

For each duration:

1. Configure the personal Worker and obtain a real provider route/map. Confirm correct destination and itinerary. Install the `.ehpk` through the personal Beta group.
2. Begin navigation with Even-native location. Verify one G2 frame simultaneously contains real surrounding roads, selected route, current reliable location, instruction, GPS time and complete required attribution. Photograph/check optical legibility locally.
3. Lock the iPhone. Move across a tile boundary and at least one turn; for transit include boarding/alighting/transfer confirmations and honest underground GPS degradation. DRIVE observation is passenger-operated.
4. During the locked interval observe actual G2 updates and record their times independently. Retained image, timer animation or only post-unlock updates do not pass.
5. Compare valid fix age and instruction age with observations. Initial targets are WALK outdoor fix age p95 ≤ 5 seconds and DRIVE key-state age ≤ 3 seconds. Preserve failures; do not relax thresholds to obtain PASS.
6. Unlock, check exactly one active location subscription, verify itinerary timing, then end. Confirm official Even functionality remains available.

Fault cases, each **NOT RUN**: switching apps, call interruption, offline recovery, Bluetooth disconnect/reconnect, host restart, low-power mode and memory pressure. Distinguish GPS loss from WebView freeze.

If the host suspends JavaScript, an old HUD may remain visible and even a stale-data warning may freeze. The absolute fix time is always included in submitted navigation frames; this is a diagnostic indicator, not a guarantee that a frozen host will draw a safe state.

## Sources and evidence limits

Installed official SDK README/types are the implementation authority for 0.0.16. Official current reference pages were also consulted:

- [SDK reference](https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/sdk-reference/SKILL.md)
- [Official image template](https://github.com/even-realities/evenhub-templates/tree/main/image)
- [Map Tiles attribution policy, updated 2026-10-16](https://developers.google.com/maps/documentation/tile/policies)
- [Beta testing](https://hub.evenrealities.com/docs/test/beta-testing)
- [Background lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle)

The Hub documentation URLs were inaccessible to the browsing tool in this session. Official GitHub reference content and installed package APIs were available. Reference documentation, source compilation and mocked UI tests do not satisfy `REAL_G2` or `LOCKSCREEN_CONTINUOUS`.
