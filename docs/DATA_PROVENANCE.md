# Data provenance and compatible displays

Every destination and intermediate retains its source, extraction method, evidence and coordinate role. Confirmation never changes source ownership. The Worker requires an ENDPOINT coordinate before routing, validates every intermediate, and fails incompatible combinations before quota reservation/network.

| Route / endpoint provenance | Google Tiles | Open map |
|---|---|---|
| Google Routes, any input | allowed display combination | rejected |
| Transitous + Google API enriched destination | conservative Google display branch | rejected |
| Transitous + Google shared-link destination | conservative Google display branch | rejected |
| Transitous + independent manual/open endpoint | allowed display combination | allowed policy combination; renderer/provider currently unconfigured |
| Explicit shared origin | conservative Google display branch | rejected until field-level origin provenance is available |

These checks implement direction-sensitive display rules. They are not an assertion that using Google tiles grants unrestricted reuse of Google Places/Geocoding data as third-party routing input. That specific use, minimal in-memory retention, terminal conversion and applicable billing-region terms must be checked independently. Google-source input remains Google-source after the user confirms it.

API enrichment always tags `GOOGLE_API_CONTENT`; known coordinates trigger no enrichment request. Places Details uses id, formattedAddress and location only. Ambiguous geocoding remains a candidate list requiring confirmation. No Google API results are cached in a public CDN or persisted in the quota store. Quota holds counts only.

[Routes policy](https://developers.google.com/maps/documentation/routes/policies) requires Google maps for mapped route results. [Map Tiles policy](https://developers.google.com/maps/documentation/tile/policies) governs third-party overlays and separate attribution. [Service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) and actual billing-region agreement control each service. No special approval is claimed.
