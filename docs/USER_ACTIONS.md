# Minimum user actions

## Completed by Codex

- Created source project and public target `https://github.com/jiajiezhou95/even-nav`.
- Deployed personal `even-nav-personal` Worker with auth Secret, durable quota binding and Transitous identification.
- Configured Google key in ignored `.local/config.json` and Worker Secret; restricted it to four required APIs and enabled them. Real WALK/DRIVE, geocoding, Places Text Search, tile session/tile/viewport passed.
- Built front-end/Worker artifacts and actual official `.ehpk`.
- Uploaded Even Nav 0.1.0, set private Beta only, verified public channel is empty and downloaded package matches local SHA256. Invited only the signed-in owner's account.
- Implemented/tested import, routing adapters, navigation, UI/SDK and cost guards; private fixtures excluded before copying.

## User-only

1. Google configuration is complete; no key creation or API enablement step remains. Never send a key in chat.
2. Even CLI login, invitation acceptance and version 0.1.0 installation are complete. Update to the persistent-pairing Beta when available. First pairing uses the local `.local/config.json` `accessToken` field once, entered only in the app settings; later launches restore an independent device credential. Do not send credentials in chat.
3. Perform real-device observations on your iPhone/G2. Device model/iOS/Even App/firmware/permissions/installation channel and 5/30/60-minute evidence are needed; browser tests cannot replace them.

No new plan purchase, subscription upgrade or shared paid key is required by this implementation. Actual provider/account limitations remain explicit.
