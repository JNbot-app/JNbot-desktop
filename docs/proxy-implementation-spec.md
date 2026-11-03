---
status: ready-for-agent
feature: proxy-switching-repair
date: 2026-09-13
---

# Robust Minecraft proxy switching: implementation specification

## 1. Purpose and authority

Implement reliable control transfer between clients attached to one Minecraft Java upstream connection. The upstream connection and account survive takeover and return. The proxy routes traffic and coordinates transfer; the JNbot bot owns the state used to initialize the recipient.

This is the complete implementation handoff from the design interview. The user's request to produce this document confirms that design. It supersedes `.scratch/proxy-session-redesign/spec.md` and conflicting transfer details in `docs/proxy-redesign.md` and ADR 0005. ADRs 0005, 0006, and 0007 retain their ownership and failure decisions as restated here. Implement without repeating the interview. Concrete implementation choices below refine those decisions; they are requirements for the implementation, not claims that the current code already works.

Read this document, the root `AGENTS.md`, and `src/main/src/workers/bot/proxyV3/AGENTS.md` before editing. Inspect the current checkout because the observations below describe the September 13 baseline. Preserve unrelated changes. Keep changes small by responsibility; remove replaced proxy code instead of leaving parallel implementations. Do not introduce a general workflow engine or a new plugin framework.

The reported symptom is a disconnect such as `§cAn internal server connection error occurred.` The user reports that commit `7b4f174fe1fb3d7f2e6356fba4c60b6c1ed5d2e9` worked for 1.8.9, but not 1.21.11. Neither the message nor that comparison proves the current cause. Diagnose protocol selection, phases, packet framing, and switching separately. Do not restore that commit wholesale or patch only a sound packet.

## 2. Required outcomes and scope

1. As a bot owner, I want another client to control my connected account, so that I can take over without another server login.
2. As a player, I want to switch repeatedly between attached clients, so that returning to a previous client preserves my current session.
3. As a vanilla client user, I want a current frozen JNbot provider to support my return to a bot, so that vanilla does not need a state-export mod.
4. As a vanilla client user, I want disconnecting to restore the synchronized frozen bot, so that the proxy does not close the upstream session unnecessarily.
5. As a participant, I want inventory, position, world, entities, health, open windows, and protocol state preserved, so that my first action after switching works correctly.
6. As a participant, I want failed takeover to leave the original source connected and active, so that an incomplete target cannot disrupt my session.
7. As a plugin author, I want to create and stop my own proxy, so that I do not depend on the built-in proxy script.
8. As a plugin author, I want admission hooks, lifecycle events, packet filters, custom providers, and switching through public APIs, so that my plugin controls its own policy.
9. As a plugin author changing a participant's world view, I want to supply a compatible provider, so that transfer does not apply my transformations twice.
10. As an operator, I want large transfers to stream with backpressure, so that world size does not cause a transfer-size rejection or unbounded proxy memory use.
11. As an operator, I want actionable packet and transfer diagnostics, so that I can distinguish a schema failure, a phase error, a stalled client, and missing state.
12. As a user connecting directly through Mineflayer, I want its normal keepalive watchdog preserved, so that proxy-specific behavior does not weaken direct connections.

Support the same protocol within each session. Separate sessions can use different supported protocols. Use numeric negotiated protocol IDs for equality; release labels are diagnostic metadata. Treat 1.8.9 aliases according to installed protocol data. Support newer schemas by feature detection, not release-string condition chains.

Out of scope: cross-version translation within a session, another proxy-owned world/entity/inventory model, packet history as a state source, record/replay, invented default registries, total transfer byte/packet caps, a new playable admission lobby, automatic inversion of arbitrary plugin transformations, unrelated bot recording features, and a guarantee that arbitrary server plugins cannot infer a switch from behavior. Do not add a mobile-only feature or a desktop dashboard redesign for this repair. Mirror changes to overlapping React workflows in `../jnbot-mobile` if shared behavior or UI contracts change.

## 3. Baseline and code map

The focused proxy suite passed during reconnaissance. That is baseline evidence only. The rebuilt CLI plugin and real version matrix were not run. Existing tests include fake connections, so they do not establish acceptance by themselves.

