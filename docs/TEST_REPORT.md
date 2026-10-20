# Verification checkpoint — 2026-10-20

This is implementation/checkpoint evidence, not clean final live or hardware acceptance.

| Evidence | Result | Actual scope |
|---|---|---|
| UNIT / MOCK_HTTP | PASS | 222 tests across six files: parser120, navigation/geometry34, providers/Worker48, UI SDK6, cost14 |
| TypeScript | PASS | strict noEmit check across apps/packages/scripts/tests |
| UI MOCK_HTTP | PASS | 6 Playwright scenarios; terminal exit0, 1.7min including Windows server teardown |
| REPLAY | PASS | synthetic 11-fix walk reaches ARRIVED, zero external calls |
| LIVE_LINK_EXPANSION public | PASS expansion11/12; confirmed destination0/12 | Eleven candidates need enrichment; one multi-place list rejected. No iPhone-origin claim |
| LIVE_LINK_EXPANSION private | PASS expansion2/2; endpoint BLOCKED2/2 | Local-only receipt; no confirmed coordinates or private result publication |
| LIVE_PROVIDER Google | BLOCKED | Key not configured; no Google billable requests issued |
| LIVE_PROVIDER Transitous | PARTIAL | After 3 failed attempts, workerd reproduced unsupported redirect:error before network dispatch. Changed to manual and retained non-2xx rejection. One deployed repair probe returned HTTP200 and 3 Tokyo Station–Ueno itineraries (WAIT/WALK/RIDE/WALK); full coverage and multi-transfer acceptance remain pending |
| DEPLOYED Worker | PASS | Cloudflare deployment and authenticated health/capability check; atomic storage mocked, deployed persistence still needs acceptance |
| BUILD / PACKAGE | PASS | Official CLI0.2.0 +SDK0.0.16, `.ehpk` generated; latest SHA in artifacts/SHA256SUMS |
| SIMULATOR | NOT RUN | Browser UI is not Even simulator evidence |
| REAL_G2 | NOT RUN | Device display, attribution, native fix times and legibility not observed |
| LOCKSCREEN_CONTINUOUS | NOT RUN | WALK/DRIVE/TRANSIT each5/30/60min remain unobserved |
| RESUME | NOT RUN real device | Pause/resume deterministic/browser behavior only; host restart persistence not accepted |
| PRIVATE_BETA_INSTALL | BLOCKED | Official CLI self-check says unauthenticated; package ready for local sign-in/upload |

Commands: project-local Node22 invokes `tsc --noEmit`, `vitest run`, `playwright test`, `scripts/replay.ts`, `scripts/pack.ts`, `scripts/privacy-check.ts`. All live probes opt-in; routine CI uses no private fixtures or provider credentials.

Known limits: open map/ORS not configured; private data decoding intentionally unsupported; current destination candidates from nonpublic links require Google enrichment. Google Cloud project `even-nav-512214` exists and was opened in Chrome, but API-enable/key actions have not completed because browser control failed. No hardware criterion is inferred from official platform documentation.

Targeted repair checkpoint: providers/Worker 53 tests PASS (includes five new redirect rejection cases), TypeScript PASS, actual workerd + mocked outbound service PASS with one mock request and zero live requests. Deployed Worker version `d80822b2-8d18-46e3-b34e-d73dc36ebbd0`; real repair probe receipt is `TRANSIT_LIVE_RESULT.json`. Earlier full-suite/UI evidence is reused for unchanged areas; no new full-suite or hardware PASS is claimed.

Transit coverage checkpoint (REPAIR_RESUME, not final E2E):
- `TRANSIT_COVERAGE_RESULT.json`: 10 calls, 10/10 public OD with routes, 29 candidates; 0/1/2+ transfers; all checked chronological and positive-duration walk/transfer legs have steps and geometry. Departure 2026-10-21 09:00 JST. These checks do not prove real-world walking speed, accessibility, station access or successful boarding.
- `TRANSIT_IDENTITY_KEIO_JR_METRO.json` and `TRANSIT_IDENTITY_RESULT.json`: two targeted calls after line-name correction, confirming explicit agency fields for Metro/Toei/JR/private rail. Some source labels remain numeric.
- Relevant provider/Worker tests 56 PASS; TypeScript PASS. Deployed version `f9fb67ec-9e58-4a4f-8796-ef5a8e7fce9f`. The ten-case chronology/geometry results predate the name-only correction and are reused, not claimed as fresh runs.
- This checkpoint: 12 Transitous calls, 0 Google calls. Total recorded Transitous attempts to date: 16 (3 failed before transport repair, 1 successful repair probe, 12 here).
- Runner: local Node22 `--import tsx scripts/probe-transit-coverage.ts`; default is plan-only. `--execute` runs at most ten calls, serially, without retry; `--case=<exact public case name>` narrows to one. Auth/quota/provider/network failure stops the batch.
