---
status: accepted
---

# Preserve original packets when decoding or transformation fails

## Context

The proxy should keep traffic flowing when a protocol schema cannot decode a packet or a plugin fails. Continuing with partially modified data can corrupt traffic. The existing pipeline catches exceptions but leaves earlier mutations intact.

## Decision

Keep packet transformations synchronous and ordered. When decoding fails, log a console warning and forward the original bytes through normal session routing. This fallback never permits a frozen participant to send upstream.

When a transformer throws or produces an invalid packet, log the error, abandon that packet's transformations and injections, and stop running further transformers for it. Forward the original packet unless an explicit drop has already been applied. Always preserve session routing restrictions. Packet debugging must still report the failure and final outcome.

## Consequences

Unknown packets can remain usable even when the proxy cannot inspect them. Inspection-based plugin rules can be bypassed on failure; this best-effort tradeoff is intentional.

The implementation must preserve original bytes and validate transformed output before dispatch. This recovery policy cannot undo bytes already written to a socket. Transport failures need separate handling and must not trigger duplicate sends.
