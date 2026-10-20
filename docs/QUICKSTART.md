# Quickstart

1. Install dependencies (`npm ci`, Node 22). On this Windows workstation use `powershell -File scripts/runtime.ps1 run doctor`.
2. Keep `.local/config.json` private. It contains `workerOrigin`, `accessToken`, `googleApiKey`, and Transitous configuration metadata. Create your own backend token; never distribute the project owner's token.
3. Enable Google Routes, Map Tiles, Places New and Geocoding in your own billing project; restrict the key to those APIs. Put it only in local `googleApiKey`, then run `node --import tsx scripts/configure-secrets.ts`. This writes Secrets through the official Cloudflare CLI without printing them.
4. Deploy your own Worker with `npx wrangler deploy --config apps/worker/wrangler.toml`; set CORS origins to those used by your Even host/dev environment. Auth remains mandatory even for an allowed origin. The initial project Worker has already been deployed; do not overwrite unrelated Workers.
5. `npm run pack` binds the exact HTTPS Worker origin to both the build and manifest whitelist, builds the phone UI, scans publication files, and uses the official CLI to create `artifacts/even-nav.ehpk` plus SHA256. Changing the Worker host requires repackaging.
6. Sign into the official CLI locally: `node node_modules/@evenrealities/evenhub-cli/main.js login`. Enter credentials only in that local prompt, never chat. Upload the completed package through CLI/Portal, add only your own account to the Beta group, and use the Beta channel. Do not submit public review.
7. Install in the Even app. In settings enter the Worker access token for this session and connect G2. Grant native location permission. Paste a share link; confirm the enriched destination/map point; choose mode and query; choose the actual returned route; start.
8. Use pause, resume, end and transit confirmations. Browser development GPS is a separately labelled preview and does not prove G2 behavior. Follow `LOCKSCREEN_REPORT.md` for separate 5/30/60-minute observations.

`npm run probe:providers` is plan-only. `-- --execute` checks health/capabilities without charging Google. `npm run replay` is explicitly synthetic. `test:ui` uses intercepted HTTP and cannot establish provider/hardware acceptance.
