# NAVITIME Transport: personal free-tier integration

The owner confirmed personal-use authorization on 2026-10-21. This does not change which endpoints a subscription enables. No paid subscription or upgrade is authorized.

Use [NAVITIME Transport Basic](https://rapidapi.com/navitimejapan-navitimejapan/api/navitime-transport). Published allowance: 500 requests per billing month (hard limit), 50 requests per minute. Other NAVITIME service groups are separate subscriptions.

Owner's Basic subscription was confirmed through Chrome on 2026-10-21: $0/month, no payment method required. The checkout also lists a separate RapidAPI bandwidth allowance of 10,240 MB/month and $0.001/MB beyond it. Other applications sharing the account/subscription are outside Even Nav's counters. The key has been saved only in ignored local configuration and Worker Secrets; a real station-search request returned HTTP 200.

Insert the key only into `navitimeRapidApiKey` in ignored `.local/config.json`. Never send it in chat, frontend configuration, source control, or an `.ehpk`. Configure only this Worker secret:

```powershell
& .\node_modules\node\bin\node.exe --import tsx scripts/configure-secrets.ts --only-navitime
```

This does not subscribe to a plan. The backend uses `NAVITIME_RAPIDAPI_KEY`. Confirm the actual subscription is free Basic before activation. Local quotas do not cover other apps using the same subscription; calendar-month accounting differs from a subscription billing cycle.

## Capabilities

- Free Transport exposes `/transport_link` and `/transport_node/gateway` at `https://navitime-transport.p.rapidapi.com` with RapidAPI authentication headers.
- Gateways are candidate entrances/exits, not a selected pedestrian path. They do not establish opening hours, accessibility, or connection feasibility. Navigation must not prescribe an unverified gateway.
- Direction-dependent carriage advice is omitted without verified train direction.
- Platform numbers remain those supplied by the route provider. NAVITIME's `/transport_diagram/segment` has optional `platform.name`, but is not offered by free Transport. It is not called; missing platforms are not invented.
- Missing credentials, ambiguous identities, missing data, quota limits, and upstream failures preserve the Transitous itinerary. GPS updates do not trigger these queries.
- Provider responses are transient; only quota counts persist. No raw provider responses in public fixtures or logs.

## References and acceptance

[Pricing](https://api-sdk.navitime.co.jp/api/market/), [line identities](https://api-sdk.navitime.co.jp/api/specs/api_guide/transport_link.html), [gateways](https://api-sdk.navitime.co.jp/api/specs/api_guide/transport_node-gateway.html), [platform API availability](https://api-sdk.navitime.co.jp/api/specs/api_guide/transport_diagram-segment.html).

Synthetic tests do not establish live subscription access, station coverage, or G2 behavior. See the current test report for verified status.
