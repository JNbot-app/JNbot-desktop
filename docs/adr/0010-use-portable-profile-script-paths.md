---
status: accepted
---

# Use portable profile-script paths

Profiles currently record absolute paths to bundled script files and URL script information caches. JNbot will store portable references to bundled files in both local and Dropbox modes and resolve them against each installation's data directory. URL information caches are regenerated locally from their URLs. Bundled script files keep their existing contents. These path fields must change because an absolute path from one device cannot work on another.
