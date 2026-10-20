# Provider implementation and evidence

Checked 2026-10-20. All adapters are original code; upstream examples were not copied. Official documentation defines request schemas, not live acceptance.

| Provider | Implemented | Evidence / remaining gate |
|---|---|---|
| Google Routes v2 computeRoutes | WALK / DRIVE, ordered coordinate intermediates, steps, maneuver, per-step geometry, distance and duration; traffic opt-in | MOCK_HTTP PASS. LIVE_PROVIDER BLOCKED: personal Google Key absent |
| Google Map Tiles v1 | roadmap session, server-supported grayscale style, tile proxy, viewport copyright | MOCK_HTTP/security checks; LIVE_PROVIDER BLOCKED: key absent; G2 output NOT RUN |
| Places Details New / Geocoding v3 | coordinate-only requests skipped; minimum Details mask; bounded candidate list, Google provenance | MOCK_HTTP PASS. LIVE_PROVIDER BLOCKED |
| Transitous MOTIS 2 | official documentation currently links MOTIS v2.10.2 OpenAPI; stable `/api/v6/plan`; coordinate door-to-door query, detailed walking/transfers, rail modes, arbitrary legs, waits, stay-seated metadata | MOCK_HTTP PASS. User confirms contact completed. First authorized public Tokyo Station–Ueno request 2026-10-20T14:08:28.525Z failed/timeout at bounded 12s; 1 call, no retry. Tokyo/operator/current service acceptance FAIL/NOT RUN |
| Open basemap / ORS | not configured | BLOCKED; no public OSM tile server fallback, no claim of equivalent Google acceptance |

Transitous requests identify `EvenNav/0.1.0` and the published project contact URL. Deployment still requires `TRANSITOUS_CONTACT` and explicit `TRANSITOUS_ENABLED=true`. Access authorization is user-confirmed; it does not prove server availability, coverage or SLA. Reject cancelled services, calendar-loop extensions, missing positive-duration walking instructions, invalid chronology, and all-walk transit results. Missing rail distance is zero in normalized numeric distance (upstream only guarantees non-transit distance); do not present that as verified rail distance. Walking steps currently have unknown duration represented as 0; leg duration is preserved.

Auth precedes validation-sensitive provider calls and atomic quota reservation. No automatic retries: retry is an explicit new request and new reservation. Routes expire for navigation freshness after 5 minutes, transit after 1 minute; these are application freshness bounds, not a license to persist provider content. Responses use no-store. No history or provider payload logging.

## HTTP contract

All `/v1` endpoints require `Authorization: Bearer …`; token never goes into query URLs. POST uses JSON. Errors are `{error:{code,message,retryable,fallback}}`, sanitized and never contain upstream body/URL/key.

- `POST /v1/import/resolve {text}` → `ImportedIntent`.
- `POST /v1/destinations/resolve {candidate}` → `{candidates}`.
- `POST /v1/routes/road|transit ConfirmedTripRequest` → `{routes,requestVersion}`.
- `POST /v1/maps/google/session {}` → `{session,expiry,tileWidth,tileHeight,imageFormat}`. Client reuses until supplied expiry.
- `GET /v1/maps/google/tiles/{zoom}/{x}/{y}?session=…` → image.
- `GET /v1/maps/google/viewport?session=…&zoom=…&north=…&south=…&east=…&west=…` → `{copyright,maxZoomRects?}`. Render exact copyright with attribution.
- `GET /v1/providers`, `GET /v1/usage`, public `GET /health`.

Limits: POST 16 KiB, import 8 KiB in parser, redirect 5 hops/12 seconds total/4 seconds per request, no scripts/login/cookies, exact core URL allowlist on every hop, provider timeout 12 seconds, upstream JSON 4 MB, max 3 routes. Quota Durable Object uses storage transactions, UTC monthly buckets, 120 reservations/minute, conservative reservations retained on failure. Operator caps may only reduce defaults; Static 0 cannot increase. No eventual-consistency KV counters. Cloudflare deployment and actual Durable Object persistence acceptance remain distinct from mocked storage tests.

## Primary sources

- [Transitous usage and API](https://transitous.org/api/), [sources](https://transitous.org/sources/), [versioned OpenAPI](https://raw.githubusercontent.com/motis-project/motis/refs/tags/v2.10.2/openapi.yaml).
- [Google computeRoutes](https://developers.google.com/maps/documentation/routes/compute_route_directions), [Routes policies](https://developers.google.com/maps/documentation/routes/policies).
- [Tiles sessions](https://developers.google.com/maps/documentation/tile/session_tokens), [2D/viewport](https://developers.google.com/maps/documentation/tile/2d-tiles-overview), [Tiles policies](https://developers.google.com/maps/documentation/tile/policies).
- [Details](https://developers.google.com/maps/documentation/places/web-service/place-details), [Geocoding](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding).

Name-only enrichment uses [Text Search New](https://developers.google.com/maps/documentation/places/web-service/text-search), pageSize 5 and only id/displayName/formattedAddress/location (Text Search Pro). Explicit address fields use Geocoding; Place ID uses Details Essentials. No automatic autocomplete. /usage exposes reservedOperations (not actual HTTP count), per-SKU remaining and 80%/95%/hard-limit warnings. Redirect subrequests and provider bills are not mislabelled as measured HTTP traffic.

