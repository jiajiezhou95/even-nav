# Verification checkpoint — 2026-10-20

## Ten-address metadata repair (2026-10-21)

10/10 fixed public addresses have named lines and selected gateways for every ride in the first canonical itinerary; 10/10 phone/G2 browser replays and 43 overview pages PASS. Initial 4/10 failures retained and repaired. 481 unit tests and TypeScript PASS. Worker 45055675-62c6-48f2-9e07-21be96bc067e deployed; two fresh Worker queries PASS. Existing Beta 0.1.24 uses the backend repair. See [evidence and limitations](TRANSIT_TEN_ADDRESS_ACCEPTANCE.md). Hardware and exact-head CI are separate gates.

## Beta 0.1.24 — opaque line identity and next-train banner

- Fixed numeric/missing line enrichment using both stations' NAVITIME details, operator and unique shared line identity. No numeric-ID mapping is guessed. Original label/provenance retained. Missing/ambiguous identity remains unmatched.
- Phone/G2 banner includes line, headsign direction, departure and countdown; missing headsign uses explicit ride-to station rather than pretending it is the terminus. Numeric IDs are not shown as readable line names. Schedule-only rides explain absence of realtime delay data.
- LIVE public synthetic fallback used6NAVITIME requests: line resolved, gateways AVAILABLE at both ends; one nearest selection and one ambiguous candidate set. The initial local assertion expected two selections and exited nonzero; actual line/gateway integration succeeded, selection ambiguity was retained correctly. No repeat provider call for that assertion.
- LIVE deployed Worker query using station-level endpoints for the reported corridor: two of three alternatives had no numeric line names, AVAILABLE exits and two selected stops each; third remained NO_MATCH. All returned ride realtime flags were false. One Transitous query, up to15NAVITIME requests,0Google requests. Private itinerary/coordinates not published.
- Unit454/454 PASS; TypeScript PASS; two affected browser mock rollover/failure checks PASS. G2 composition screenshot inspected. Build/privacy139files PASS. Hardware behavior remains NOT RUN.
- Worker version0a06c1dd-1ef9-4cae-9b0f-ad2666138715. Package92825bytes,SHA25646fc836e19a9cfae0b8134830b0b20403804f0bb49d078c178b11d6b2db7f924. Official private Beta channel/readback and exact-head CI tracked separately.

## Beta 0.1.23 — departure countdown and nearest station access

- G2 attribution retained in full at 12px in a compact left column; 13px right column adds actual/plan-labelled departure countdown alongside remaining distance, current time and ETA. Local one-second ticking does not query providers. Long required attribution can still consume footer height.
- Missed-service refresh requires three reliable outside-station fixes spanning four seconds, fresh <=5s accuracy <=25m, outside120m+accuracy, no boarding/pause or previously observed station arrival. One attempt per service,60s cooldown, single flight; stale responses and failures preserve navigation. Same remaining lines/stations auto-resume a real future itinerary; changed patterns require selection.
- Gateway ranking uses matched NAVITIME coordinates against adjacent walking origin/destination, with local transfer anchors and no global-trip shortcut. Selected gateway is explicitly straight-line nearest, not a verified shortest/accessible walk; original path retained. Missing/ambiguous data remains unselected.
- Full unit suite443/443 PASS; TypeScript PASS; full browser mock suite36/36 PASS, including successful rollover and pending/HTTP503 no-retry. Synthetic replay11frames ARRIVED,0provider calls. No actual missed-train, G2 optical or lockscreen acceptance claimed.
- LIVE deployed Worker public itinerary probe PASS: two alternatives each exposed two selected station gateways; NAVITIME coverage AVAILABLE/PARTIAL retained. One Transitous query, at most15NAVITIME calls,0Google calls; no paid upgrade. Deployment db766bbf-d3dd-4061-85eb-95245969e694.
- Build/package privacy scan139files PASS. Artifact92487bytes,SHA2569f883ea89a72accaaccd9dbe8b4b26f46e1edede1ed11e3c9b6c2febd09289fa. Beta build117284; channel/readback recorded by official CLI. Screenshot evidence in ignored .local/evidence/transit-departure-g2.png and transit-departure-phone.png.

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

### Beta 0.1.5 follow-up boundary

User feedback on 0.1.4 requests visible, line-separated selected-route steps; persistent concise guidance with a separate stale-location badge; a separator before the next maneuver; larger graphical maneuver icons; and map direction. The UI-only correction preserves backend, routing and credential behavior. Provider live evidence remains reusable; no provider call is needed for this delta.

Direction capability review: installed SDK 0.0.16 exposes phone `AppLocation` and raw G2 IMU x/y/z. Official device-features documentation defines phone heading in degrees from true north, but does not document a north-calibrated G2 yaw or head-facing conversion. A map movement-bearing indicator must be explicitly distinguished from head-facing orientation and suppressed without sufficient fresh, accurate displacement. True head-facing orientation is not accepted or claimed.

