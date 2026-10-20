# Personal Google BYOK and Worker

No developer shared key is shipped. Use your own Google Cloud project and billing decision. Enable Routes API, Map Tiles API and only the optional Places API (New)/Geocoding API you intend to use. Restrict key to enabled services and apply compatible application restrictions; fixed source-IP restrictions need checking against Workers dynamic egress. Never put key into VITE variables, browser storage, Git, package or chat.

From repository root with the pinned Node environment:

```powershell
npx wrangler secret put GOOGLE_API_KEY --config apps/worker/wrangler.toml
npx wrangler secret put ACCESS_TOKEN --config apps/worker/wrangler.toml
```

Enter secrets only at the local CLI prompts. ACCESS_TOKEN must have at least 24 characters and should be cryptographically random. Rotate it with the same command to revoke old clients. The phone holds this limited Worker token in memory, not the Google key.

Set ALLOWED_ORIGINS to exact actual app origin(s), comma separated. CORS is additional to bearer auth. Deploy the Durable Object binding/migration together with Worker; missing quota storage fails closed. `MONTHLY_CAPS` may reduce default per-SKU caps, never raise them. Static is permanently disabled in this implementation. Configure Google Cloud API quotas/budget notifications as a second layer; notifications are not automatic billing stops. Counts reserve before request and retain failures conservatively; they are not a supplier invoice.

Transitous contact is user-confirmed complete. Set `TRANSITOUS_ENABLED=true` and `TRANSITOUS_CONTACT=https://github.com/jiajiezhou95/even-nav` after publishing the source. No routing call is made during build or default test. First authorized live probe timed out; full Tokyo acceptance remains open.

Build the Even manifest using the actual personal HTTPS Worker host and repackage after changing host. Do not open all domains. Verify `/health`, then authenticated `/v1/providers` and `/v1/usage`; missing credentials/config produce distinct statuses. No deployed status is claimed until real readback. Runtime GETs require token headers and must not put token/key into URLs.

[Google API security](https://developers.google.com/maps/api-security-best-practices), [Routes quota](https://developers.google.com/maps/documentation/routes/usage-and-billing), [Tiles session](https://developers.google.com/maps/documentation/tile/session_tokens), [Transitous policy](https://transitous.org/api/).
