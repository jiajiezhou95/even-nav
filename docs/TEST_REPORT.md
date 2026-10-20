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

Native connection repair (2026-10-21, REPAIR_RESUME):
- User installed Beta 0.1.1; screenshots show G2 connected but Worker connection failed. G2 connection alone is not display or navigation acceptance.
- A live phone preflight reached the Worker from `http://127.0.0.1:63639` and returned 401. The fixed development-port allowlist excluded the native app's dynamic port.
- Added explicit `EVEN_APP_LOOPBACK` opt-in for the exact HTTP IPv4 loopback host with a valid port. No wildcard CORS, cookie credentials, bearer-auth bypass, or provider changes.
- Targeted Worker suite: 38 tests PASS, including port changes, opt-out, missing authentication and malformed/foreign origins.
- Deployed Worker version `e4f3b1ad-76b2-44b8-ac7e-8fb7abf1c85f`. Live repair probe: matching preflight204; no credential401; foreign origin401; pair200; device capabilities200; revoke200; revoked device401. Zero Google/Transitous calls. This is a computer-originated probe using the observed native Origin, not proof of phone success.
- Existing Beta 0.1.1 package remains compatible and unchanged. Phone retry, native relaunch persistence, G2 same-frame display and lockscreen navigation remain pending.

Subsequent phone observations and language repair (2026-10-21):
- User confirmed backend connected after CORS repair, then confirmed automatic backend connection after force-closing and reopening Even App without entering credentials. This establishes that observed native credential-restoration case, not navigation continuity.
- User screenshots show phone route/map rendering and an expired fix. They do not establish G2 optical display. User also reports inability to scroll down on the phone.
- Google route requests now specify `zh-CN`; map labels and local place names retain their local language. `GOOGLE_LANGUAGE_LIVE_RESULT.json` records one public WALK call returning Chinese actions with Japanese road names, HTTP200; no private coordinates or destinations were used. DRIVE shares the tested request construction but was not called again.
- Transit walking action enums are rendered in Chinese while road names and maneuver identifiers are retained. Unknown actions use a neutral Chinese fallback. Provider tests: 40 PASS. This text-only conversion reuses existing live Transitous evidence; no new Transitous call.

Beta 0.1.2 targeted repair:
- Phone UI now owns its viewport scroll container, including when the host disables document scrolling. Navigation ticks update telemetry in place instead of replacing the itinerary and interrupting touch/scroll.
- Native location requests use zero distance filtering. This removes a possible stationary-update filter; it does not guarantee host cadence. Actual native measurement timestamps and stale thresholds are unchanged.
- Page return restores one location subscription and health timer after pagehide. Pause/end remain respected; failed restoration visibly pauses and supports explicit resume.
- Browser/mock acceptance: four targeted Playwright regressions PASS (touch scrolling, stable navigation nodes/scroll, page return, failed return then resume); device adapter seven tests PASS; integrated TypeScript PASS. No real iPhone scroll/fix or lockscreen PASS inferred.
- Official private Beta 0.1.2 uploaded/promoted; public channel remains null. Downloaded package matches local SHA256 `a27ce0b7108ce4ac780491cc59ceaa0030a0d4a03735e13e0e60dab65a0589a2`, 70,446 bytes. Build/privacy scan PASS.
- Worker final deployment `4238fc94-d961-42c4-bb43-dd190fd46343`. This checkpoint used one Google Routes call and zero Transitous calls; no billing invoice measurement.

Beta 0.1.3 navigation repair (2026-10-21):
- User confirms 0.1.2 mobile scrolling works. User reports repeated destination confirmation, excessive explanatory copy, weak G2 map contrast and unclear turn progression. Follow-up confirms phone fix timestamps advance; a completely stalled native location stream is not established.
- Confirmed deterministic defect: road-leg overview geometry and detailed step lengths differed, delaying step advancement. Road legs now use connected detailed step geometry with adjacent duplicate boundaries removed. Current-step remaining distance uses the same geometric measure; stale/paused fixes do not advance it.
- First deployed public-route probe failed because Google returned a valid 10m control step represented by one point. Retained public-response replay identified and repaired that compatibility case without repeated paid debugging. Singleton geometry contributes zero geometric length while reported distance metadata is preserved.
- `GOOGLE_STEP_GEOMETRY_INITIAL_RESULT.json` retains the failed probe; `GOOGLE_STEP_GEOMETRY_LIVE_RESULT.json` records the successful repaired probe: HTTP200, three routes, 13/15/12 steps, canonical geometry verified. Worker version `708084de-e5c3-4561-827f-2a096b73e954`.
- This repair used three Google Routes HTTP requests: failed Worker probe, direct public-response capture, repaired Worker probe. No private inputs, no Transitous calls. Hardware step progression is not inferred from those calls.
- Core/provider targeted tests: 80 PASS. G2 adapter tests: 8 PASS, including full text replacement when the next instruction is shorter and sequential distinct map-frame submission. Native optical replacement still requires observation.
- Import enrichment now completes before destination confirmation; ambiguous candidates require explicit selection. Route selection fits up to three actual route geometries on a selectable map with concise cards beneath. Ordinary implementation/Beta prose removed; attribution remains.
- G2 output transforms actual tiles to a dark high-contrast grayscale image and redraws distinct route/current-position overlays. No roads are invented from edge detection. Synthetic pixel/visual checks do not establish optical readability.
- UI/mock tests: 21 PASS, followed by three final delta checks PASS for step distance/staleness, contrast and resume. Integrated TypeScript, build and privacy scan PASS. Native map clarity, movement and step transitions remain user-only observation.
- Private Beta 0.1.3 upload/channel/readback PASS; public channel null. Downloaded package hash matches local artifact: `aec0753f5a96c4b519bab943151c5434f07f83d62c05cfcde153d89fd142c531`, 71,589 bytes.

0.1.3 user acceptance and 0.1.4 correction:
- User confirms G2 map contrast improved, but rejects route-selection layout and compound instruction prose. Prior tests did not establish acceptance of those product behaviors.
- User's latest requested layout is one prominent map with up to three horizontal route tabs and a concise selected-route summary, replacing vertically stacked alternatives. On successful planning, the map must enter the viewport; tab changes must preserve scroll.
- Active guidance must use structured maneuvers and accepted position-based distance, with a concise arrow/action rather than provider prose. Compound Google instructions remain optional phone detail; they are not split into invented geographic steps.
- Backend/provider request construction is unchanged in this correction; existing successful live route evidence is reused, not claimed as a new live run.

### Beta 0.1.4 delivered (2026-10-21 JST)

- PASS: 8 guidance unit tests and 23 browser UI tests, including accepted-position distance updates, next-step boundary changes, horizontal tabs, selected-route map rendering, tile reuse, map failure/retry, mobile scrolling and credential persistence. These are deterministic/synthetic checks, not G2 hardware acceptance.
- PASS: TypeScript check, production build, package privacy scan (108 files), and package upload/download hash comparison.
- Private Beta 0.1.4, build 116672, 73,295 bytes, SHA256 `2821a967619c483835e25cf65bfade354e8d2d95fc128315c2e64e8a73dcd77d`; public channel remains unset.
- No Worker deployment or live provider calls for this UI-only delta. Existing provider evidence is reused.
- Pending user hardware observation: selected map with horizontal tabs, concise G2 arrows/distance during movement and step transitions. Lock-screen acceptance remains NOT RUN.