Reference: https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/device-features/SKILL.md

Additional capability evidence: Even's official hardware article confirms a geomagnetic sensor in G2. This establishes hardware potential, not an exposed Even Hub heading API. Keep the limitation at the SDK/data-contract boundary; do not claim G2 lacks a compass. https://www.evenrealities.com/blogs/even-insider/how-we-shaped-even-g2-from-the-outside-in

Official Device APIs page also labels IMU generically as accelerometer/gyroscope and head orientation, but its payload table only names X/Y/Z-axis values without units, reference frame or measurement type. Therefore the payload cannot currently be asserted to be acceleration-only, nor treated as documented yaw. https://hub.evenrealities.com/docs/build/device-apis

### Beta 0.1.5 delivery checkpoint

- TARGETED_TEST PASS: guidance/device/direction 21/21. Browser UI first run 21/23; two affected assertions repaired, relevant rerun 3/3 PASS. These are synthetic browser/device-mock evidence, not a clean hardware E2E.
- STATIC/BUILD PASS: TypeScript, production build and privacy scan (111 files). Phone synthetic screenshots visually reviewed for expanded steps, large icon, separator and corner GPS status.
- DEPLOYED: private Beta 0.1.5 build 116688, 75,419 bytes. Downloaded cloud artifact matches SHA256 `d98aae386303c11320d37e3a477fb0c47a1a8c5fbb271243c2c7a202ce11d6ca`. Public channel remains unset.
- No Worker deployment or Google/Transitous calls. Existing provider evidence reused. G2 optical layout/movement, head-facing calibration and lock-screen acceptance remain unverified on hardware.

### Beta 0.1.6 requested delta

User explicitly requests retaining the last remaining-meter values while awaiting a fresh location, with a blinking corner dot and '更新定位中' that disappears on recovery. Preserve core stale-fix progress guards: displayed retained values do not imply a new measurement. Native requested location cadence remains 1000 ms with distanceFilter 0; freshness thresholds remain WALK/TRANSIT 5 s and DRIVE 3 s. This is unrelated to Google quota; location and distance updates are local, while new map views and route requests use provider services.

User also authorized a bounded G2 XYZ capture. Manual diagnostics use the public IMU API after startup-page creation, collect only XYZ/receive-time/action labels in memory, automatically stop after at most 60 seconds and allow local export. No GPS, private routes, authentication values or network upload. This is a measurement tool, not a compass or calibration implementation; actual hardware sampling remains a user-only gate.

### Beta 0.1.6 delivery checkpoint

- TARGETED_TEST PASS: guidance/device 18 tests, IMU helper 8 tests, affected browser UI 3 tests (retained stale distance/blink/recovery, normal guidance, local IMU phases/export/close-stop). Mock SDK/synthetic evidence only; real IMU data NOT RUN.
- STATIC/BUILD PASS: TypeScript, diff check, production build and privacy scan (113 files). Status-only G2 refresh deduplicates identical map/icon data; actual BLE blink cadence is hardware-dependent.
- DEPLOYED: private Beta 0.1.6 build 116702, 77,787 bytes; cloud download SHA256 matches `f63a88551ed8556ba29509b4dda42e2927df18e840554fe7a55a7c9d276ff5c5`. Public channel unset. No Worker deploy or Google/Transitous calls.
- Hardware next: end navigation; settings > sensor capture, phone fixed, select each action phase and hold/perform about 5 seconds; stop and export/copy local XYZ JSON. Optional phone-only rotation is a source-isolation control. No claim of calibrated heading or lockscreen acceptance.

### Beta 0.1.7 — manual sensor upload repair

- Replaces the Even WebView blob download with an authenticated, explicit upload to the personal Worker; stays in the app and shows a receipt. Retry preserves the in-memory sample. New samples cannot inherit stale success messages.
- Strict XYZ/phase/relative-time payload only, bounded to 6000 samples / 1 MiB. Latest report stored atomically in bounded Durable Object chunks; owner-only retrieval. No Google/Transitous calls.
- Targeted Worker tests: 43 PASS. TypeScript PASS. Browser mock upload checks cover success without navigation, failure/manual retry, duplicate requests and stale receipts. These do not establish iPhone acceptance.
- LIVE Worker synthetic upload/readback, CORS and unauthorized denial PASS; local owner retrieval saved to ignored `.local/imu/`. The two-point synthetic report is not a glasses sample.
- Worker deployment: `942af390-8a2c-4962-a4db-d16567bf85a0`.
- Private Beta build 116707, 78459 bytes; downloaded package SHA256 matches `c956d7f97d479fe878e8e1294efc2851320ddf8de8468d6048ec5aad63274492`. Build and privacy scan PASS. Exact-head CI is recorded on the existing Draft PR.
- User-only pending: update to 0.1.7, capture/stop then upload from Even App; retrieve actual report and analyze XYZ semantics. No claim of head yaw or lockscreen acceptance.
- New HUD arrangement request is design-only until the user selects a proposal; this package keeps the existing navigation layout.

