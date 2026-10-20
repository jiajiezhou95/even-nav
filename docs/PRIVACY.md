# Privacy

Even Nav has no account system, advertising, analytics or default trip history. Share text, endpoint candidates, route data, map viewport and Worker token are held in the active session. The token grants backend access: JavaScript memory is not a hardware credential vault.

When required, the personal Worker sends a share URL to the allowlisted Google Maps host, an endpoint query to Google Places/Geocoding, endpoints to Google Routes or Transitous, and map viewport/tile coordinates to Google. Position is therefore not exclusively on-device. It is not continuously uploaded as a GPS track.

Worker logs must not contain raw URLs, locations, IDs, tokens, keys or upstream response bodies. Sanitized diagnostics include error category, upstream HTTP status or bounded schema paths. Atomic usage storage contains monthly SKU counts, not itineraries.

Private regression inputs, reports and device observations remain under ignored `.local/`. Public fixtures are synthetic or publicly published links with source attribution. No private destinations or trajectories belong in CI artifacts. Ending a trip stops subscriptions and discards active imagery. Clearing/reloading the app clears in-memory credentials.

You control your Google/Cloudflare account and can revoke the Worker token or delete the Worker. The application is for personal Beta evaluation; hardware behavior is still being verified.
