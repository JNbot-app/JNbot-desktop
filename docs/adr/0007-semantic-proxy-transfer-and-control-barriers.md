---
status: accepted
---

# Compile semantic state and isolate control until catch-up completes

## Context

The September 2026 requirements retain the session ownership decision in ADR 0005 but clarify state transfer, packet decoding, and activation order. Earlier descriptions of provider-generated packets and size-based transfer rejection conflict with those requirements. This record takes precedence for those points; it does not claim that the current implementation satisfies them.

## Decision

`ProxySession` owns one upstream connection, participant connections and control states, ordered routing and queues, filtering and transformations, and small scalar synchronization data. Full world, entity, and inventory state belongs to the source bot. The proxy requests that state only during switching and never maintains another world model or packet history.

Providers expose semantic snapshots. The compiler produces initialization packets incrementally from the negotiated `minecraft-data` and `minecraft-protocol` schemas, using feature detection and schema inspection. It must preserve the source dimension registry and world shape. Version-specific patch chains, fabricated default registries, and hardcoded replay packets are outside this design.

Backpressure controls production and delivery. A transfer cannot fail solely because its total byte or packet count exceeds a threshold. Temporary ordered live-packet queues serve catch-up only; they cannot become a growing world substitute or historical replay buffer. A configurable inactivity timeout aborts stalled transfers and resets on transfer progress. There is no fixed deadline for total transfer duration. Unrelated live traffic or routine keepalives do not count as transfer progress.

Vanilla-to-bot return remains required. When vanilla holds control, a frozen JNbot participant may supply state only after establishing that it has applied accepted active-client actions as well as upstream updates. Provider readiness alone is not evidence of freshness. Vanilla itself does not become a provider.

Use a brief provider-owned pause of local simulation and state-changing automation to establish a stable capture view. This follows the user's preference for the simplest sound implementation. Protocol maintenance must continue; pausing the whole client event loop is not a valid capture pause. The provider must release the pause on success, failure, and cancellation.

Switching follows this order:

1. Freeze source gameplay traffic while continuing required source protocol maintenance replies.
2. Send and consume a local source keepalive barrier.
3. Request the source provider's semantic snapshot.
4. Compile and send target configuration, login, world, inventory, entity, and interface state incrementally in the correct protocol phase.
5. Keep the target initializing and discard its outgoing traffic, consuming required local control exchanges at the proxy.
6. Send and consume the target initialization barrier.
7. Flush queued live packets while target outgoing traffic remains blocked.
8. Send and consume the final target catch-up barrier.
9. Activate the target and increment control generation.

All three barrier exchanges stay local. The source must remain recoverable until activation succeeds. On failure, preserve the original source as active and disconnect the incomplete target. If the source connection itself has failed, recovery remains subject to the session lifecycle rules in ADR 0005.

Packet transformations stay synchronous and ordered. Untouched traffic remains raw. Decode fields only for listeners, transformations, debugging, or internal protocol control. Try WASM first, then ProtoDef; if both fail, preserve the exact original bytes and emit a clear diagnostic. ADR 0006's routing restrictions still apply to this fallback, including barrier containment and target isolation. Keep packet debugging and keep record/replay removed.

Plugins can construct `ProxyServer`, attach custom providers, and call `session.switchTo(...)` without starting the built-in `jnbotproxy` script. Preserve admission control, `onSession`, `onParticipant`, `onPacket`, filtering, and packet modification. JNbot-created bots identify themselves through a private proxy handshake and install their provider automatically. JNbot Fabric clients are not proxy switch sources.

When a plugin changes participants' world views, that plugin must supply a compatible state provider where necessary. The provider contract must establish how its snapshot relates to the target's transformations so that initialization does not apply edits twice. The core refuses a transfer whose provider cannot establish consistency; it does not attempt to invert arbitrary transformations or reconstruct dropped state.

## Consequences

The provider integrations must export complete state and establish snapshot consistency. Schema-driven serialization alone cannot supply missing entity, inventory, interface, or synchronization semantics. Readiness must distinguish a complete export of an empty state from an unimplemented export.

Transport backpressure, snapshot stability, protocol maintenance, and catch-up must work together. Pausing upstream reads for an entire slow transfer does not by itself prove source survival or snapshot consistency. Keepalive acknowledgements also need evidence that the provider has applied the state represented by the snapshot boundary.

Verification requires focused tests and the rebuilt CLI test plugin on 1.8.9, 1.21.11, and a configuration-phase version. Observe upstream traffic directly to prove that the original upstream connection survives, local barriers remain local, and target responses stay blocked through final catch-up. Test state preservation, negotiated-registry parsing of 256-high 1.21.11 chunks, phase-correct serialization, lazy decoding, both decoder fallback paths, rollback, and the normal keepalive watchdog for direct Mineflayer connections. A successful `join()` is not evidence of a successful switch.