### Beta 0.1.8 — layout B, magnified map, temple zoom and separate sampling reports

- Implements selected B layout: two cues across the top, 48 px icons / 21 px main text, 576×192 map below, smaller readable attribution and updating status. Four serialized 288×144 image quadrants compose the 576×288 display; unchanged quadrants are not resent. Full copyright wraps rather than truncates; map failures suppress turn arrows.
- User clarification applied: G2 uses Google scaleFactor2x/highDpi tiles, proportional projection and overlays. Default horizontal geographic span matches the former288px map, rather than exposing twice the area. The shorter aspect ratio crops vertical coverage proportionally. Phone route selection keeps its original session mode.
- Temple scroll events adjust only map zoom, bounded -2..2; ring events excluded, gestures deduplicated/coalesced, no route request. Physical forward/back direction and optical rendering remain user-only hardware checks.
- Manual sampling requires an explicit action label. Worker retains latest20 separate report IDs with bounded storage; legacy report migration preserves its original ID/data. Owner retrieval archives missing reports without overwriting local files.
- Targeted Worker, compositor/device/map and browser checks passed (exact-head full CI on Draft PR is authoritative). LIVE Worker synthetic history verified two separate uploads plus preservation/readback of the pre-existing actual report; zero route/provider calls in that history check.
- LIVE Google high-DPI map via actual NavigationMap: PASS,576×192 with attribution; public Tokyo input, one session + one viewport + two tile requests, no retries or route queries. Evidence is ignored `.local/hud-map-live-result.json`; private sensor data remains ignored.
- Actual user XYZ samples analyzed privately. Repeated nod/tilt patterns were clear, but neither compass semantics nor reliable horizontal head yaw was established. No unsupported head-heading control added.
- G2 optical legibility, real temple gestures and iPhone lockscreen navigation are not marked PASS by local/CI evidence.
- Private Beta0.1.8 uploaded/promoted as build116722,80322bytes; download SHA256 matches `2821fb7b74f318746b0ae26de68b2a8ca379f9752ed1aefcaafb97b3668ced70`. Worker deployment `3fa27e2f-9163-4acf-9e2d-38eccb8e3636`. Package build/privacy119files PASS. Actual production compositor screenshot reviewed locally; optical hardware acceptance pending.

### Beta 0.1.9 — display compatibility probe and Start placement

- User reports G2 connected before navigation but failure on start in0.1.8. Confirmed defect: all display exceptions were collapsed into a reconnect message. True native failure stage/root cause was not captured; four images and the original z-order layout are permitted by current official docs, so unsupported four-image claims are unproven.
- Minimal compatibility adjustment retains B: omit explicit zOrder; reduce blank event capture from full screen to20×20 in the header gap. No encoding, container-count, retry or timing changes. This adjustment requires hardware confirmation and is not claimed as a proven root-cause fix.
- PAGE startup result, RENDER exception category and IMAGE native result/block are now differentiated; logical connection remains independent. Successful subsequent display clears prior failure state. No private payload is exposed.
- Single Start button moved directly below the route map and above route1/2/3 tabs. 360px browser screenshot inspected; route3 still starts after selecting it.
- 16 targeted device tests,2 focused browser tests,TypeScript,build and privacy119files PASS. Real SDK serialization validation PASS. No new Google/Transitous requests; prior map-provider evidence reused.
- Private Beta build116728,80697bytes,download matches SHA256 `c7dd61feba7bc14b92b0cebde44e93bc7ccea548c66097a236fa4d260c8c2c64`. Exact-head CI on Draft PR. Hardware display repair remains WAITING_FOR_EXTERNAL_GATE.

### Beta 0.1.10 — bounded native-page recovery and button spacing

- Hardware0.1.9 remains FAIL at `PAGE:invalid(1)`. This is creation rejection, not a confirmed Bluetooth or image transfer fault.
- Official startup API is one-shot; the app preserves native page on pagehide. Only startupinvalid(1) now triggers one identical-layout rebuild. Oversize/outOfMemory do not rebuild; failed creation/rebuild latches until explicit reconnect/new start, preventing1Hz native retries. No encoding,geometry,timing or container-count change.
- Start spacing14px above/16px below;360px screenshot checked, selection/start behavior unchanged.
- 18 targeted device tests,focused spacing browser test,TypeScript,build/privacy119files PASS. Hardware restoration remains unverified; startupandimage-channel acceptance must be distinguished.
- Private Beta build116734,77579bytes;download SHA256 matches `b2bec1e8faac201f004ded340ecfb7aa34e384c3b47cf8aaa5fe537bb80893f9`. No Worker or provider change, no live Google calls. Exact-head CI on Draft PR.


