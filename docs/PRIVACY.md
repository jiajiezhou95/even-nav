# Privacy

Even Nav has no advertising, analytics or default trip history. Share text, endpoint candidates, route data and map viewport are held in the active session. On first pairing, the owner credential is used transiently to obtain an independent device token; the owner credential and Google key are never persisted in the frontend.

Version 0.1.1 persists the device token, Worker origin and expiry in the official Even SDK's app-scoped local storage. Browser development preview uses origin-scoped browser storage. This is not a claim of Keychain or hardware-backed encryption. The token grants backend access; a compromised app context could read it. Server storage contains only its SHA256 hash, owner binding and expiry. Tokens expire after 365 days, and at most eight devices can be active.

When required, the personal Worker sends a share URL to the allowlisted Google Maps host, an endpoint query to Google Places/Geocoding, endpoints to Google Routes or Transitous, and map viewport/tile coordinates to Google. Position is therefore not exclusively on-device. It is not continuously uploaded as a GPS track.

Worker logs must not contain raw URLs, locations, IDs, tokens, keys or upstream response bodies. Sanitized diagnostics include error category, upstream HTTP status or bounded schema paths. Atomic storage contains monthly SKU counts and hashed device authorization records, not itineraries.

Private regression inputs, reports and device observations remain under ignored `.local/`. Public fixtures are synthetic or publicly published links with source attribution. No private destinations or trajectories belong in CI artifacts. Ending a trip stops subscriptions and discards active imagery. Reloading restores device authorization; use the explicit forget/disconnect action to remove it. Offline local removal cannot prove server revocation; rotate the owner token to invalidate all paired devices.

You control your Google/Cloudflare account and can revoke the Worker token or delete the Worker. The application is for personal Beta evaluation; hardware behavior is still being verified.
