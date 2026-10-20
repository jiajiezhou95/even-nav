# Google → G2 verification

Status: technical adapter implemented; LIVE_PROVIDER BLOCKED on personal key; REAL_G2 NOT RUN. No Google approval is claimed.

| Item | Current evidence |
|---|---|
| Official raster tiles / session / attribution endpoint | implemented from current API docs |
| Grayscale | official roadmap session style `saturation:-100`; supported style request, not webpage screenshot |
| Routes on Google basemap only | deterministic guard PASS |
| Third-party Transitous overlay | separate source attribution required; Google map compatibility alone does not settle endpoint reuse rights |
| G2 4-bit conversion / pixel forwarding | technical path owned by display module; actual legibility, attribution and terms application NEEDS_CLARIFICATION/NOT RUN |
| Full viewport copyright on G2 | API provides exact string; real screen acceptance NOT RUN |
| Cache | Worker sends no-store, no CDN persistence; client may retain only permitted active view |
| Independent product / navigation use | app computes its own itinerary and state; actual applicable account agreement review remains required |

[Routes attribution](https://developers.google.com/maps/documentation/routes/policies) currently permits Google Maps text when space prevents the logo, with specific size/contrast constraints. [Tiles policy](https://developers.google.com/maps/documentation/tile/policies) separately requires logo/data attribution and preserving copyright; do not infer that Routes text exception automatically satisfies Tiles. G2 physical readability and full copyright must be tested. If required attribution cannot be satisfied, stop Google G2 output and label `SCHEME_A_GOOGLE_BLOCKED` instead of silently omitting it.

[Standard service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) depend on billing region. Required format conversion, transfer to G2 and Google-enriched endpoints used in third-party routing need a concrete use-path check; this document does not invent a blanket requirement for a special license or approval.