### Beta 0.1.11 — restore proven display layout after B rejection

- User hardware 0.1.10 still FAIL: `PAGE:create-invalid(1)/rebuild-invalid`. Native connection remains present; rejection precedes PNG encoding/transmission. Public SDK constraints do not establish the underlying native incompatibility.
- Only after B startup invalid plus B rebuild rejection, try the exact 0.1.7 native layout once. If accepted, send native current/next instruction, status, full attribution, maneuver icon and an aspect-preserving map. Success reports compatibility layout explicitly; B large-map acceptance remains unresolved.
- Current 576x192 map is letterboxed to 288x144 (288x96 content), preserving its entire geographic view. No change to route queries, location, pairing, course or zoom behavior. All-layout rejection stays latched; exceptions and capacity errors do not create retry loops.
- 20 targeted device tests and TypeScript PASS. Actual browser canvas check verifies all edges, 24px letterboxing and rejection of malformed/wrong-size images. Package build/privacy119files PASS. Private Beta build116744,81611bytes; download SHA256 matches `60bde4cfeb95b609cfeaa0fbf608d27506431d056abd0fd4896a7286adb69e74`. Real G2 display and lockscreen navigation remain WAITING_FOR_EXTERNAL_GATE; final clean acceptance/CI waits for hardware outcome. No new Google/Transitous calls or Worker deployment.


### Beta 0.1.12 — distinguish SDK normalization from native page rejection

- Hardware 0.1.11 FAIL: B create, B rebuild and exact-baseline rebuild all fail; user force-closed/reopened Even App and reproduced failure. The last-working layout fallback has not restored display.
- Isolated installed-SDK 0.0.16 experiment shows startup maps undefined/null/booleans/object results to invalid(1); missing native handler resolves undefined. Rebuild preserves raw values except nullish-to-false. Prior descriptions of confirmed native rejection were too strong.
- This candidate adds sanitized per-attempt page diagnostics only, preserving original arguments/results and retry bounds. It records dispatch, raw primitive type/limited value, handler-callable state and app-ID presence/type, never IDs or page content. It does not claim to fix display.
- True native cause and hardware restoration remain WAITING_FOR_EXTERNAL_GATE. No Google/Transitous calls or Worker changes.
- 23 targeted device tests and TypeScript PASS; build/privacy119files PASS. Private Beta build117112,82143bytes; downloaded package SHA256 `755eadcab15db9c814cb9edf9807b92ca4100168df0c1aec28278f8aaddbbc18` matches. Hardware diagnosis remains pending; no display repair claim.


### Beta 0.1.13 — independently initialize the proven layout

- User 0.1.12 hardware trace: handler callable and app ID number; raw create n1 and both rebuild false. Missing handler/nullish normalization is not the observed failure.
- Prior compatibility test only rebuilt after a failed four-image startup; it did not establish whether the proven layout can initialize independently. Official required order puts successful startup before rebuild, while location does not depend on startup.
- Restore exact 0.1.7 layout as the FIRST startup payload, with only one identical-layout rebuild for invalid(1). No four-image attempt precedes it. Keep sanitized diagnostics and failure latch. This restores the last working layout rather than claiming B compatibility fixed.
- Navigation, location, pairing and providers remain unchanged. Native display restoration, B layout and lockscreen acceptance remain pending hardware evidence.
- 25 targeted device tests and TypeScript PASS; build/privacy119files PASS. Private Beta build117118,82149bytes; download SHA256 `c8b35ef24491f4140804a185f82dd01cede6df1a51c8786f0d05a3ae7784ea03` matches. Hardware restoration and final clean acceptance/CI remain pending.


### Beta 0.1.14 — retain proven startup and recover map size

- User confirms 0.1.13 G2 display SUCCESS with compatibility layout. This validates direct baseline startup; previous four-image-first initialization did not restore display. It does not establish the underlying four-image rejection cause. User reports map too small.
- Preserve baseline startup. Attempt B only after successful initialization, with one bounded baseline restoration if B rebuild is rejected. Never start with four-image payload or repeat upgrades on periodic frames.
- Compatibility map no longer shrinks the entire 576x192 source into a letterboxed288x96 area. Aspect-preserving cover crops the source center384x192 into288x144, making roads1.5x the prior letterboxed size and filling the old map container. The camera middle-half position range remains inside with margin; geographic coverage narrows horizontally and temple zoom remains available. Full attribution remains in native text.
- No provider request construction, Worker, phone layout, route guidance or pairing changes. B optical rendering remains a separate pending hardware criterion.
- 28 targeted device tests and TypeScript PASS. Actual browser adapter verifies cover crop, no black bars, uniform scaling, centered marker and36px position margins. Build/privacy119files PASS. Private Beta build117126,82273bytes; download SHA256 `cc427db7ff67216ef32c17f72237bd4d798b0606e10181feb0bd939a81d28313` matches. New B-switch optical acceptance remains pending.


