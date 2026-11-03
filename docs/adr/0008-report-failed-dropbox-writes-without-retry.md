---
status: accepted
---

# Report failed Dropbox writes without a retry queue

When a Dropbox write fails, JNbot shows an error and does not keep that upload in a pending queue for later retry. The current session's in-memory state stays as the user left it. If another edit later saves the same file, that save includes the current state, including the earlier edit. Switching to local mode never copies that state into local data. On a deliberate mode change, JNbot attempts to flush debounced writes before restarting and reports any failure. This avoids an offline synchronization queue, though a failed write may leave the session showing values that Dropbox has not saved.
