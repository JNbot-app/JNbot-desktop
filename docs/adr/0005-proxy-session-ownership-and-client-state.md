---
status: accepted
---

# Let proxy sessions own connections and request state from JNbot participants

The semantic compiler, backpressure, and switching sequence in [ADR 0007](0007-semantic-proxy-transfer-and-control-barriers.md) supersede the corresponding transfer details below. The remaining ownership and lifecycle decisions still apply.

## Context

The existing proxy couples one downstream client to one upstream connection. Closing the client closes the upstream connection. Supporting control transfers requires separating these lifetimes. Reconstructing the full world, entities, inventory, windows, chat, and protocol bookkeeping inside the proxy would duplicate client responsibilities and increase memory use and maintenance.

## Decision

A `ProxySession` owns the upstream connection, active participant, and packet routing. It permits only the active participant's packets to reach the server. Frozen participants continue receiving packets and stay connected. The session ends when its last participant disconnects.

The proxy requests current state from a JNbot bot or JNbot Minecraft client to initialize a switch recipient. The recipient can be vanilla, a JNbot client, or a bot. Vanilla clients are not state providers. The proxy does not maintain a full replica of participant state.

The provider prepares an ordered initialization stream from its current state, with protocol metadata and the packet boundary that state represents. The proxy validates and routes the stream, coordinates acknowledgements, and follows initialization with buffered live traffic. Reconstruction of world, inventory, entities, and other client state belongs to the provider integration. This stream is temporary state transfer and does not restore recording or replay functionality.

Providers explicitly report whether they are ready and open a short-lived capture lease at an upstream packet boundary. The lease yields semantic records incrementally, with backpressure, instead of returning a packet history or a complete proxy-owned world. Reject a switch with a specific reason when required state cannot be transferred faithfully, including unsupported windows, missing item details, or unresolved protocol bookkeeping. Do not silently close windows, discard details, or reset required state. Protocol support for passthrough and packet editing is independent of support for safe switching.

A frozen JNbot participant can remain the state provider while vanilla controls the session. Synchronize accepted active-client actions where needed as well as incoming server packets. If no provider can establish current state, the active participant may continue, but reject switches requiring a snapshot. Never silently resume a stale bot.

All participants in a session must use the same Minecraft protocol version as the upstream connection. Separate sessions may use different supported versions. Reject incompatible participants before handover.

Switch coordination may be asynchronous while packet transformations remain synchronous and ordered. The session briefly pauses upstream delivery after a defined packet boundary, captures semantic records incrementally, initializes the recipient, then drains ordered live traffic before control changes. Backpressure pauses production; a transfer never fails solely because it has many packets or bytes. On timeout or failure, preserve the previous controller and disconnect the incomplete target.

The proxy may retain temporary transfer buffers and small protocol bookkeeping, including acknowledgement ownership. It must not retain a full world replica.

The proxy handles necessary local protocol exchanges to keep frozen participants connected. Only the source participant can forward maintenance replies while a switch is in progress. Target barriers and configuration replies stay local. If the active participant disconnects, attempt recovery only when the active participant itself is a current provider. If recovery fails, disconnect the session's remaining participants with a clear reason. Their departure ends the session.

The switch guarantee is the same upstream connection and account, no reconnect or explicit switch notification, and consistent protocol sequencing. This does not guarantee that arbitrary server plugins cannot infer a switch from behavior or timing.

## Consequences

The upstream connection can survive individual participant departures. JNbot bots and the Minecraft client integration must implement state export and freshness tracking. Correct switching depends on snapshot completeness and coordination with packets arriving during transfer. Bounded buffering limits memory use but means a slow transfer can fail. Cross-version translation is outside this design.

A working packet schema alone does not establish safe switching support. Providers must demonstrate faithful state transfer before reporting that capability. The specification must define the concrete stream format, freshness checks, packet-boundary coordination, and acknowledgement ownership.
