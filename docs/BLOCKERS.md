# Active blockers

| Boundary | State | Next action / reset condition |
|---|---|---|
| Google BYOK | CONFIGURED / LIVE PASS | Four APIs enabled; key restricted to Routes/Tiles/Places New/Geocoding and stored in Worker Secret. Public WALK/DRIVE/geocoding/text search/tile session/tile/viewport requests passed |
| Transitous live coverage | PARTIAL | 10/10 public Tokyo OD returned routes, including 0/1/2+ transfers; operator fields confirm Metro/Toei/JR/private rail for 2026-10-21. Some upstream services only supply numeric trip labels; physical transfer feasibility and device navigation remain unverified |
| Even Beta installation | 0.1.19 USER ACCEPTED | Owner tester installed; user accepts walking UX. Persistent pairing and automatic reconnect previously confirmed. Transit update is in progress |
| G2 walking display | USER ACCEPTED | User confirms large map and walking controls work on 0.1.19; itinerary spacing goes into next update without separate acceptance |
| Transit device / lockscreen | NOT RUN | Door-to-door rail navigation is the active implementation. Real trip and mode-specific 5/30/60-minute lockscreen observations remain separate gates |
| Open fallback | BLOCKED | No open map/ORS provider configured; no unapproved third paid dependency or public tile scraping |
| Production acceptance | NOT RUN | Final exact build must complete real paste→confirm→route→display path, not stitched unit evidence |

Unrelated `deskhear/` nested repository appeared during implementation; it is preserved and excluded from this project's publication/package.
