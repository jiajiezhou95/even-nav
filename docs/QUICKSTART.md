# Quickstart

1. Install dependencies (`npm ci`, Node 22). On this Windows workstation use `powershell -File scripts/runtime.ps1 run doctor`.
2. Keep `.local/config.json` private. It contains `workerOrigin`, `accessToken`, `googleApiKey`, and Transitous configuration metadata. Create your own backend token; never distribute the project owner's token.
3. Enable Google Routes, Map Tiles, Places New and Geocoding in your own billing project; restrict the key to those APIs. Put it only in local `googleApiKey`, then run `node --import tsx scripts/configure-secrets.ts`. This writes Secrets through the official Cloudflare CLI without printing them.
4. Deploy your own Worker with `npx wrangler deploy --config apps/worker/wrangler.toml`; set CORS origins to those used by your Even host/dev environment. `EVEN_APP_LOOPBACK=true` permits the installed iPhone Even App's `http://127.0.0.1:<port>` origin across port changes. It accepts only that exact host/scheme with a valid nonzero port, not arbitrary sites or LAN addresses. Origin is not proof of app identity: bearer authentication remains mandatory. The initial project Worker has already been deployed; do not overwrite unrelated Workers.
5. `npm run pack` binds the exact HTTPS Worker origin to both the build and manifest whitelist, builds the phone UI, scans publication files, and uses the official CLI to create `artifacts/even-nav.ehpk` plus SHA256. Changing the Worker host requires repackaging.
6. Sign into the official CLI locally: `node node_modules/@evenrealities/evenhub-cli/main.js login`. Enter credentials only in that local prompt, never chat. Upload the completed package through CLI/Portal, add only your own account to the Beta group, and use the Beta channel. Do not submit public review.
7. Install in the Even app. In settings perform first pairing with the owner Worker access token, then connect G2. Version 0.1.1 stores an independent device credential and restores it automatically on later launches; the owner token is not saved. Grant native location permission. Paste a share link; confirm the enriched destination/map point; choose mode and query; choose the actual returned route; start.
8. Use pause, resume, end and transit confirmations. Browser development GPS is a separately labelled preview and does not prove G2 behavior. Follow `LOCKSCREEN_REPORT.md` for separate 5/30/60-minute observations.

`npm run probe:providers` is plan-only. `-- --execute` checks health/capabilities without charging Google. `npm run replay` is explicitly synthetic. `test:ui` uses intercepted HTTP and cannot establish provider/hardware acceptance.

`doctor` checks local prerequisites and reports an empty Google key as BLOCKED.
Its PASS rows only prove the named local check: they do not verify account login,
API permissions, billing, native display or locked-screen operation.

For the first private Beta creation, after successful official CLI `self-check`,
verify the account namespace against `app.json` before creating/uploading anything.
Use `docs/BETA_DESCRIPTION.txt` as the description; the app name is `Even Nav`
and tagline is `私人地图与公共交通导航测试`.
The original upload icon is `assets/even-nav-icon.png` (24×24, transparent /
opaque #F4F4F4, complete 2×2 blocks), supplied with `--icon`.
The CLI `create` operation produces a Draft build. Then use `promote <version>
--to beta` for the private channel and verify the tester list contains only the
owner. Do not use public review or public publication.

On this Windows workstation the login command works from any directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\TZ\Dropbox\Codex\Even G2\scripts\even-login.ps1"
```

The script changes to the project directory before invoking the official CLI.
Enter credentials only at its local prompt.

### Glasses controls (0.1.19)

During navigation, double-tap to open the compact arrow-selection menu over the existing HUD. Slide to choose; double-tap to confirm. Single-taps do nothing. The menu contains whole-route view, zoom in, zoom out, reselect route, return to navigation and Exit Plugin. Whole-route view starts with a full-screen map; slide forward through full-screen itinerary text pages to the end, or backward to the map. Double-tap opens the menu; select Return to Navigation and double-tap to return. There is no separate return gesture.

Reselect queries once from the current location. A narrow overlay shows up to three routes with duration and distance; sliding synchronizes the selected phone tab and route map, and a double-tap explicitly starts that route. Phone tab changes also update the glasses selection and map. Delayed map results cannot replace a newer selection.

The lower-right HUD shows total remaining distance, phone-local current time and an estimated arrival time. ETA is an estimate from remaining route steps/schedules; unavailable or past estimates show `--:--`. The header reduces text size for long instructions within its existing height, preserving the large map and maneuver icon size.

The phone accepts Google Maps place or route share links only. Manual address/coordinate entry and destination map picking are removed. Every route query uses the current phone location; any original start point in the shared link is not selectable as the navigation origin.

Exit Plugin is the last menu item and also requires double-tap confirmation. It stops app navigation/location activity and requests the official Even SDK immediate exit (`shutDownPageContainer(0)`). Host closure on iPhone/G2 must be verified on hardware; a native failure must not be labelled successful exit.

### Rail journeys (0.1.20)

Paste a Google Maps destination, select 公共交通, choose a departure time and route, then start from the current phone location. Walk to the boarding stop. When actually on the train, double-tap to open the glasses menu and double-tap its first item 已上车 (or use the matching phone button). The menu action changes to 已下车. Confirm only after getting off; walk the transfer segment and choose 完成换乘 at its end, then confirm boarding the next train. Repeat for further transfers and finish the last walk. Through service uses 确认直通 and keeps the boarded state, without asking you to get off.

Line, direction, boarding/alighting stops and platform are shown when supplied. Some services return numeric labels or omit platforms. No missing value is invented. Underground GPS loss retains the last location and transit phase; GPS/timetables never automatically confirm boarding or alighting. A missed departure prompts replanning; available schedules are not proof of actual train arrival. Steps in the full-screen itinerary are separated by a blank line. Transit hardware and lockscreen observations are still required separately.
