# Requirement and evidence matrix

## Current checkpoint — 2026-10-21

- User accepts private Beta 0.1.19 walking UX and G2 display. Include blank lines between itinerary steps in next release without a separate user check.
- Active 0.1.20 scope: walk → rail → any number of transfers → walk; explicit phone/G2 boarding, alighting, through-service and transfer actions; missed-departure handling; line/direction/platform context.
- Provider evidence reused: ten public Tokyo ODs covered 0/1/2+ transfers. Changed normalization will receive targeted deterministic checks plus at most three fresh public requests, no retries/Google calls.
- Walking hardware feedback is accepted; transit trip hardware and mode-specific 5/30/60-minute lockscreen checks remain NOT RUN. Earlier discovery rows below are historical, not current blockers.

Source SHA256: A9A8649EE17BC583598F8DC42947B1B7CD3D69B7D2945CF5E5A311C8C343B753
| Criterion | Required evidence | Current | Gap / next |
|---|---|---|---|
| G0 §§2–4,15.1 | >=50 deterministic import cases, UI, 12 public real samples, private samples | NOT RUN | Implement parser/resolver/confirmation; keep live evidence separate |
| G1 WALK §§5–6 | actual Google route, steps and compatible tiles | NOT RUN | Adapter and live BYOK |
| G1 DRIVE §§5–6 | actual Google drive route, stale protection and SKU | NOT RUN | Adapter, replay and live BYOK |
| G2 §§6,8,15.2 | arbitrary legs, first/last walks, 10 Tokyo ODs and operator/date coverage | NOT RUN | Adapter/state tests; Transitous access gate |
| G3 §9 | real roads+route+position+instruction in same G2 frame | NOT RUN | SDK slice, projection/queue tests, real device |
| G4 §10 | each mode 5/30/60 min continuous lockscreen | NOT RUN | Beta install and hardware observation |
| Security §§3.5,7,11 | SSRF/auth/atomic caps/privacy tests | NOT RUN | Worker and deterministic adversarial tests |
| Provenance §5 | source/map combinations and terms | NOT RUN | guard and official terms evidence |
| Costs §11 | tiered estimates, static=0 | NOT RUN | estimator and atomic quota tests |
| Lifecycle §§8,12 | cancellation/stale/reconnect/resume | NOT RUN | replay and UI tests |
| Delivery §§14,16 | docs, CLI, builds, official ehpk, checksums | NOT RUN | build integration and official packaging |
| Public source/private Beta §0.3 | correct target, secret/privacy checks; private install | BLOCKED | remote and Portal authority not configured |

## Checkpoint 2026-10-20

Source hash unchanged. See TEST_REPORT.md for current evidence overriding initial NOT RUN discovery rows.
Implemented/tested G0 parser+resolver+UI, G1/G2 adapters, provenance/caps, state/progress, same-frame renderer and SDK path. 222 deterministic tests and6 UI tests PASS. Public expansion11/12 and private expansion2/2; all resolved candidates still need enrichment. Actual Google routes/maps BLOCKED; Transitous live transport FAIL; real G2/lockscreen NOT RUN. Official ehpk and personal Worker deployment PASS, installation not claimed.
Next DAG: restore browser control→Google API/key setup→bounded Google live+enrichment; Even local authentication→private upload→hardware/lockscreen; Transitous transport diagnosis only with changed evidence. Root final clean acceptance remains outstanding.
# NAVITIME follow-up — 2026-10-21

- Implement optional free Transport exit metadata and phone/G2 candidate display; preserve Transitous itinerary/platforms. Owner confirmed personal-use authority.
- Local integration tests passed; provider live acceptance waits for owner-created Basic account and local `navitimeRapidApiKey` insertion. No provider account/key exists yet; no NAVITIME calls made.
- Platform query is not included in the free API service. No paid endpoint is called. This portion remains unavailable rather than fabricated.
- New Beta publication awaits live account/configuration verification; currently published 0.1.21 remains the baseline.
