# Active blockers

| Boundary | State | Next action / reset condition |
|---|---|---|
| Google BYOK | BLOCKED | Project created; enable Routes/Tiles/Places New/Geocoding, create restricted server key, place in ignored config and Worker Secret. Browser currently cannot attach control reliably |
| Transitous live route | FAIL | 3 bounded attempts across host/cloud, latest diagnostic TRANSPORT. Need changed connectivity/provider state before another identical probe |
| Even upload | BLOCKED | Local official CLI login required; no public review or store publication |
| G2 / lockscreen | NOT RUN | Install actual Beta, observe same-frame rendering and mode-specific5/30/60-minute matrix |
| Open fallback | BLOCKED | No open map/ORS provider configured; no unapproved third paid dependency or public tile scraping |
| Production acceptance | NOT RUN | Final exact build must complete real paste→confirm→route→display path, not stitched unit evidence |

Unrelated `deskhear/` nested repository appeared during implementation; it is preserved and excluded from this project's publication/package.
