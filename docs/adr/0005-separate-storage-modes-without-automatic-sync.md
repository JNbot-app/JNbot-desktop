---
status: accepted
---

# Keep local and Dropbox storage modes separate

JNbot defaults to local storage and may use Dropbox as an optional store for portable profile data, shared settings, plugins, stats, and recordings. Desktop, CLI, and the mobile local runtime make this choice for their own installation. Mobile remote access continues to use its host's data.

Both modes use the same portable file formats. The current `shared.json` belongs to the selected store, including account and device records. Launcher options move into device-only storage in both modes, alongside Minecraft client and server data and Microsoft authentication details.

Switching modes requires a restart, which ends active bots and scripts. It does not copy or reconcile the stores' contents. A new Dropbox store starts empty. Importing a JNbot backup into Dropbox mode restores portable data while leaving device-only data in place.

All three local runtimes read Dropbox on startup and when returning to active use, without background polling. A still-running app with active bots or scripts defers the return-to-use reload until they stop. If Dropbox is unavailable at startup, JNbot shows an unavailable state and offers local mode instead of opening stale Dropbox data. Users avoid simultaneous writers and manage transfers themselves.
