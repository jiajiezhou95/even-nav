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
| LIVE_PROVIDER Transitous | FAIL | 1 local timeout +2 deployed Worker transport failures; stopped. No actual itinerary/coverage acceptance |
| DEPLOYED Worker | PASS | Cloudflare deployment and authenticated health/capability check; atomic storage mocked, deployed persistence still needs acceptance |
| BUILD / PACKAGE | PASS | Official CLI0.2.0 +SDK0.0.16, `.ehpk` generated; latest SHA in artifacts/SHA256SUMS |
| SIMULATOR | NOT RUN | Browser UI is not Even simulator evidence |
| REAL_G2 | NOT RUN | Device display, attribution, native fix times and legibility not observed |
| LOCKSCREEN_CONTINUOUS | NOT RUN | WALK/DRIVE/TRANSIT each5/30/60min remain unobserved |
| RESUME | NOT RUN real device | Pause/resume deterministic/browser behavior only; host restart persistence not accepted |
| PRIVATE_BETA_INSTALL | BLOCKED | Official CLI self-check says unauthenticated; package ready for local sign-in/upload |

Commands: project-local Node22 invokes `tsc --noEmit`, `vitest run`, `playwright test`, `scripts/replay.ts`, `scripts/pack.ts`, `scripts/privacy-check.ts`. All live probes opt-in; routine CI uses no private fixtures or provider credentials.

Known limits: open map/ORS not configured; private data decoding intentionally unsupported; current destination candidates from nonpublic links require Google enrichment. Google Cloud project `even-nav-512214` exists and was opened in Chrome, but API-enable/key actions have not completed because browser control failed. No hardware criterion is inferred from official platform documentation.
