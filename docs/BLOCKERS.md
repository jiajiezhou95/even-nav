# Active blockers

| Boundary | State | Next action / reset condition |
|---|---|---|
| Google BYOK | CONFIGURED / LIVE PASS | Four APIs enabled; key restricted to Routes/Tiles/Places New/Geocoding and stored in Worker Secret. Public WALK/DRIVE/geocoding/text search/tile session/tile/viewport requests passed |
| Transitous live coverage | PARTIAL | 10/10 public Tokyo OD returned routes, including 0/1/2+ transfers; operator fields confirm Metro/Toei/JR/private rail for 2026-10-21. Some upstream services only supply numeric trip labels; physical transfer feasibility and device navigation remain unverified |
| Even Beta installation | 0.1.0 INSTALLED / UPDATE IN PROGRESS | Owner tester Active; user confirms installation. Version 0.1.1 adds persistent device pairing; physical relaunch verification remains pending |
| G2 / lockscreen | NOT RUN | Install actual Beta, observe same-frame rendering and mode-specific5/30/60-minute matrix |
| Open fallback | BLOCKED | No open map/ORS provider configured; no unapproved third paid dependency or public tile scraping |
| Production acceptance | NOT RUN | Final exact build must complete real paste→confirm→route→display path, not stitched unit evidence |

Unrelated `deskhear/` nested repository appeared during implementation; it is preserved and excluded from this project's publication/package.
