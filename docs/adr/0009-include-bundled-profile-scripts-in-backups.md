---
status: accepted
---

# Include bundled profile scripts in backups

JNbot backups include portable profile-script files so restoring a profile does not leave its bundled scripts pointing at missing files. URL scripts keep their links and library plugins remain in the plugin backup. Raw recordings belong to the selected storage mode but are excluded from import and export backups to keep those backups smaller.