### Beta 0.1.15 — short native container names for full B layout

- User 0.1.14 still shows compatibility layout; optical photograph confirms small left map, right guidance and bottom attribution. Full B is not accepted.
- Concrete protocol discrepancy: OpenEvenSdk PROTOCOL.md section9 records firmware rejecting names over14bytes; even-g2-go validates the same14byte limit. Current B bottom names are15/16ASCIIbytes, whereas successful baseline names are11bytes or fewer. OfficialSDK documentation's16-character allowance is insufficient for this measured firmware boundary.
- Only shorten shared B image container names; page creation/rebuild and image updates use the same names. Preserve IDs, four288x144quadrants,576x192 map, top cues/icons, attribution, event capture, menu and proven startup/fallback sequence. No hybrid or smaller-map substitute for B acceptance.
- References: https://github.com/Thepizzapie/OpenEvenSdk/blob/main/PROTOCOL.md ; https://github.com/Wang-Yu-Che/even-g2-go/blob/main/protocol/evenhub_native.go . Hardware B acceptance remains pending; no provider calls or Worker changes.
- 28 targeted device tests and TypeScript PASS; build/privacy119files PASS. Private Beta build117131,78986bytes; download SHA256 `b980daabc9137b02c1110b7bfc22085b89a3f63f91bff65ca38fe80f7710d50a` matches. Complete B optical acceptance and final CI remain pending; local/mock PASS is not hardware PASS.


### Beta 0.1.16 — navigation clock, adaptive cues and glasses menu

- User confirms full B map SUCCESS on0.1.15. Name-only transport fix is hardware-confirmed to restore B on this device; retain short container names and all page geometry. Lockscreen/continuous field acceptance remains separate.
- Requested delta: currenttime and estimatedarrival alongside remainingdistance; adaptive headerfont; doubletap glassesmenu with whole-route view, zoomin/out and explicit route reselection.
- Parallel implementation ownership: guidance/compositor vs device/menu/main. No provider or backend change; route queries remain explicit useractions. New interactions require hardware acceptance independently from prior B display success.
- Five-item menu includes Return to Navigation. Reselection executes one explicit query, shows up to3 route summaries on G2, synchronizes phone selection bidirectionally, and starts only on explicit single-tap confirmation. Double-tap cancellation leaves safe phone route selection rather than resuming the obsolete route. No native page recreation for menus.
- Targeted deterministic evidence:33 device tests +16 guidance/compositor tests PASS; TypeScript PASS. Focused Chromium flow with mocked SDK/HTTP PASS: overview/return, zoom without query, one reselect query, route2 synchronization,20 duplicate clicks start once, no extra page rebuild. Browser-rendered native image payloads for menu/choices and three timing/header cases visually checked. These are not G2 hardware or live provider results.
- Build and privacy120files PASS. Private Beta0.1.16 build117158,84853bytes; promotion and downloaded artifact SHA256 `c7ce631c7b424c0e93f7b96c890090dc24e7d247d9508506a8d517637312c525` match. No Worker change or paid provider call in this delta. New hardware controls/timing/optical acceptance, lockscreen observations and final exact-head release CI remain pending.

### Beta 0.1.17 — lightweight menu and single-click repair

