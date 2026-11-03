---
status: accepted
---

# Keep signing keys out of backups

Normal instance and cloud backups preserve package signatures but exclude the local publisher private key. A restored installation creates its own publisher identity for new or modified content because silently copying the key would transfer signing authority to every holder of the backup.
