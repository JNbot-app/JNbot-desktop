---
status: accepted
---

# Restore authenticated backups without package prompts

Opening an encrypted JNbot backup with its share key authorizes restoration of the package revisions inside it. Restore validates and stages all settings, plugins, and reconstructed provenance before replacing live data, then presents one result summary instead of repeating normal import dialogs for every plugin. A failure leaves the previous installation unchanged, and future changed revisions still follow the usual confirmation policy.
