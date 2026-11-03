# Proxy redesign interview

Status: design confirmed by the request to produce a detailed implementation handoff. The current [implementation specification](proxy-implementation-spec.md) is ready for agent work; this document preserves the interview decisions and reconnaissance. The earlier scratch specification is superseded.

## September 2026 repair interview

The new requirements reopen implementation and verification questions. [ADR 0007](adr/0007-semantic-proxy-transfer-and-control-barriers.md) records the settled changes and takes precedence over older packet-stream and size-limit wording in this document and its linked specification.

Current code observations, not a diagnosis of the reported disconnect:

- The current `switchTo()` requires the active participant to provide state. The required vanilla-to-bot return path also needs a current frozen JNbot provider when vanilla holds control.
- `switchTo()` pauses upstream ingress before the source barrier and resumes it before sending the final target barrier. `#deliverS2C()` throws if it sees a frame while delivery is held. These paths need real transport tests for already-buffered frames and catch-up ordering.
- The bot capture lease reads columns incrementally and assumes pausing upstream delivery keeps its model stable. It does not establish that local simulation or automation cannot change the exported state.
- Fabric/JNbot-client state export is not supported; proxy switching only discovers JNbot-created bots automatically.
- `ProxyStateSnapshot` has no entity collection, and its incremental record type supports only chunks and completion. Passing current tests cannot establish the requested entity preservation.
- The supplied plugin checks a switch receipt and control generation, but its frozen-traffic check observes local participant state rather than server receipts. It cannot prove upstream isolation by itself.
- Commit `7b4f174fe1fb3d7f2e6356fba4c60b6c1ed5d2e9` predates the current compiler and switching changes. It is a behavioral comparison point for the reported working 1.8.9 case, not an architecture to restore wholesale.

Baseline verification on September 13: the five focused proxy test suites passed, 36 tests total. The rebuilt CLI plugin and live version matrix have not been run in this interview.

Decisions from the first question round:

1. Preserve vanilla-to-bot return using a frozen provider only when it proves freshness against accepted active-client actions and server updates. The user accepted this recommendation.
2. Permit a brief provider-owned pause of local simulation and state-changing automation during capture while protocol maintenance continues. The user delegated this choice to the simplest approach.
3. Abort stalled transfers using a configurable inactivity timeout reset by transfer progress, rather than a total transfer-duration deadline. The user accepted this recommendation.

The user accepted the second-round recommendation: when a plugin changes participants' world views, that plugin supplies a compatible provider where necessary. The core refuses transfers whose providers cannot establish consistency. It cannot infer how to reverse arbitrary packet transformations or recover state a plugin has dropped.

The request to produce the detailed implementation handoff confirms the design. The [implementation specification](proxy-implementation-spec.md) resolves the implementation plan. Runtime fixes and the rebuilt CLI verification matrix remain outstanding.

## Settled requirements