- User hardware rejection of0.1.16: menu scrolling severely delayed; single-click selections do not execute. Prior mock pass does not establish hardware interaction acceptance. Preserve the user-confirmed0.1.15 B transport and0.1.16 timing/header features; repair only menu rendering/input.
- Scope: narrow overlay, retained background, fewer changed image tiles per selection; verify official SDK event decoding rather than only idealized callback objects. Reuse existing serialized queue and native page, no provider/backend changes.
- Additional authorized UI simplification: remove manual address/coordinate entry, destination map-picking dialog/handlers/projection and dead styles. Retain Google Maps link parsing (including URL coordinates), map route display and transit departure controls. Remove origin dropdown/shared-origin branch; route planning always uses current phone location. Seven targeted browser tests with mocked providers PASS, including raw-input rejection before provider calls and shared-origin ignored; TypeScript PASS. Core/backend remain unchanged.
- Confirmed local cause of menu traffic: every selection cleared all four image caches. Compact180x144 arrow menu now overlays h1, preserves background and only transmits the changed tile; navigation ticks retain the latest frame without repainting the open menu. Actual browser PNG measurement:1write/10494bytes vs4writes/27900bytes (62.4% fewer bytes). This is not a measured hardware latency claim.
- Official installed SDK decoding confirms omitted zero CLICK can yield undefined eventType. Bounded fallback recognizes only the known touch container or explicit glasses touch source; unknown/invalid/ring/IMU events do not become clicks. Hardware payload cause remains unconfirmed.38 targeted device tests PASS, including slow in-flight write and duplicate confirmations; five-menu-action browser flow PASS with actual SDK decoder and mocked native/provider boundaries. Together with paste-only lane:8 targeted browser tests PASS. TypeScript PASS.
- Build/privacy121files PASS. Private Beta0.1.17 build117172,81284bytes; promoted and downloaded SHA256 `89b60c4e13d47db56e38db776ed1c48a55a5c840d2db8ca0b61b23ec9476b3b5` matches. No Worker/provider call changes. Actual G2 menu responsiveness and click execution await user hardware observation; final release CI and lockscreen acceptance remain pending.

### Beta 0.1.18 — compact route choices and scrollable itinerary

- User hardware confirms0.1.17 menu scroll responsiveness acceptable. New requested delta: route reselection must also use the narrow overlay; whole-route view must expose all subsequent navigation steps with scrolling, not only the full map. Preserve validated B/page transport, lightweight menu and paste-only/current-origin behavior.
- Single UI owner handles the coupled device overlay/input/main integration; root reviews and packages. No separate parallel writer because renderer state and action semantics are tightly shared. Targeted browser/native-mock evidence remains distinct from actual G2 acceptance.
- Implemented h1 narrow route choice overlay with initial valid full-map background; switching candidates sends only one tile. Whole-route overview includes all previous/current/future steps, defaults to current, preserves step-less WAIT/RIDE/TRANSFER segments, and paginates measured long text without dropping characters. Scroll clamps at ends; double-tap exits to navigation. A cancelled selector cannot be reopened by a late map result.
-42 targeted unit tests PASS, TypeScript PASS and one focused Chromium/SDK-decoder workflow PASS (mocked provider/native boundary). Actual native PNG composition visually checked for long-step page and all3 candidates/map/attribution. One update per interaction:step page12570bytes;3-candidate switch11228bytes. These are browser transfer measurements, not hardware latency measurements. Root caught phone-sized candidate map rejection in first screenshot; final G2-sized initial background and nonblack-map assertion PASS.
- Build/privacy123files PASS. Private Beta0.1.18 build117182,85522bytes; promotion and downloaded SHA256 `bdee2682e422a0ebe0cfe737bea8c905400ef402c027943b7c478620e26a7fea` verified. No Worker or paid provider calls. New hardware route-list/step-view acceptance, final release CI and lockscreen acceptance remain pending.

### Beta 0.1.19 — deliberate double-click actions and full-page route browsing

- User installed0.1.18 and requests replacing accidental single-click actions: double opens navigation menu, menu actions and route confirmation require double, single does nothing. Return via explicit menu item rather than a dedicated return gesture.
- Overview requested as full-map first page followed by full-screen complete itinerary pages, not a narrow steps overlay. Candidate route changes must update the glasses map and selected phone route. Preserve normal B map, transport, paste-only/current-origin and provider/account boundaries.
- Coupled interaction/rendering implementation stays with one UI owner; root independently reviews state guards, PNG output and delivery. Hardware observation remains distinct from synthetic/native-mock tests.
- User additionally requests final menu item Exit Plugin. Implement explicit double confirmation, navigation/location cleanup and official SDK shutDownPageContainer(0), documented as immediate exit in installed SDK declarations. Keep host phone/G2 closure as hardware acceptance; do not equate mock success with actual host closure.
- Single-click handling no longer schedules actions. Double-click opens menu or confirms current menu/route choice; duplicate double events are suppressed. Return uses the explicit menu item. Six menu items remain a narrow180px overlay with20px text.
- Overview now starts with a real576x256 map plus attribution footer, without regular navigation header; scroll shows full576x288 text pages (22px), all content retained and ends explicitly labelled as list end. Normal B navigation stays576x192. Candidate selection redraws glasses and phone using selected-route/version checks; delayed old results cannot overwrite current route.
-39 targeted device/pagination tests PASS, TypeScript PASS, focused Chromium/native-SDK-mock flow PASS. Actual four-tile PNGs inspected:full map, text3/3, distinct candidate1/2 geometries, six-item exit menu. Tests verify ignored singles, duplicate doubles, overview menu priority/return, delayed stale candidate render, stopGPS before shutdown(0), pending image drain, native exitfalse/throw as failure. No hardware exit or timing claim.
- Build/privacy124files PASS. Private Beta0.1.19 build117200,86113bytes; promotion and downloaded SHA256 `6c14585c0e465ab9d700c40994750108fc1977e22713f16f43f03c1c4b131861` match. No live routing/map API call or Worker change. New hardware interactions/host exit, lockscreen acceptance and final release CI remain pending.

