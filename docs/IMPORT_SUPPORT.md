# Import support

| Format | Handling |
|---|---|
| Documented Maps URLs search/dir `api=1` | destination, origin, mode, Place ID, ordered waypoints |
| iOS `comgooglemaps://` / URL wrapper | local-only documented fields; never server-fetch custom scheme |
| Legacy saddr/daddr/dirflg | typed endpoint candidates and verified legacy mode mapping |
| maps.app.goo.gl / restricted goo.gl/maps | authenticated bounded resolver, each-hop exact host/path validation |
| Nonpublic place/dir paths | names only, INFERRED/UNKNOWN; enrichment and reconfirmation required |
| Viewport `@`, ll, center | never used as destination |
| Internal data/geocode/cid/ftid/skid | no private binary decoding; no itinerary reconstruction |
| Coordinate text | finite WGS84 lat/lng, explicit confirmation |
| Plain text | user input candidate, bounded enrichment, no autocomplete |
| Lists/multiple targets/nested redirects | explicit error or ambiguity; no first-number guessing |

120 importer unit cases currently cover normal formats, encoding, range/role boundaries, malformed input, structural URL attacks, origin defaults and fixed `selectedGoogleItineraryImported:false`. Resolver HTTP tests add redirects, HEAD/GET behavior, loops, timeouts and credential isolation.

Live public sample receipt: `PUBLIC_LINK_RESULTS.json`. Eleven of twelve publicly published samples expand into candidates; all eleven still require coordinate enrichment. The twelfth is a multi-place list and is rejected. **Confirmed-destination import success is not 11/12**; no coordinate-enrichment success has yet been measured. Creation device is unknown, so iPhone-origin sharing remains NOT RUN.

Two user-supplied private samples were actually expanded once. Both yielded a candidate without verified coordinates, so their full import state is BLOCKED_ENRICHMENT. Private identifiers, URLs, destinations and expanded responses are excluded from this document and public fixtures. The local receipt is retained under `.local/`.
