# Decisions
- 2026-10-20: Empty workspace; create a single TypeScript/Vite project with shared typed contracts and independently owned modules.
- Private reference stays only in ignored .local/fixtures. No URL/coordinate output to public logs or fixtures.
- Default Google Tiles, Static Maps disabled; no paid live calls until safe prerequisites and local configuration exist.
- Runtime secrets never enter frontend build; Worker host bound during packaging.
- User explicitly replaced the initial session-only credential policy with persistent login for Beta 0.1.1. First pairing exchanges the owner secret for a revocable, 365-day device credential; only the device credential is stored in the official app-scoped SDK storage. The Worker persists hashes, caps active devices at eight, and owner-secret rotation invalidates all devices. This is not an assertion of hardware-backed storage.