### Beta 0.1.20 — door-to-door rail navigation

- User accepted 0.1.19 walking behavior; requested one blank line between overview steps, included here with no separate hardware check.
- Core: explicit boarding/alighting/transfer/through-service confirmation; reject invalid or repeated actions; update remaining distance at transitions; provider preview TTL does not interrupt active journeys; missed trains still request replanning and cannot clear an earlier off-route request. Synthetic replays cover 0/1/2/4 transfers, stale GPS and final walking arrival (49 navigation tests PASS).
- Provider: WAIT only precedes boarding rail; positive-distance walking steps require geometry; total elapsed duration includes pre-walk gaps and interline dwell without shifting timetable. Provider + Worker targeted tests: 93 PASS.
- Worker deployed as cd17e660-697e-4c24-a16a-0b0b07233511. Fresh live evidence: docs/TRANSIT_BETA_0_1_20_RESULT.json, three public station-pair requests on 2026-10-21 for departure 2026-10-22 09:00 JST. Nine alternatives, 0/1/2/3/5 transfers; chronology, positive walking-step geometry, elapsed duration and WAIT adjacency all valid. No retries, zero Google calls. Some provider line names remain numeric; no invented line identity. Physical transfer feasibility and timetable completeness are not certified by this check.
- Real transit trip, underground operation and mode-specific lockscreen acceptance remain NOT RUN. Earlier ten-OD coverage is reused historical evidence, distinct from the three new requests.
- UI: explicit phase-specific confirmation is shared by phone and G2, contextual first menu item with a six-row scroll window retaining Exit Plugin, version/route/leg token checks reject old menu actions. Through service keeps the user aboard; line/direction/stops/platform appear only if supplied. The existing dot + 更新定位中 corner wording is preserved. No single-click actions added.
- Targeted UI unit tests 53/53 PASS; Chromium tests with mocked provider/native boundaries 4/4 PASS (0/1/2-transfer full journey and existing SDK walking-menu regression). Native PNGs visually inspected for onboard, boarding menu and transfer. These are synthetic display evidence, not hardware transit evidence. Review then found and is fixing asynchronous old-stage map results; final delta check follows below.
- Final race repair rejects results from an old version/phase/leg/boarding/pause/overview state, including late failure handlers. Targeted two-transfer browser replay deliberately holds the prior WALK map until WAIT and verifies no old-stage submission: PASS. Integrated TypeScript and build PASS; privacy scan125files PASS. Actual native image rechecked with correct waiting background.
- Private Beta0.1.20 build117218,87499bytes, promoted to Beta. Downloaded SHA256 `d9411c50a495b2ced16afaa8b63379e9d7622cb4350e4191dada6ef893f5458a` matches the local package. Installation of this update, actual transit and lockscreen observations remain pending. No public store publication or new tester invitation. Full final-release CI remains deferred until required hardware acceptance; this checkpoint is not a final G0–G4 completion claim.

### Beta 0.1.21 — automatic transit phases and leg-level overview

