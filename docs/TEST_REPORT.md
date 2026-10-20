# Verification checkpoint — 2026-10-20

This is implementation/checkpoint evidence, not clean final live or hardware acceptance.

| Evidence | Result | Actual scope |
|---|---|---|
| UNIT / MOCK_HTTP | PASS | 239 tests across seven files after persistent-device-pairing changes |
| TypeScript | PASS | strict noEmit check across apps/packages/scripts/tests |
| UI MOCK_HTTP | PASS | 12 Playwright scenarios; terminal exit0; includes reload restore, expiry/401, storage failure and forget/revoke |
| REPLAY | PASS | synthetic 11-fix walk reaches ARRIVED, zero external calls |
| LIVE_LINK_EXPANSION public | PASS expansion11/12; confirmed destination0/12 | Eleven candidates need enrichment; one multi-place list rejected. No iPhone-origin claim |
| LIVE_LINK_EXPANSION private | PASS expansion2/2; endpoint BLOCKED2/2 | Local-only receipt; no confirmed coordinates or private result publication |
| LIVE_PROVIDER Google | PASS public smoke | WALK/DRIVE, Geocoding, Places Text Search, tile session/tile/viewport passed after enabling missing APIs. Private destination confirmation and hardware rendering remain separate |
| LIVE_PROVIDER Transitous | PARTIAL | After 3 failed attempts, workerd reproduced unsupported redirect:error before network dispatch. Changed to manual and retained non-2xx rejection. One deployed repair probe returned HTTP200 and 3 Tokyo Station–Ueno itineraries (WAIT/WALK/RIDE/WALK); full coverage and multi-transfer acceptance remain pending |
| DEPLOYED Worker | PASS | Cloudflare deployment and authenticated health/capability check; atomic storage mocked, deployed persistence still needs acceptance |
| BUILD / PACKAGE | PASS | Official CLI0.2.0 +SDK0.0.16, `.ehpk` generated; latest SHA in artifacts/SHA256SUMS |
| SIMULATOR | NOT RUN | Browser UI is not Even simulator evidence |
| REAL_G2 | NOT RUN | Device display, attribution, native fix times and legibility not observed |
| LOCKSCREEN_CONTINUOUS | NOT RUN | WALK/DRIVE/TRANSIT each5/30/60min remain unobserved |
| RESUME | NOT RUN real device | Pause/resume deterministic/browser behavior only; host restart persistence not accepted |
| PRIVATE_BETA_INSTALL | USER-REPORTED 0.1.0 | Owner tester Active and user confirms installation; 0.1.1 persistence update under verification |

Commands: project-local Node22 invokes `tsc --noEmit`, `vitest run`, `playwright test`, `scripts/replay.ts`, `scripts/pack.ts`, `scripts/privacy-check.ts`. All live probes opt-in; routine CI uses no private fixtures or provider credentials.

Known limits: open map/ORS not configured; private data decoding intentionally unsupported; candidates from nonpublic links require Google enrichment and user confirmation. Google project configuration is complete and public smoke checks passed. No hardware criterion is inferred from official platform documentation.

Targeted repair checkpoint: providers/Worker 53 tests PASS (includes five new redirect rejection cases), TypeScript PASS, actual workerd + mocked outbound service PASS with one mock request and zero live requests. Deployed Worker version `d80822b2-8d18-46e3-b34e-d73dc36ebbd0`; real repair probe receipt is `TRANSIT_LIVE_RESULT.json`. Earlier full-suite/UI evidence is reused for unchanged areas; no new full-suite or hardware PASS is claimed.

Transit coverage checkpoint (REPAIR_RESUME, not final E2E):
- `TRANSIT_COVERAGE_RESULT.json`: 10 calls, 10/10 public OD with routes, 29 candidates; 0/1/2+ transfers; all checked chronological and positive-duration walk/transfer legs have steps and geometry. Departure 2026-10-21 09:00 JST. These checks do not prove real-world walking speed, accessibility, station access or successful boarding.
- `TRANSIT_IDENTITY_KEIO_JR_METRO.json` and `TRANSIT_IDENTITY_RESULT.json`: two targeted calls after line-name correction, confirming explicit agency fields for Metro/Toei/JR/private rail. Some source labels remain numeric.
- Relevant provider/Worker tests 56 PASS; TypeScript PASS. Deployed version `f9fb67ec-9e58-4a4f-8796-ef5a8e7fce9f`. The ten-case chronology/geometry results predate the name-only correction and are reused, not claimed as fresh runs.
- This checkpoint: 12 Transitous calls, 0 Google calls. Total recorded Transitous attempts to date: 16 (3 failed before transport repair, 1 successful repair probe, 12 here).
- Runner: local Node22 `--import tsx scripts/probe-transit-coverage.ts`; default is plan-only. `--execute` runs at most ten calls, serially, without retry; `--case=<exact public case name>` narrows to one. Auth/quota/provider/network failure stops the batch.

Private Beta delivery checkpoint (2026-10-20):
- Official CLI authenticated successfully; account initially had no apps.
- Created `io.github.jiajiezhou95.evennav` version `0.1.0` with original icon and description. Promoted only to Beta.
- Readback: app status `Private`, Beta `0.1.0`, public channel `null`; exactly one tester (owner), status `Invited`. No public review or publication.
- Official CLI downloaded the uploaded build into ignored local storage. SHA256 matches local artifact: `6e6aee97b0d4e7f8b066088175da983e4e9a8554ca701068bb8805b50470b9f7`.
- Upload/readback PASS is distinct from invitation acceptance, installation, REAL_G2 and LOCKSCREEN, which remain unverified.

Google setup and persistent-device-auth checkpoint:
- Existing Google key restricted from 32 APIs to Routes, Map Tiles, Places New and Geocoding. Routes was already enabled; the other three were enabled after SERVICE_DISABLED diagnostics. No billing upgrade or new payment authorization.
- `GOOGLE_INITIAL_RESULT.json` retains WALK/DRIVE success and the original Geocoding failure. `GOOGLE_MAP_LIVE_RESULT.json` retains the initial disabled Tiles failure. `GOOGLE_LIVE_RESULT.json` contains successful Geocoding/session/tile/viewport repair results; `GOOGLE_PLACES_LIVE_RESULT.json` confirms Text Search success.
- 11 Google HTTP requests in this setup: Routes2, Geocoding3 (two denied), Tiles session3 (two denied), tile1, viewport1, Text Search1. Nine went through the Worker, two direct diagnostics did not consume Worker counters. Billing is not inferred from reservation counts; this small usage is within published free caps assuming no other account usage, not an invoice measurement.
- `DEVICE_AUTH_LIVE_RESULT.json`: deployed pair200 → device capability access200 → revoke200 → revoked access401, no provider calls. Worker version `41dadd28-e58d-422a-a816-5903e9175a59`.
- Native persistence must still be observed after an actual iPhone app relaunch. SDK local storage is not claimed to provide hardware-backed credential encryption.

Beta 0.1.1 candidate: official package 69,866 bytes, SHA256 `41de70a0a6e09361be517a66e7336929f0d5f6eae502d01539138bdf50bec2bf`. Production storage waits for the native SDK bridge, including late injection; it never silently falls back to browser storage. Only the local Vite development preview uses browser persistence. Package upload/channel readback and exact-head CI are tracked by the official CLI and PR, separately from physical relaunch acceptance.