| Location                                                                                     | Current role and required work                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/src/workers/bot/proxyV3/ProxyServer.ts`                                            | Listener, admission, session ownership, public subscriptions. Keep the existing class and simplify implicit global dependencies. Validate protocol before using fallback serializers. |
| `src/main/src/workers/bot/proxyV3/Connection.ts`                                             | Exports `ProxySession`; currently mixes relay, switching, and protocol bookkeeping. Extract cohesive transfer and phase/control helpers; do not create another connection owner.      |
| `src/main/src/workers/bot/proxyV3/ProxyParticipant.ts`                                       | Connection, control state, delivery state, provider binding. Current freshness can be just `status().ready` or default true; replace that with applied-state evidence.                |
| `src/main/src/workers/bot/proxyV3/ProxyStateCompiler.ts`                                     | Existing incremental compiler. Currently missing entities and relying on loosely typed packet-shaped state. Extend semantic compilation and negotiated registry handling.             |
| `src/main/src/workers/bot/botProxy.js`                                                       | Bot-side state tracker and private handshake. It owns capture state and registers JNbot-created bots by stable bot ID.                                                                |
| `src/main/src/workers/bot/botActions.js`                                                     | General bot actions. It does not retain proxy state.                                                                                                                                  |
| `src/main/src/workers/scripts/JNbotProxy/startProxy.ts`                                      | Built-in cross-worker provider bridge. It authenticates a bot ID, exposes tracker readiness, and exports the bot's private capture stream.                                            |
| `src/common/types/proxyApi.d.ts`                                                             | Canonical public contracts. Snapshot has no entities; record union has only chunk/completion; request has a total deadline. Replace those incomplete contracts.                       |
| `src/common/types/declarePlugin.d.ts`, `src/common/types/pluginApi.d.ts`, `proxyV3/index.ts` | Public plugin declarations and exports. Trace the matching runtime `require('jnbot')` exports and update them together.                                                               |
| `src/main/src/workers/bot/join.js`, `proxyKeepAlive.js`                                      | Explicit `minecraftProxy` route and proxy-only keepalive behavior. Keep SOCKS transport in `proxyConnect.js` distinct.                                                                |
| `proxyV3/wasmParser.ts`, `tolerantParser.ts`, `PacketPipeline.ts`, `SemanticEvents.ts`       | Demand-driven decode, synchronous transformations, raw forwarding, normalized events. Preserve byte identity and separate parser errors from delivery errors.                         |
| `proxyV3/plugins/Recorder/`                                                                  | Currently contains debugging code despite its name. Trace references before renaming to Debug; retain debugging while removing any remaining proxy replay behavior.                   |
| `src/main/src/functions/minecraft/bridge/`, `src/main/src/workers/lib/WorkerMcClient.ts`     | Existing client bridge and worker access. Reuse authentication, request correlation, and lifecycle handling.                                                                          |
| `test/main/proxy-*.test.ts`, `test/protocol/harness.js`                                      | Existing test seams. Add real loopback connection tests; reuse the worker fixture narrowly.                                                                                           |
| `esbuild/esbuild.config.cli.prod.js`, `src/cli/v2/commands.ts`, `src/cli/mocks.ts`           | Rebuilt CLI, plugin execution, and `JNBOT_USER_DATA` isolation. Verify packaged schema and WASM paths as well as source tests.                                                        |

Current switching pauses upstream ingress before the source barrier, throws if delivery occurs while held, and resumes ingress immediately before the final target barrier. Audit already-buffered frames and the order in which resumed input reaches that barrier. Current successful compilation is not proof that packets were serialized in the right phase or applied by a real target.

## 4. Architecture and ownership

Use these responsibilities. File names for new internal helpers may follow nearby conventions, but keep one implementation of each responsibility.

| Module                  | Owns                                                                                                                     | Must not own                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `ProxyServer`           | Listener, ID-keyed sessions, admissions, lifecycle subscriptions, stop/disposal                                          | World state; gameplay rules hardcoded for one plugin                          |
| `ProxySession`          | One upstream connection, participants, active ID, control generation, ordered routing, small protocol state              | World columns, entity collections, inventory mirrors, packet history          |
| `ProxyParticipant`      | One downstream connection, negotiated protocol, independent protocol/control states, provider binding, delivery counters | An independently reconstructed world                                          |
| Transfer coordinator    | One short-lived switch, cancellation, barriers, capture lease, live queue cursors, commit/rollback                       | A permanent world cache or a second packet-routing implementation             |
| Protocol control helper | Phase transitions, local request IDs, upstream response ownership, synchronization scalars                               | General gameplay state or arbitrary packet history                            |
| Packet pipeline         | Ordered synchronous filtering/transformation and read-only diagnostics                                                   | Asynchronous transform jobs, direct socket ownership                          |
| State compiler          | Semantic-record-to-schema packet conversion, one current chunk/item/entity working set                                   | Entire snapshot accumulation; live state maintenance                          |
| Bot provider            | Current participant-owned models, applied-state tracking, temporary capture lease, lossless export                       | Upstream socket ownership or packets fabricated for a specific target release |
| Debug sink              | Bounded diagnostic metadata and optional payloads                                                                        | Replay execution or participation in gameplay correctness                     |

Prefer functions and a small coordinator over subclass hierarchies. Use discriminated unions for connection state, control state, transfer stage, semantic records, and operation results. Keep type assertions at validated integration boundaries. Do not replace every external type with `any` or duplicate canonical types in UI, worker, and plugin packages.

Transport phase and control state are separate. A target can be in PLAY while still initializing. A frozen source can be fully connected and obliged to answer maintenance. A single `ready` boolean cannot represent those cases.

## 5. Public API contract

### Server and participant access

Preserve `new ProxyServer(config)`, `await proxy.ready`, `proxy.sessions`, `proxy.getSession(id)`, `proxy.onAdmission(...)`, `proxy.onSession(...)`, `proxy.onParticipant(...)`, `proxy.onPacket(...)`, and idempotent `proxy.stop()`. Subscriptions return unsubscribe functions. Public construction must work in a plugin that never starts `jnbotproxy`. Resolve explicit configuration first; existing app defaults can remain optional convenience defaults.

Admission retains the discriminated decisions `new-session`, `existing-session`, `reject`, and `defer`. Accepting an existing session never opens another upstream connection. Use participant and session IDs for switching; usernames can be lookup conveniences only when unambiguous. Revalidate deferred decisions after cancellation, session departure, protocol changes, or proxy stop. Keep admission deadlines separate from transfer inactivity timeouts.

The session exposes ID, upstream account label, numeric protocol, participants, active participant ID, control generation, and capability failures. `participant.setStateProvider(provider)` attaches a provider to that exact connection. Provider loss marks it unavailable; an old binding cannot become valid again because another participant uses the same username.

`session.switchTo(targetId)` resolves a discriminated result. The active participant is always the state source. Success includes session ID, source participant ID, target participant ID, transfer ID, and committed control generation. Failure includes a stable code, message, stage, and relevant IDs. Expected failures return results; programming errors must still be visible. A no-op switch to the active participant does not increment generation. Concurrent transfers return `switch_busy`.

### Provider helpers

Discover state providers only for JNbot-created bots through the private proxy handshake. The bot replies with its stable ID and an internal join token before initial state reaches it. The proxy resolves the provider by that ID and waits for the tracker to report ready. External integrations may still supply a custom provider through admission decisions. Plain Mineflayer and JNbot Fabric clients are never proxy switch sources.

Bot creators only set the proxy connection. Packet tracing, capture IDs, chunks, barriers, and provider attachment remain internal. Advanced plugins may implement the provider contract directly for transformed views.

Retain the explicit bot option `minecraftProxy: { host?, port, takeover?, onlineMode? }`. It selects the plugin-owned Minecraft proxy, not a SOCKS proxy. The target attach path must resolve far enough to expose its bot/participant before waiting for world initialization; otherwise awaiting `join()` before `switchTo()` deadlocks. Define takeover attachment readiness separately from spawned/gameplay readiness. Normal direct `join()` behavior stays unchanged.

### Packet API and ownership

Keep existing packet context operations: inspect data, mark modified, drop, replace raw, and inject after the current packet. Session handlers run before recipient handlers; each recipient gets isolated mutable data only when needed. Expose packet origin, direction, phase, participant IDs, sequence, and generation so handlers and debugging can distinguish live traffic, initialization, injection, and local control.

All upstream dispatch paths, including plugin direct writes, injections, raw fallback, deferred writes, and library-generated replies, pass the same final ownership gate. An upstream direct write supplies source participant ID and captured control generation; a downstream direct write supplies target ID. Revalidate at actual dispatch, not just when scheduling a microtask. Plugins cannot turn a blocked initializing packet into an allowed upstream injection.

Reserved local control exchanges run outside mutable plugin transformations. Plugins may observe their diagnostic events but cannot reroute, inject, or change them. Gameplay packets remain editable.

## 6. Semantic snapshot and provider contract

Use one streaming capture contract. Remove the legacy whole-snapshot `capture()` fallback once bundled integrations are migrated; do not retain success-shaped incomplete variants merely to satisfy old tests.

| Contract        | Required contents and behavior                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider status | Ready/unavailable, supported state domains, precise unavailable reasons, connection binding, applied progress. Ready is capability, not proof of freshness.                                                                                                                |
| Capture request | Format version, transfer/session/provider/target IDs, numeric protocol, current control generation, requested boundary and per-connection delivery watermark, target phase/kind, required domains, cancellation. No total byte/packet budget or fixed completion deadline. |
| Capture header  | Matching identity and protocol, actual applied boundary, registry revision, semantic world/player metadata, domain completeness, view identity. No giant chunks/entities/items array.                                                                                      |
| Capture records | Ordered discriminated semantic records, then one explicit completion record. Collections stream incrementally.                                                                                                                                                             |
| Capture lease   | Header, `AsyncIterable` records, idempotent release with committed/failed/cancelled reason. The lease owns temporary export resources in the provider.                                                                                                                     |

Record kinds cover registry entries, tags/features where applicable, chunk sections/light/block entities, entities and relationships, player state, inventory slots/cursor, open-window state/properties, presentation state, synchronization state, and completion. Group related small values where it reduces overhead. Do not create one message per scalar when a bounded record is clearer. Large chunks or registry entries may span transport fragments; fragmentation is not Minecraft packet replay.

Define record order so dependencies are available before consumers: configuration and registry records first, login/world metadata next, world data before dependent entities, entity identities before relationships, then inventory/interface and final player/synchronization state. Empty collections have explicit complete markers or counts. An absent domain means unsupported/incomplete; a complete zero-entity world and an all-empty slot inventory are legitimate states.

| State domain           | Fidelity requirements                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol/configuration | Effective registry entries and ordering/IDs, known-pack selections, feature flags, tags, dimension codec, configuration completion and registry revision. Preserve negotiated values, not only vanilla defaults.                                                                                            |
| World                  | Current dimension identity, minimum Y, physical height, logical height, world name, seed fields where required, loaded columns, block states, biomes, light, heightmaps, block entities, weather/time/border and other required world presentation. Export the source's known world, not the entire server. |
| Entities               | IDs/UUIDs, registry-backed type, position/rotation/velocity, metadata, attributes, equipment, effects, player information, passengers/leashes and other relationships. Preserve IDs referenced by later live updates.                                                                                       |
| Player                 | Position/rotation, velocity where required, on-ground semantics, health/food/saturation, experience, abilities, selected slot, game mode and required status. Preserve the upstream player entity identity.                                                                                                 |
| Inventory/interface    | Every slot including empty slots, cursor/carried item, exact NBT/components, selected slot, open window ID/type/title/slots/properties, state/action IDs, pending accepted interactions. Reopening a window must preserve its next valid action.                                                            |
| Presentation           | Current scoreboards/teams, player list, boss bars and other active interface state where omission changes the session. Visible chat history and chat protocol continuity are distinct. Keep historical display data provider-owned.                                                                         |
| Synchronization        | Teleport IDs, transactions, container state IDs, interaction sequences, pending response ownership, and chat/session continuity required by the negotiated protocol. Do not substitute zero for unknown state.                                                                                              |

Use a lossless transport encoding for 64-bit integers, buffers, NBT, and item components. JSON numbers cannot represent arbitrary protocol integers; encode them with explicit tagged decimal strings or word pairs and validate on receipt. Preserve NBT numeric widths and types. Do not use display-oriented inventory/entity DTOs, stringified component summaries, or truncated tool responses as state export.

Packet-shaped NBT or registry payloads may be useful lossless data encodings inside semantic records. They must not become a generic `packet name + data/raw body` replay record. The compiler chooses packet identity, field arrangement, and phase from the negotiated schema.

Define snapshots in canonical upstream coordinates and identities. A custom provider whose client sees a transformed view must normalize that view before export and declare its supported view contract. Route compiled gameplay initialization through the target's session/recipient transformation policy exactly once, tagged with initialization origin, then through the same ordered writer used for live output. Local protocol barriers and phase control remain reserved. A plugin that drops required initialization state must provide a coherent supported view contract or make that transfer unavailable; bypassing its edits silently is not a solution.

## 7. Stable capture and provider freshness

Use the simplest initial consistency mechanism: pause provider simulation and state-changing automation, hold delivery of later state-changing upstream traffic at an explicit boundary, and stream the provider's stable existing model. This does not pause its event loop or maintenance handlers. Do not add copy-on-write world machinery unless measured requirements demonstrate it is necessary. The hold is temporary and uses the flow control and liveness rules in section 10.

Maintenance that changes captured gameplay state must finish before B or remain ordered with the later state updates; it cannot mutate a supposedly stable lease. Export unresolved synchronization ownership when faithfully representable. Otherwise return a retryable pending-exchange reason before initializing the target. Keepalive handling itself does not justify allowing arbitrary inventory or teleport handlers through the capture hold.

Freeze gameplay before establishing the source barrier. Serialize the barrier after all source-bound packets included in the requested boundary. Consume its response locally. A keepalive reply establishes a protocol fence; it does not by itself prove that asynchronous chunk loading or worker work has applied all preceding updates. `beginCapture` must wait for those applications before declaring its actual boundary.

Track session order and per-participant delivered/applied progress separately. A session sequence can contain traffic never delivered to a particular participant. Maintain a mapping to that participant's raw Minecraft frame ordinal and accepted-action ordinal. Capture instrumentation counts frames before optional body decoding and reports application after the relevant client handlers complete. Account for bundles and asynchronous application. Install counters at connection creation, or establish their offset with a verified local fence before allowing capture. Never implement freshness by copying `request.boundary` into the reply.

For a frozen provider while vanilla is active, propagate accepted active actions through the existing JNbot control channel when those actions affect local state that server updates do not fully describe. Use an ordered action sequence bound to generation. Apply actions to the provider's model without sending them upstream again. Movement-only synchronization is insufficient; include accepted held-slot, inventory/cursor/window, interaction, and prediction changes as required. Unknown state-changing actions, loss of sequence, unavailable item details, or client decode failure affecting a required domain make the provider stale until reconciled.

The source is the current controller; the provider can be a different frozen JNbot participant. Freeze the controller, establish its local source barrier, and separately prove the provider has applied the delivered state and accepted-action watermark. A provider side-channel response alone cannot establish ordering against a different Minecraft socket.

The provider pause is reversible. Save prior automation/physics settings and restore those exact settings, rather than blindly enabling physics or restarting scripts. A frozen observer must not run independent gameplay prediction that silently makes its export stale. Release all capture resources even when validation fails or cancellation arrives before `beginCapture` resolves. A late lease must be released immediately, not orphaned.

A lease can be released after its final initialization record is accepted and the target initialization barrier completes. This release frees the stable export view; it is not the switch commit. The original source then consumes catch-up traffic while remaining gameplay-frozen and recoverable. Marking a lease committed must not cause the provider to end its connection or abandon rollback state.

## 8. Compiler, registries, and protocol phases

Build a protocol capability view from the installed negotiated schema: packet existence, field types, nested containers/switches, integer widths, direction, phase, and relevant `supportFeature` flags. Cache immutable schema resources by numeric protocol and phase. Use explicit semantic builders for login, respawn, chunks, entities, inventory, and interface state. A generic field-name filter cannot construct missing required fields or choose nested variants.

Use separate serializers for the actual endpoint phase. Login protocol success and the PLAY join-game packet often named `login` are different operations. Authentication and initial transport login remain endpoint responsibilities; the snapshot compiler emits configuration and world-entry state appropriate to the target's existing endpoint. Wait for local phase acknowledgements before using the next serializer. The protocol library distinguishes login from reaching PLAY; verify this against the installed implementation and [official API documentation](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/docs/API.md).

For a new modern target: finish transport login, wait for login acknowledgement/configuration readiness, emit negotiated configuration content and finish-configuration, consume its reply locally, then send PLAY world entry. For an already-playing target: use the supported reconfiguration/respawn/reset path, remove old entities/windows/world state as required, and reinitialize. Never send a second transport login success into PLAY. A real repeat-switch test must prove that old entities/chunks do not survive as ghosts.

An upstream phase transition during capture invalidates that capture boundary. Roll back, restore normal source routing, and let the upstream transition finish. Return a retryable phase-transition failure rather than mixing registries from different revisions. Phase-control responses from an initializing target are always local; they cannot advance the upstream state machine.

Create a transfer-scoped Prismarine registry from the negotiated protocol, then load the source's effective registry data before constructing chunk/item interpreters. The installed `prismarine-chunk` loader accepts a registry object; a version string alone recreates static defaults. Consult [prismarine-registry](https://github.com/PrismarineJS/prismarine-registry) and [prismarine-chunk](https://github.com/PrismarineJS/prismarine-chunk), but treat installed source and lockfile versions as the implementation authority.

Preserve registry ordering, IDs, NBT, and source dimension shape. Do not overwrite logical height with physical height simply because both fields exist. If the advertised registry conflicts with the provider's effective shape, reconcile using evidence from the provider's authoritative active registry; otherwise fail with `registry_mismatch`. Never patch dimensions based only on a release label or fabricate a default codec. Do not mutate shared `minecraft-data` defaults or a registry used by another session.

For the 1.21.11 256-high regression, serialize the configuration records, ingest them through the target's actual registry-loading path, derive minY/height from that loaded registry, then construct and load its chunk parser. Assert real blocks, biomes, lighting, and block entities at multiple heights. A test that manually creates both columns with `{ minY: 0, worldHeight: 256 }` bypasses the bug and is insufficient. Also cover nonzero/negative minY and a logical height different from physical height.

Portable Prismarine JSON can omit wire-format flags. Restore those from the negotiated implementation's constructors/features, as the current compiler attempts for palette flags. Round-trip actual values, not only absence of an exception.

Compile items with the correct registry-aware item codec and preserve component/NBT distinctions. Build entity spawn/metadata/equipment/relationship packets from semantic records using schema features. Account-bound signed chat, resource-pack state, or custom interfaces must have explicit supported continuity handling. Do not invent signatures, silently strip data, or reconnect upstream to make these cases pass. Unsupported required state is a specific incomplete capability, not success.

Serialize each generated packet before enqueueing it, validate required fields/variants and its declared phase, then write through the ordered target writer. Await downstream drain before requesting more records. Keep only the working data required for the current record/packet. No `Array.from`, spread, `Promise.all`, or full output list over the capture iterator.

## 9. Exact switching algorithm

Maintain one transfer object with ID, stage, source/provider/target IDs, generation at start, abort controller, lease, boundary B, catch-up cut C, progress clock, and queue cursors. These are control data. Every callback checks that this transfer is still current before changing session state.

| Stage                  | Required action and exit condition                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight              | Validate target connection, same negotiated protocol, stable upstream PLAY, provider capability/freshness, view compatibility, and no concurrent switch. Plan a valid target reset/configuration path. Rejections before mutation do not disconnect a healthy unrelated target.                    |
| Freeze                 | Set source gameplay-frozen; set target initializing and block its outgoing path before any initialization write. Drop subsequently generated source gameplay, not defer it for later. Continue only valid source maintenance replies. Establish boundary B and hold later state-changing delivery. |
| Source barrier         | Send the local source keepalive after all relevant writes through B. Register ownership before sending. Consume only the matching response. Wait for provider-applied state and accepted-action evidence through B.                                                                                |
| Capture                | Request the semantic lease, validate identity/protocol/generation/boundary/domains/registry revision, and leave source maintenance operational. Reject incomplete or stale headers before target state writes where possible.                                                                      |
| Initialize             | Incrementally compile and deliver configuration, world entry, world, entities, inventory/interface, player, and synchronization data using their dependencies and local phases. Target traffic remains blocked.                                                                                    |
| Initialization barrier | After all required initial packets and local phase prerequisites, send/consume the local target initialization barrier. Wait for applicable target application fences. Do not activate.                                                                                                            |
| Catch-up               | Release capture resources safely. Flush live packets after B to source/provider and target exactly once in order. Keep source gameplay-frozen and target initializing. Set a finite cut C in the same ingress ordering domain once the target writer is ready to fence.                            |
| Final barrier          | Serialize the final target keepalive after the last packet through C, including pending writer work. Hold later target delivery until this fence completes. Consume its matching response and settle outstanding local initialization IDs and required protocol acknowledgements.                  |
| Activate               | With no intervening await, revalidate target/source policy, transfer identity, and generation; increment generation and assign target active. Only now release later target delivery and admit new-generation gameplay. Emit one receipt/event after the state mutation.                           |
| Rollback               | On any pre-commit failure, keep target blocked, cancel producers, release the lease, discard only target-owned partial output, detach the incomplete target, restore source delivery and required synchronization, then make source gameplay-active. Preserve upstream and generation.             |

Post-C traffic belongs to normal ordered delivery after activation. Do not drain a moving queue forever while upstream keeps producing, and do not place a barrier ahead of resumed socket data that was never assigned to the cut. Capture ingress frames already buffered by Node/the parser when applying a hold; socket `pause()` is not a guarantee that no more callbacks can run. Never throw merely because such a frame arrives.

Tag blocked frames with the control state/generation at ingress. Target packets received while initializing remain discarded even if processing is deferred until after commit. Do not flush a client-to-server initialization queue on activation. Async plugin packet handlers remain prohibited.

Never turn a post-commit observer exception into rollback. Isolate event listeners from transaction success, and report their errors separately. Once committed, cleanup failure does not retroactively report an unsuccessful switch. Before commit, preserve the original failure even if lease release or target disconnect also throws; cleanup uses independent guarded steps and `finally`.

If the target/provider disconnects, cancellation wins and late replies cannot reactivate it. If the source itself disconnects, it cannot be restored. Use the existing lifecycle policy: recover to an attached current provider when freshness can be established, otherwise close remaining participants with a clear reason. Never restart a departed bot or claim rollback preserved a connection that was already lost. The last participant departure closes upstream once.

## 10. Backpressure, maintenance, and barrier containment

Use bounded in-flight queues with high/low watermarks as flow-control thresholds, not transfer acceptance limits. Pause producers and await writable drain. Resume below the low watermark. One large logical semantic record must fragment through the provider transport rather than be rejected for exceeding its message envelope. Do not silently drop ordered live updates.

During capture, enqueue only state-changing live traffic after B that has not yet been applied to the held source/target. These queues exist only for delivery/catch-up. A single shared raw frame with per-recipient cursors can avoid duplicate payload copies. Clear frames as soon as all required recipients consume them. Do not maintain an ever-growing list of original packets or a full state cache.

Keep protocol-critical traffic serviceable while source gameplay delivery is held. Forward source maintenance only when its request ownership and prerequisites permit it; a transaction acknowledgement cannot bypass the inventory update it acknowledges. When high water requires pausing the TCP input, control traffic behind unread bytes cannot magically bypass that pause. Monitor ingress/control progress and roll back early enough to resume source delivery before an outstanding maintenance deadline is lost. This is a liveness failure, not a rejection based on total transfer size. Do not claim arbitrarily slow clients can always succeed with finite memory and server deadlines.

Replace total `transferTimeoutMs` semantics with explicit `transferIdleTimeoutMs`, reset by completed capture records, accepted/drained initialization writes, consumed required barriers, and advancing catch-up delivery. Do not reset it for polling, queued-but-unconsumed work, or unrelated keepalives. Use separate deadlines for actual protocol requests and stalled ingress/drain. Configure/test them independently; a large transfer making progress must not expire simply because its total duration exceeds the idle interval. Document runtime defaults and their units in public types/configuration.

Use a response-ownership table scoped to participant, protocol phase, transfer, generation, and request purpose. Local source barrier, target initialization barrier, target catch-up barrier, downstream-only keepalives, and real upstream requests are distinct. Decode IDs according to their negotiated signed width; avoid ambiguous string coercion or lossy number conversion.

Allocate downstream IDs without collision with outstanding local/upstream exchanges; remap upstream request IDs where needed and restore them on the one allowed upstream response. Track bounded outstanding and recently retired local IDs so duplicate/late responses remain local. Registration precedes the write. Cancellation retires the ID before releasing the waiter. Plugins cannot modify the ownership table.

An unknown response ID is never eligible for upstream forwarding merely because a retirement entry expired. Require a live upstream ownership entry for every forwarded correlated response. This keeps arbitrarily late local replies contained without retaining an unbounded history of local barrier IDs.

Prefer one designated source responder for upstream keepalives during transfer, consistent with source maintenance ownership. Disable competing automatic replies in proxy endpoints and locally answer downstream keepalives for frozen clients as needed. Do not blanket-disable keepalive handling in all Mineflayer clients. The special `proxyKeepAlive` behavior is installed only on explicit proxy-routed bot connections; direct bots retain the library watchdog.

Consume target-local configuration replies, keepalives, teleport confirmations, transactions, and other initialization responses at the local control layer. Never forward them upstream just because they resemble an outstanding upstream packet. Pending live requests during catch-up retain explicit ownership; settle or transfer that ownership before commit without inventing world state. Unexpected duplicate responses are diagnostic events, not additional upstream writes.

## 11. Raw packet path and decoder failure behavior

Read frame boundaries and packet IDs without decoding bodies. Resolve identity from schema mappings for the captured protocol/phase/direction. Decode only when internal control, a matching listener/transformation, normalized-event subscription, or full debug capture needs fields. Metadata-only debugging must not trigger body decoding. Re-evaluate demand when subscriptions change.

For a demanded decode, preserve immutable original bytes, try WASM, and fall back to ProtoDef on unsupported datatypes or parse failure. Give potentially mutating decoders separate input where necessary. Validate consumed length and parse result shape. A partial successful parse must not truncate the original packet. Preserve the entire original decompressed packet body, including its packet ID, for unchanged forwarding.

Keep parse exception handling separate from `push`, packet listeners, transformations, and writes. A downstream handler throwing after a successful decode must not cause the parser to decode and emit the same packet again through its fallback path. Run ProtoDef exactly once after a genuine WASM parse failure. If both decoders fail, emit a clear diagnostic and route the original bytes once, unchanged, through the normal ownership gate.

The containment rule takes precedence over fallback routing. Keep packet identity from the schema mapping even when the body fails to decode. A failed decode of a reserved local response cannot fall through as an ordinary active packet: consume it locally and fail its transfer if its ID cannot be established safely. Likewise initializing/frozen gameplay remains blocked. Ordinary eligible packets must remain byte-for-byte transparent after dual failure. Required-state decode failure invalidates the affected provider capability until reconciled.

Untouched decoded packets still forward original bytes. Serialize only modified/injected packets. Validate all outputs for one transformed packet before any write; on handler exception or invalid serialization, discard edits and injections and forward original bytes unless an explicit drop already applies. Never retry transport writes through raw fallback after bytes may already have been sent.

Verify parser installation on every protocol-state change and library-created deserializer replacement. Verify the CLI runtime resolves the rebuilt WASM package and schema data from the intended distribution, not an old main bundle. Dependency-internal feature/version dispatch is acceptable; new application fixes must use features/schema structure.

## 12. Provider transport and bot implementation

`botProxy.js` owns the bot-side tracker. A switching proxy sends a nonce-bound private control frame before forwarding initial state. The bot replies with its stable ID and an internal join token. The built-in proxy validates that token through the worker bridge, waits for the tracker-ready frame, then exports state by bot ID. Plugin-owned proxies use the in-process provider registry.

Capture freezes bot physics only while its lease is open. The worker bridge exports chunk and entity records from that lease and restores physics on every release path. It never treats a Fabric client as a proxy state source.

The bot integration uses current Mineflayer models plus bot-owned configuration/synchronization metadata. Track current registry entries by identity/revision instead of appending an unbounded sequence of `registry_data` packets. Chunk export must capture the column and its matching heightmap/light data at the same boundary. Extract capture code from the already large `botActions.js` into a focused bot-side helper if needed. Built-in and plugin-owned proxies must use this same implementation.

A provider with unimplemented entity or registry domains must report unavailable. Conversely, do not reject a valid all-empty inventory or a world with no other entities. Test domain completeness, slot layout, registry identity, and explicit completion rather than treating nonempty arrays as proof.

Transport cleanup covers cancellation, idle timeout, page error, provider departure, target departure, session end, and plugin unload. Server-side abandoned leases also expire on inactivity so a lost release request cannot leave a client paused forever. Renew lease activity only for legitimate transfer work. Zero active leases, restored provider settings, and no retained pages are observable cleanup requirements.

## 13. Implementation order and completion gates

| Step                           | Work                                                                                                                                                                                        | Completion gate before moving on                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Reproduce and instrument    | Record checkout/dependency versions, run focused baseline, build a loopback server with raw upstream receipt capture. Compare relevant changes with `7b4f174`; inspect the supplied plugin. | A failing behavioral test or precise missing acceptance case, with negotiated protocol/phase and one connection ID recorded. No guessed packet-specific fix. |
| 2. Consolidate contracts       | Define canonical streaming records, explicit domain completeness, operation results, applied progress, view identity, cancellation, and inactivity settings. Migrate consumers together.    | Types/examples have one provider contract; no whole-snapshot compatibility path or static `isFresh: true`.                                                   |
| 3. Fix raw routing/control     | Centralize dispatch gates, demand-driven parsing, fallback isolation, barrier IDs/ownership, and proxy-only keepalive setup.                                                                | Lazy decode, dual-failure byte identity, local control containment, generation and direct-watchdog tests pass.                                               |
| 4. Establish real capture      | Implement bot pause/application boundary and incremental lease; then matching worker transport.                                                                                             | State changes around B produce a consistent export; cancellation restores bot settings; memory does not grow with total transmitted data in the proxy.       |
| 5. Complete compilation        | Load effective registries and add phase-correct world/entity/inventory/interface/synchronization builders.                                                                                  | Real serializers/parsers round-trip the required state for 1.8.9, 1.20.4, and 1.21.11, including negotiated 256-high chunks.                                 |
| 6. Replace switch coordination | Implement the exact stage table, bounded live delivery, finite catch-up cut, final barrier, atomic activation, and rollback.                                                                | Real connections prove one upstream, maintenance survival, blocked target responses through catch-up, repeated return, and failure recovery.                 |
| 7. Restore frozen bots         | Keep the frozen bot synchronized with the active vanilla client and restore it when vanilla disconnects.                                                                                    | Vanilla actions update the frozen bot's position and selected slot. The fallback opens no second upstream login.                                             |
| 8. Fresh frozen providers      | Reconcile accepted active actions and reject stale providers.                                                                                                                               | A stale bot cannot activate, and a vanilla participant cannot become a provider.                                                                             |
| 9. Integrate public access     | Use shared helpers in `jnbotproxy`, runtime exports, declarations, debug controls, and overlapping mobile contracts. Remove replaced proxy replay code.                                     | A standalone plugin creates a proxy and switches using only documented public APIs. Generated references and applicable builds pass.                         |
| 10. Run acceptance             | Rebuild CLI/mods, run focused and real transport suites, execute the supplied CLI plugin matrix, inspect recipient state and upstream receipts.                                             | Every acceptance row has evidence or an explicit unresolved failure; no success claim from join timing, mocked barriers, or stale artifacts.                 |

Do not treat a new architectural layer as progress unless it replaces an existing responsibility and has an observable test. Do not broaden into unrelated cleanup. No tracker publication, commit, push, or deployment is required by this document.

## 14. Acceptance tests

Test through `ProxyServer` and real loopback protocol clients wherever possible. Use a real Mineflayer recipient for semantic application. A narrow fake provider/clock is appropriate for deterministic cancellation and timeout cases; fake client `write()` methods that immediately echo barriers cannot establish transport correctness. Reuse `test/protocol/harness.js` and the existing bridge test patterns without importing their unrelated record/replay functionality.

Use version matrix 1.8.9, 1.20.4 as the separate configuration-phase case, and 1.21.11. Cover all three protocols with JNbot and vanilla clients.

| Case                   | Required observation                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One session            | The upstream fixture counts one accepted connection/login across A to B to A and repeated switches. Account and socket identity remain unchanged.                                                                                 |
| Source barrier         | The source processes it, but the upstream fixture sees neither that request nor its response. Include duplicate/late responses and ID collision with an upstream keepalive.                                                       |
| Target barriers        | Both initialization and final catch-up barriers are absent from upstream receipts. Match participant, phase, generation, and purpose.                                                                                             |
| Frozen survival        | Source remains connected across multiple maintenance intervals during capture and after switch. Its gameplay is absent upstream; required source replies arrive exactly once.                                                     |
| Initialization traffic | Generate movement, settings, chat, teleport confirmations, transactions, and phase responses while target initializes. None reaches upstream. Local prerequisites still complete.                                                 |
| Catch-up responses     | Hold the final barrier reply; inject queued live packets that cause target replies. Upstream sees no target-generated response before completion. Releasing the barrier alone must not flush discarded outgoing traffic.          |
| Deferred packets       | Receive target traffic while initializing, delay its processing until after commit, and prove it remains blocked. Reject old-generation direct writes and injections.                                                             |
| Cut ordering           | Put frames in socket/parser buffers before hold, produce more during drain, and delay writes. Each required update through C appears once before the final barrier; post-C frames arrive in normal order after commit.            |
| Snapshot consistency   | Mutate blocks, light, entities, player state, and inventory around B; delay asynchronous application and bridge replies. Snapshot plus catch-up equals the authoritative final state.                                             |
| Backpressure           | Tiny watermarks and slow readers stop producers without a total-size rejection. A large progressing transfer outlives the idle interval successfully. Stalled progress rolls back and frees resources.                            |
| Maintenance pressure   | Fill the live queue and stall target writes while upstream demands maintenance. Resume/rollback before the source loses the session. A progress counter for exported chunks alone cannot hide blocked protocol control.           |
| Dimensions/chunks      | 1.21.11 256-high world loads configuration into a fresh negotiated registry and derives parser shape from it. Assert blocks/biomes/light/block entities, minY, registry IDs, and logical height.                                  |
| Phases                 | Initial configuration, local target reconfiguration, login/PLAY separation, and upstream reconfiguration during capture use correct serializers and ownership.                                                                    |
| Inventory/interface    | Compare every slot/component/NBT, cursor, selected slot, window type/ID/title/properties and state IDs. Execute a valid post-switch click and verify server acceptance.                                                           |
| Entities/player        | Compare IDs, metadata, equipment, attributes/effects, passengers, position, health/food, experience, abilities. Subsequent live entity updates affect the restored entity.                                                        |
| Repeated target        | Switch back to an already-playing participant. No ghost entities, stale chunks, duplicate windows, or second transport login.                                                                                                     |
| Vanilla return         | Keep a frozen bot current through accepted vanilla actions; use it as provider. Reject missing/gapped state and test configured recovery after vanilla disconnects.                                                               |
| Lazy decode            | Count decoder calls at the raw parser seam. Ordinary unobserved packets invoke neither WASM nor ProtoDef. Subscribe/unsubscribe and metadata/full debug modes alter demand correctly.                                             |
| WASM fallback          | Force an unsupported datatype using the installed parser; ProtoDef recovers once with a diagnostic. No duplicate delivery from a downstream handler exception.                                                                    |
| Dual failure           | Both decoders fail on an eligible ordinary packet. Raw body including ID/length content arrives byte-for-byte once. The analogous reserved local response remains contained.                                                      |
| Pipeline failure       | Throwing/async handlers and invalid serialized edits discard mutations/injections and preserve raw unless explicitly dropped. No partial output precedes validation.                                                              |
| Proxy/direct keepalive | Proxy clients handle local keepalives without inappropriate watchdog kicks; direct Mineflayer clients still start, renew, and expire their normal watchdog.                                                                       |
| Failure cleanup        | At every awaited stage, inject abort, provider/target disconnect, release exception, and session stop. Original source remains usable where connected; generation does not advance; handles/timers/listeners/queues are released. |
| Public plugin          | Runtime `require('jnbot')` exposes the proxy constructor; plugin-owned proxy works with the built-in script stopped. Admission/edit/filter/switch and unsubscribe/stop work.                                                      |
| Debug/removal          | Packet inspection works in both directions with outcomes and errors. No proxy recording/replay exports, commands, or UI actions remain; unrelated files/features survive.                                                         |

## 15. Rebuilt CLI and supplied plugin procedure

The required plugin is `mtyldrza02ptqvw3pdof.js`, supplied in the app's user-data `macros/` folder. This is user-provided input, not an application path to hardcode. Read it before running. Preserve the original or record a reviewable diff if strengthening it. Its existing receipt/generation checks are useful; its source chat and local-state checks do not prove server-side isolation, and its catch handler currently logs then stops, so process exit alone is insufficient.

Use the repository's supported Node runtime, currently declared as Node 20 or newer. From the repository root, the verified build/test entry points are:

```sh
npm run test:main -- --runInBand --runTestsByPath test/main/proxy-v3-session.test.ts test/main/proxy-state-providers.test.ts test/main/proxy-v3-pipeline.test.ts test/main/proxy-keepalive.test.ts test/main/proxy-config.test.ts
npm run build:plugin-reference
npm run build:cli
node ./release/app/dist/cli/cli/cli.mjs --help
node ./release/app/dist/cli/cli/cli.mjs plugin list
node ./release/app/dist/cli/cli/cli.mjs plugin options mtyldrza02ptqvw3pdof
```

Add the new transport/parser suites to the focused command. Record the actual resolved Node and dependency versions, build time, source revision/dirty diff, and CLI/worker/WASM/schema artifact paths. `npm run start:cli` points at release output and does not rebuild it. Build success without loading the intended worker/WASM/data files is insufficient.

The CLI supports `plugin options-set <idOrName> <option> <jsonValue>` and `plugin run <idOrName>`; it does not currently take `--options` on `plugin run`. `options-set` requires the option to exist in the plugin's declared configuration. Resolve the supplied plugin's actual ID with `plugin list`, inspect its declared settings for host/port/proxyPort/username/version, and add missing test options to the isolated plugin configuration when necessary. Run each matrix version against an instrumented loopback upstream. Save and restore options if using the user's profile. Prefer an isolated `JNBOT_USER_DATA` directory with a test profile and a copy/import of the supplied plugin; use the verified `plugin import` interface rather than inventing a file-path execution command.

Example commands after the fixture is listening and the plugin is installed in the selected test data directory:

```sh
node ./release/app/dist/cli/cli/cli.mjs plugin options-set mtyldrza02ptqvw3pdof version '"1.8.9"'
node ./release/app/dist/cli/cli/cli.mjs plugin run mtyldrza02ptqvw3pdof
```

Repeat with 1.20.4 and 1.21.11 and the fixture's matching server configuration. Set `JNBOT_USER_DATA` consistently for every command when isolated. Configure loopback addresses before running; do not accidentally use the plugin's default public-server destination. The local matrix proves protocol/control invariants. Separately reproduce the user's original server failure with the authorized account/configuration and diagnostic capture when available; never substitute a public-server smoke test for upstream receipt assertions.

Strengthen the test plugin so attachment and switch completion are separate events, success requires a non-noop receipt and generation change, source and target remain online, post-switch actions are server-accepted, and asynchronous errors produce an unambiguous failure marker. Coordinate server-side assertions through the test fixture, not production packet-history storage. Test A to B to A and a deliberately failed transfer.

Run `npm run build:main`, `npm run check:plugin-reference`, and applicable renderer/mobile contract checks when their inputs change. Run the repository's actual compilation checks; historical notes about TypeScript configuration failures are leads to verify, not permission to skip validation. Finish with `git diff --check`.

## 16. Diagnostics and troubleshooting

Emit structured stage events with transfer/session/participant IDs, numeric protocol and release label, endpoint phase, source/provider/target IDs, generation, B/C watermarks, record ordinal/domain, queue pressure, progress age, barrier purpose, and outcome. Packet diagnostics include direction, schema packet ID/name, original byte length, decode backend/failure, transformation outcome, and origin. Keep credentials, private keys, and unrelated user payloads out of routine logs. Payload capture remains explicit and bounded.

| Symptom                                         | Inspect first                                                                                                                 | Correct response                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Internal connection error / wrong packet fields | Handshake numeric protocol, upstream negotiated version, phase at serialization, first failing packet and unchanged raw bytes | Fix negotiation/phase/schema selection at the owning boundary. Do not hardcode the reported sound packet. |
| 1.8.9 worked in old commit                      | Diff connection routing, `join()` proxy option, parser installation, compiler, and dependency resolution against `7b4f174`    | Reproduce the smallest regression with real bytes. Preserve the new ownership architecture.               |
| Modern login fails before world                 | Transport-login vs PLAY `login`, manual configuration, acknowledgement timing, default registry injection                     | Ensure target-local state machine finishes each phase before writing the next phase's packets.            |
| 1.21.11 chunk underflow/height error            | Target-loaded dimension registry, minY/height, section count, palette flags, biome/light arrays                               | Round-trip through a fresh registry populated from serialized configuration. Compare actual block values. |
| Switch hangs after target join                  | Whether takeover `join()` waits for spawn; whether provider binding waits on `join()`                                         | Expose attachment readiness and start switch before waiting for target world readiness.                   |
| Barrier times out                               | ID signed representation, write order, actual endpoint phase, response owner, decoder demand, client application work         | Keep the barrier local; repair the fence or phase. Do not forward it upstream as a keepalive fix.         |
| Source kicked while frozen                      | Blanket C2S block, duplicate keepalive responders, input pause duration, source maintenance ledger                            | Preserve source maintenance and backpressure liveness; isolate proxy-only watchdog changes.               |
| Server sees target replies during transfer      | Raw fallback/direct write/injection/library auto-reply paths and generation at ingress                                        | Route all writes through the same gate; discard initialization traffic permanently.                       |
| Receipt succeeds but state is wrong             | Missing domains, fake barrier echoes, copied boundary values, capture mutation, wrong C cut                                   | Add a real recipient/state assertion and repair the violated boundary. Do not add replay.                 |
| Return from vanilla is stale                    | Accepted-action coverage and provider applied watermark, cursor/window/held-slot prediction                                   | Reconcile supported actions or report stale provider with the missing action/domain.                      |
| Memory grows with world size                    | Whole-snapshot RPC, spread/Array.from over iterators, unbounded registry append, retained queue frames                        | Stream pages, await drain, release consumed data, keep state provider-owned.                              |
| Duplicate packet after decoder failure          | Exception scope around parser emission/listeners and retry path                                                               | Separate genuine parse failure from delivery failure; never emit twice.                                   |
| CLI works differently from tests                | Actual runtime bundle, data/WASM lookup path, old process/port, plugin options/profile                                        | Rebuild and verify loaded artifacts and effective settings. Do not use stale release output as evidence.  |
| Failure leaves bot paused                       | Lease release on late resolution/abort, saved simulation settings, abandoned transport handles                                | Release idempotently in all exit paths and verify restored state.                                         |

Failure codes should distinguish at least missing participant/session, protocol mismatch, provider unavailable/stale/incomplete, incompatible view, phase transition, busy transfer, registry mismatch, invalid semantic record, serialization failure, barrier timeout, stalled transfer/control, cancellation, and endpoint loss. Include stage and actionable details. Avoid one generic catch that turns all of these into an unexplained disconnect.

## 17. Definition of done and handoff evidence

Complete the implementation only when the JNbot provider, exact switching sequence, public plugin access, and acceptance matrix work. Store concise verification results beside the implementation: commands, runtime/build identity, tested protocol/provider pairs, upstream connection and barrier evidence, state comparisons, failure-injection outcomes, and any unresolved limitation. Link the tests that establish each guarantee.

Explicitly distinguish source tests, real loopback tests, rebuilt CLI plugin tests, and reproduction on the user's server. Passing existing tests, a compiler-only round-trip, or a logged switch receipt is not sufficient. An unavailable environment or unsupported required state remains an incomplete acceptance item; do not label it passed or silently narrow the goal.

Update `docs/proxy-api.md`, generated plugin references, `CONTEXT.md`, and the repair notes to match the final implementation. Preserve packet debugging and remove dead proxy recording/replay paths. Leave a short final report explaining changes, verification, and any remaining failure. The next agent should implement and verify this plan, not produce another competing design document.