- Support Minecraft Java Edition.
- Use a simple architecture with general APIs. Bot takeover, account assignment, spatial rules, coordinate spoofing, and admission queues are use cases for those APIs, not hardcoded event modes.
- Provide both arbitrary packet editing, insertion, and dropping and higher-level operations such as participant switching.
- Expose the full proxy API through the plugin API, including hooks such as `onSession`, `onParticipant`, and `onPacket`.
- Keep packet transformations synchronous and ordered.
- Use the protocol supplied by `minecraft-data` and capability checks instead of chains of Minecraft version comparisons. Future compatibility is best effort, not guaranteed.
- Avoid optional world and chunk decoding when no consumer needs it.
- If a packet cannot be decoded, forward its original bytes and log the decoding failure to the console. This is best effort and can bypass rules that require decoding. Normal session routing still applies, so a frozen participant cannot send upstream through this fallback.
- If a transformer throws or produces invalid output, abandon that packet's transformations and injections, stop further transformers for it, and log the error. Forward original bytes unless an explicit drop already applies. Preserve session routing restrictions. See [ADR 0006](adr/0006-proxy-packet-failure-recovery.md).
- Coordinate hiding belongs in plugin code. Provide editable packet data and position-related events that let plugins change coordinates. Do not build coordinate hiding or a secrecy guarantee into the proxy API.
- Remove recording and replay functionality. Keep inspection and optional debug files in both directions, including dropped, injected, and undecodable packets. Include packet identity, routing, outcome, and errors. Bound storage, disclose truncation, and allow full payload capture on request. Debugging may request decoding but should have little overhead when disabled.
- Follow the session and state-provider ownership decisions in [ADR 0005](adr/0005-proxy-session-ownership-and-client-state.md).
- The takeover flow returns control to the bot when the human disconnects, provided the bot remains connected and current. A frozen JNbot participant can supply state while vanilla controls the session; vanilla itself is never the provider.
- Switches preserve the upstream connection, account, and consistent protocol sequencing, with no reconnect or explicit switch notification. Universal resistance to inference by arbitrary server plugins is outside the guarantee.
- Require the same protocol version within a session. Support different protocol versions across sessions without adding cross-version translation.
- Allow asynchronous switch coordination, bounded temporary buffering, and small protocol bookkeeping. Abort an unsuccessful transfer and preserve the previous controller when possible.
- The state provider generates an ordered initialization stream from current state, with protocol metadata and a packet boundary. The proxy validates and routes it, coordinates acknowledgements, and follows it with buffered live traffic. World and client-state reconstruction belongs to provider integrations, not the proxy.
- Providers declare their state-transfer capabilities. Reject switching with a specific reason if required state cannot be transferred faithfully. Do not silently close windows, drop item details, or reset required state. Passthrough and packet editing may work for a protocol whose safe switching capability is unavailable.
- Handle necessary local protocol exchanges for frozen participants without forwarding their replies upstream. When the active participant leaves and bounded recovery cannot establish a usable controller, disconnect the remaining participants with a clear reason.
- Provide normalized events for movement, entity movement, block interactions, and inventory interactions, with underlying packet access. Decode only when needed. Support transformations per recipient so one participant's changes do not modify another's state.
- Admission hooks can accept, reject, or defer a connection, with cancellation and deadlines. Plugins implement timing, capacity, and account selection. Initial waiting occurs before joining the world, within supported connection timeouts; a playable lobby is outside the initial scope.
- Breaking existing proxy plugins is allowed. No backward compatibility is expected. Update bundled integrations and remove recording/replay exports. Preserve existing files on disk rather than deleting user data as part of the API migration.
- Proxy access authorization is outside the current design discussion.
- Keep desktop and mobile behavior aligned for features available on both when implementation changes their interfaces.

## Reconnaissance

- `src/main/src/workers/bot/proxyV3/ProxyServer.ts` indexes connections by downstream username and replaces an existing connection with the same name.
- `Connection.ts` owns both endpoints and closes the upstream when the client closes. It forwards original packet bytes unless modified and buffers traffic around protocol phase transitions.
- `PacketPipeline.ts` executes wildcard handlers before packet-name handlers, catches handler exceptions, and continues processing. It does not undo mutations made before a handler throws.
- `wasmParser.ts` and `tolerantParser.ts` attempt decoding before the pipeline and report decoding failures before forwarding raw bytes.
- `auth.ts` selects upstream authentication using the downstream username. Independent account assignment needs a separate selection step.
- `src/common/types/proxyApi.d.ts` currently couples debug capture, recording, and replay types.
- `src/main/src/workers/compiler/scriptRuntime.ts` exposes proxy classes through `require('JNbot')`, providing an existing integration point for the replacement API.
- `McClientApi.d.ts` defines inventory and entity summaries. The Fabric bridge's `McPlayerActionService.getInventory` exports item summaries through `ItemStackJson`; these existing interfaces are not a complete session handover contract.

## Specification work

No product or architectural questions remain in the current interview. The specification must define the initialization stream contract, capability reporting, packet-boundary and freshness checks, hook ordering, local execution of synchronous transformers, protocol maintenance, and buffer limits. These details must preserve the settled requirements above.

Validation must cover takeover and return to a current bot, stale or missing providers, active-participant departure, transfer failure and overflow, protocol phase changes, same-protocol admission, malformed packets, transformer rollback, recipient isolation, and optional decoding. State-transfer checks must include world and entities, complete item data, open windows, chat state, and protocol identifiers. Passing packet-forwarding checks alone does not establish switching support.

## Protocol reference

[minecraft-data](https://github.com/PrismarineJS/minecraft-data) provides protocol descriptions and feature availability data. These support schema-driven packet encoding and capability checks. Semantic operations such as handing over live client state still need explicit behavior beyond packet field layouts.
