# Costs

Pricing checked 2026-10-20 against [Google's global table](https://developers.google.com/maps/billing-and-pricing/pricing). `npm run cost:estimate` gives the plan's 100-trip scenario (30,000 tiles, 160 basic routes, 20 Details, 20 Geocoding, 10 Text Search); estimated Google charge $0 **only with no other account usage**. This is a scenario, not a bill or a promise of free use.

`scripts/costs.ts` applies all volume tiers and subtracts existing account usage. Static Maps regression: 0/6,000/18,000/36,000/180,000 requests → $0/$0/$16/$52/$308. Static Maps, Autocomplete and Dynamic Maps are not enabled. Tile 30k/150k/300k scenarios → $0/$30/$120.

Worker reserves endpoint units atomically before each external request. HTTP attempts, local drawings, estimated billable units and final provider invoices differ. A retry may incur another reservation. The personal caps do not cover other applications in the same billing account. Budget notifications alone do not enforce a cap.

Cloudflare Worker requests/CPU and SQLite Durable Object operations/storage are separate under the [actual account plan](https://developers.cloudflare.com/workers/platform/pricing/). No plan upgrade is authorized. Transitous has access conditions and no SLA. No MapTiler or ORS account is enabled by default.

The Google setup smoke used 11 HTTP attempts: two Routes, three Geocoding (two denied before activation), three tile-session (two denied before activation), one tile, one viewport and one Text Search. This is request accounting, not a billing invoice. Device pairing/access/revocation checks made no Google or Transitous requests. With device authentication, each authenticated Worker request also reads the durable device record; pairing and revocation write that record. These operations are separate from provider usage.
