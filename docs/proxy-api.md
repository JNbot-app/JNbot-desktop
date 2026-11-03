# Proxy plugin API

`ProxyServer` owns admissions and sessions. A `ProxySession` keeps one upstream Minecraft connection open and attaches one or more downstream participants. The session routes gameplay packets from its active participant only. Frozen participants continue to receive server packets.

Packet handlers run synchronously in registration order. A handler may edit `context.data`, call `markModified()`, replace raw bytes, drop the packet, or inject packets after it. If a handler throws or returns a promise, the proxy logs the failure and forwards the original bytes. An explicit `drop()` still applies.

## Take over a bot session

The active bot must have a current `ProxyStateProvider`. A provider opens a short-lived capture lease at an upstream packet boundary, then yields semantic records such as chunks. The proxy compiles those records for the target's negotiated schema. It does not keep a world or packet-history copy.

`switchTo()` resolves only after the target has processed the initialization and catch-up barriers. Its successful result includes the session, source, target, transfer ID, and committed control generation. A target may be a bot, vanilla client, or JNbot Fabric client. Switching away from vanilla or Fabric remains unavailable because they are not source providers in this release.

```ts
import { ProxyServer } from 'jnbot';

const proxy = new ProxyServer({ host: 'play.example.net', proxyPort: 25566 });
let botSessionId: string | undefined;

proxy.onSession((event) => {
  if (event.action === 'created' && !botSessionId)
    botSessionId = event.sessionId;
});

proxy.onAdmission((request) => {
  if (request.username === 'Builder' && botSessionId) {
    return {
      type: 'existing-session',
      sessionId: botSessionId,
      kind: 'vanilla',
    };
  }
  return { type: 'new-session', kind: 'bot', provider: botStateProvider };
});

proxy.onParticipant((event) => {
  if (event.action !== 'attached' || !event.participantId) return;
  const session = proxy.getSession(event.sessionId);
  if (!session || session.activeParticipantId === event.participantId) return;
  void session.switchTo(event.participantId).then((result) => {
    if (!result.ok)
      console.error('Takeover failed', result.code, result.message);
  });
});
```

During a transfer, only the frozen source may send its protocol maintenance replies. The initializing target cannot send any traffic upstream. If the transfer fails, the proxy disconnects that target and keeps the source active. The proxy never opens a second upstream connection during a switch, so the server keeps the same socket, protocol state, and account.

## Route a bot to a plugin-owned proxy

Pass the proxy connection explicitly when creating the bot. Set `takeover` for a target that inherits an existing session. It suppresses login and backend-selection actions.

```ts
const source = await join(
  { username: 'Builder', minecraftProxy: { port: 25566 } },
  { gamemode: 'skyblockdream' },
);

const target = await join(
  { username: 'Builder', minecraftProxy: { port: 25566, takeover: true } },
);
```

## Assign an upstream account

Admission can map a joining name to a configured Minecraft account before the session connects upstream.

```ts
proxy.onAdmission((request) => {
  if (request.username === 'player1') {
    return { type: 'new-session', accountUsername: 'playerA' };
  }
});
```

Later participants inherit the session's upstream account. They cannot replace it.

## Limit joins and add spacing

Admission handlers may defer a decision. The proxy cancels the request when its deadline expires or the client leaves.

```ts
let nextJoinAt = 0;

proxy.onAdmission((request) => {
  if (proxy.sessions.size >= 10)
    return { type: 'reject', reason: 'Proxy is full' };

  const waitMs = Math.max(0, nextJoinAt - Date.now());
  nextJoinAt = Date.now() + waitMs + 5_000;
  if (waitMs === 0) return { type: 'new-session' };

  return {
    type: 'defer',
    decision: new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ type: 'new-session' }), waitMs);
      request.signal.addEventListener('abort', () => clearTimeout(timer), {
        once: true,
      });
    }),
  };
});
```

## Movement and block rules

Normalized events cover common protocol packet names. `supportsEvent()` reports whether JNbot has a mapping. The original packet remains available for fields that the normalized event does not expose.

```ts
const session = proxy.getSession(sessionId);
if (!session) throw new Error('Session ended');

session.pipeline.onEvent('movement', (event) => {
  if (event.y !== undefined && (event.y < 50 || event.y > 200)) {
    event.context.drop();
    return;
  }

  if (event.x !== undefined) event.set('x', event.x - 10_000);
  if (event.z !== undefined) event.set('z', event.z + 4_000);
});

session.pipeline.onEvent('blockInteraction', (event) => {
  const y =
    event.y ??
    (event.context.data as { location?: { y?: number } }).location?.y;
  if (y !== undefined && (y < 50 || y > 200)) event.context.drop();
});
```

Coordinate edits are ordinary packet transformations. Plugins must transform every relevant packet for their protocol and direction if they need a consistent shifted view. The API does not claim that this hides coordinates against every packet or server behavior.

## Recipient-specific packets and direct writes

Register handlers on `participant.pipeline` to change one participant's view. Session handlers run first. Each participant then receives an isolated packet context.

Direct writes require ownership data. Upstream writes need the current participant ID and control generation. Downstream writes need a target participant ID. A generation captured before a switch is rejected.

```ts
const participant = session.participants.get(participantId);
if (!participant) throw new Error('Participant left');

participant.pipeline.on('system_chat', (packet) => {
  packet.drop();
});

session.writeRaw('c2s', rawPacket, {
  sourceParticipantId: participant.id,
  controlGeneration: session.controlGeneration,
});
```

Unknown or malformed packets produce a console warning and continue as raw bytes. Parsed edits that cannot serialize also fall back to the original bytes. Debug capture records both directions, failures, drops, modifications, injection counts, participant IDs, and sequence metadata. It stops when the configured disk limit is reached.
