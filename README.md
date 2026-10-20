# Even Nav

Personal Beta navigation for Even Realities G2. Paste a Google Maps place or directions link, confirm its destination, recalculate from the phone's current position, choose the actual itinerary, and display a map with route, position and instructions.

**Development build.** Deterministic tests and packaging do not establish live Google routing, real G2 display or continuous lockscreen navigation. See [test evidence](docs/TEST_REPORT.md), [blockers](docs/BLOCKERS.md), and [quickstart](docs/QUICKSTART.md). No public Even Hub store release.

- TypeScript, official Even Hub SDK, Vite phone UI.
- Google BYOK Routes WALK/DRIVE and Map Tiles; Static Maps disabled.
- Transitous door-to-door rail adapter with arbitrary legs and explicit underground confirmations.
- Authenticated personal Cloudflare Worker; durable atomic request caps.
- Share-source provenance retained; no private itinerary history by default.

```sh
npm ci
npm run typecheck
npm test
npm run test:ui
npm run build
npm run pack
```

Use Node 22. On Windows with an older global Node, `powershell -File scripts/runtime.ps1 run <script>` uses the installed project-local Node. Do not run live probes without checking their printed service/count plan.

Configuration and API keys stay in ignored `.local/config.json` and Worker Secrets. Never put keys in frontend environment variables, commits or packages. See [BYOK setup](docs/GOOGLE_BYOK_SETUP.md), [privacy](docs/PRIVACY.md), [costs](docs/COSTS.md), [source compatibility](docs/DATA_PROVENANCE.md), and [import support](docs/IMPORT_SUPPORT.md).

MIT for original source. Provider data/service terms and official CLI's separate license remain applicable; see [third-party notices](THIRD_PARTY_NOTICES.md).