- Latest user instruction overrides manual-only transit: combine sustained accurate GPS, geometry-aligned movement, derived/reported speed and timetable plausibility; ask only for ambiguous cases, with deferral/cooldown. No hardware-calibrated accuracy claim; underground gaps must not become inferred progress.
- Phone route selection and phone/G2 route overview summarize walking and rail legs, not every walking turn. Actual station names, times, platforms and intermediate stops are retained; navigation still uses detailed walking instructions.
- Provider/Worker targeted gate99/99 PASS. Optional metadata malformed fields are omitted without rejecting usable routes. Source: MOTIS v2.10.2 OpenAPI https://raw.githubusercontent.com/motis-project/motis/refs/tags/v2.10.2/openapi.yaml (Place and Leg). No explicit entrance/exit field; no invented numbering. Even location speed is m/s, accuracy meters and timestamps Unixms per official SDK reference https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/sdk-reference/SKILL.md; installed SDK remains0.0.16.
- Worker version cb4f6fcb-a916-43a2-845b-b7a41a19e363 deployed. Fresh live gate:2 public OD requests,6 alternatives, no retries, zero Google calls; receipt docs/TRANSIT_BETA_0_1_21_RESULT.json. All rail legs supplied boarding/alighting coordinates; intermediate stops0–8 with names/times. This sample supplied no platforms. Timetable/geometry checks passed. Real inferred phases and physical transfer feasibility are not proven by provider responses.
- Core targeted69/69 PASS: real1Hz inference and complete walking/rail journeys with0/1/2/3 transfers, through-service, intermediate-stop safeguards, stale/poor/outlier/future GPS, duplicate events and pause resets. Root review corrected a12-sample window that would never satisfy12s evidence at1Hz; history now bounded to61samples/60s. Prompt text stays concise; deferral120s, at most2 prompts per stage/action. Thresholds remain hardware-uncalibrated and cannot disambiguate identical movement on an overlapping road.
- Station-data follow-up research (not implemented/newly purchased): Google Transit partner feeds do not imply public API access; official FAQ excludes Japan from Routes transit (https://developers.google.com/maps/faq#transit_directions). Candidate enrichment: operator GTFS platform_code/pathways/entrances, licensed ODPT datasets, OSM exit nodes only when linked to actual walking paths. NAVITIME has a specific gateway endpoint (https://api-sdk.navitime.co.jp/api/specs/api_guide/transport_node-gateway.html) but exit availability does not prove train-platform or realtime coverage. Proposed first gate is three-station data/permission/identity matching audit, not nationwide coverage or a procurement commitment.
- UI targeted55/55 PASS; final pagination delta2/2 PASS. Browser mock-provider/native flows5/5 PASS (automatic boarding/alighting, uncertainty+defer, existing manual0/1/2 transfers), then affected final overview/prompt2/2 PASS. Actual composed PNGs visually checked: phone map+segment overview, all12synthetic intermediate stops individually listed, full G2 last page, nonblocking uncertainty footer. Timetable WAIT departure uses waiting end, not waiting start; actual platform overrides explicitly labelled scheduled platform.
- Integrated TypeScript, build and privacy129files PASS. Private Beta0.1.21 build117241,90214bytes published; downloaded SHA256 `b88fba002302cbf900053384a101427fd6ecfd5b62b866a75e1ffdfd8d60c7a8` matches local package. No new paid data source, account registration or public-store publication. Real automatic phase accuracy and lockscreen acceptance remain pending; synthetic PASS is not hardware PASS.
# NAVITIME free Transport integration checkpoint (2026-10-21)

Implemented optional server-side exit candidate enrichment, exact station/line/operator identity matching, free-only endpoints, durable quota caps, and shared phone/G2 itinerary rendering. Existing platform and route geometry/times remain unchanged. Free Transport has no platform/timetable endpoint; that capability remains unavailable.

- Synthetic affected-subsystem tests: 122/122 PASS (providers, Worker, quota, G2 overview); subsequently added Worker wiring test 1/1 PASS (missing key, authenticated free endpoint, denied-provider fallback, no key disclosure).
- TypeScript and touched formatting PASS. Live probe dry-run prints bounded plan without network requests.
- NAVITIME live calls: 0. Account and key not yet created, confirmed by owner. Live identity coverage/exit data NOT RUN; real G2 candidate display NOT RUN.
- No new Worker deployment or private Beta publication at this checkpoint. Published 0.1.21 remains active. Complete live verification after local key insertion, then build/package and deliver the next Beta.

## NAVITIME activation and private Beta 0.1.22 — 2026-10-21

- Basic subscription confirmed in owner Chrome ($0/month,500 requests hard limit,no payment method); key saved in ignored local configuration and Worker Secrets. Three direct public NAVITIME probes returned HTTP200: station search,line search,and gateways. No credentials printed.
- Initial integrated probe PARTIAL: numeric IDs and bilingual route names prevented enrichment. Narrow repair skips numeric IDs, normalizes Japanese-leading bilingual labels, maps the verified Tokyo Metro operator alias, and treats valid empty searches as NO_MATCH.
- Fresh repaired deployed public OD probe PASS for exit enrichment:3 alternatives,2 enriched station endpoints each; one route AVAILABLE,two PARTIAL. This is not universal station/line coverage. Platforms remain unsupported by free NAVITIME Transport. Worker d7827921-f7dc-4046-ba0f-6f3c24ba50f6.
- Task usage:9 NAVITIME HTTP requests (6 durable-counted Worker +3 direct probes),3 Transitous requests,0 Google requests. No retries of unchanged failed path. Free-plan allowance used; no paid subscription or upgrade.
- Full deterministic unit suite419/419 PASS; TypeScript PASS; build/package PASS; privacy scan135 files PASS. Real G2 display and lockscreen NOT RUN for this delta.
- Private Beta0.1.22 build117269 uploaded/promoted; downloaded artifact SHA256 matches e8bb717f5c3fe6bcc21b6760264ddec9c4f41cd3530a3eed2cb9b951160b6659,90632 bytes. Public store not published.
