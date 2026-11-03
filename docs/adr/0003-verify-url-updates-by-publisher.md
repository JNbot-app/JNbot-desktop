---
status: accepted
---

# Verify URL updates by publisher

URL profile scripts remain auto-updating, so JNbot verifies each downloaded package with its current included signature instead of treating the original checksum as a permanent content pin. Updates from the accepted publisher run normally, unsigned legacy updates remain usable, and a changed publisher key or invalid signature requires one-time acceptance for that update.
