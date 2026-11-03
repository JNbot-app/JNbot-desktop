# Minecraft protocol alignment specification

## Introduction and system model

This component is a version-aware Minecraft protocol gateway. It admits a client, negotiates the protocol state required by that client version, exercises the client-side behaviors needed by the target server, and then hands the session to the configured destination.

The alignment flow has seven phases:

1. Inbound network filtering and connection admission
2. Login handshake and modern configuration-state negotiation
3. World simulation and gravity trajectory alignment
4. Window transactions and active-inventory synchronization
5. Vehicle kinematics and input-stream alignment
6. Visual map interaction
7. Session completion, credential persistence, and destination routing

Each phase checks a defined part of the Minecraft network protocol or the client-side physics model used by the official game engine.

## Inbound connection filtering and admission

The admission layer limits resource use before a session is allocated and keeps connection bursts within the gateway's configured capacity.

When a client initiates a TCP handshake, the gateway inspects the packet parameters. It accepts protocol versions in the supported range from 1.7.2 through modern releases. Connections that declare an unknown, snapshot, or unsupported protocol version are rejected immediately.

An address-based rate limiter enforces a minimum interval between connection attempts from the same source. An online session counter also limits simultaneous connections from one network address. When the configured concurrent-session threshold is reached, additional attempts are denied.

The gateway keeps a cumulative connection penalty for repeated unsuccessful alignment attempts. Each failed attempt from a network address increments its score. When the score reaches the configured threshold, later connections from that address are blocked before entering the alignment flow. Scores expire automatically after the configured duration.

To avoid repeating the flow for an already aligned player, the gateway computes a deterministic session fingerprint from the player username and network address. The derivation uses the standard thirty-two-bit integer hash of each value:

```
first_hash = hash(username)
second_hash = hash(host_address)
combined_hash = first_hash + second_hash
```

The final fingerprint concatenates the hexadecimal representation of `first_hash` shifted right by four bits, `combined_hash` shifted left by two bits, and `second_hash` shifted right by four bits. A local cache and persistent database store fingerprints for previously aligned players. When an incoming connection matches a valid record, the gateway skips the alignment flow and sends the player directly to the destination server.

Connections that require alignment enter a thread-safe admission queue. A periodic scheduler polls a batch of queued connections at regular intervals and moves them into active alignment. The queue prevents thread exhaustion and absorbs bursts of simultaneous join attempts.

The session has an aggregate packet quota. The maximum packet budget is the sum of the maximum movement ticks, the countdown duration multiplied by twenty ticks, four packets per vehicle stage, the maximum number of map-response attempts, and a configurable headroom allowance. Exceeding the quota closes the channel immediately. Packet decoders also require each decoded payload to contain no unread trailing bytes. Buffers that do not fully decode are rejected.

Connections established through Bedrock translation bridges such as Floodgate are identified by an external proxy port equal to zero or by session attributes. Bedrock sessions may use a selective bypass or a tailored alignment path.

## Login and configuration protocol negotiation

After admission from the queue, the connection enters authentication and setup.

The initial exchange follows this sequence:

1. **Client Handshake.** The client sends the target protocol version, server hostname, port, and next protocol state. The requested state must be `2` for login, and the hostname must not be empty.
2. **Client Login Start.** The client sends its declared username. The username must contain three to sixteen alphanumeric characters or underscores.
3. **Server Login Success.** The server sends a randomly generated session UUID and a profile name truncated to sixteen characters.

The next steps depend on protocol version and client edition.

For versions before 1.20.2, the connection moves directly into the play state. Versions 1.8 through 1.20.1 receive a pre-join keep-alive containing a randomized integer token. The client must return the same token before the server sends world packets. Versions older than 1.8 observe a one-hundred-millisecond delay before the connection proceeds.

For version 1.20.2 and newer, the configuration state sits between login and play:

4. **Client Login Acknowledged.** The client acknowledges login success. Only one acknowledgment is allowed. A duplicate disconnects the session.
5. **Server Keep Alive.** After entering configuration, the server sends a keep-alive with a unique non-zero integer token.
6. **Client Keep Alive.** The client returns the identical token. A mismatch terminates the session.
7. **Server Registry Data and Tags.** The server sends registry codec definitions for the client version. Version 26.1 and newer also receive an update-tags packet containing network tag compounds.
8. **Server Finish Configuration.** The server signals that configuration definitions are complete.
9. **Client Information.** Java Edition clients send their configuration settings. The view-distance integer must be at least two chunks. Bedrock clients translated through Floodgate are exempt.
10. **Client Plugin Message.** Java Edition clients send a client-brand string on `minecraft:brand` or the legacy `MC|Brand` channel. The payload must be longer than one byte and no larger than the configured maximum. On version 1.8 and newer, the leading length-prefix byte is omitted. The decoded UTF-8 brand must match the authorized regular expression. Duplicate brand packets are not allowed. Bedrock clients are exempt from brand validation.
11. **Client Finish Configuration.** The client acknowledges the completed configuration phase, after which the network state changes to play.

## World simulation and gravity trajectory alignment

This phase checks that the client applies the expected Minecraft movement and collision rules.

The server creates a lightweight virtual world with the following server-to-client sequence:

1. **Server Join Game.** Sends the player entity identifier, configured gamemode identifier, overworld dimension name, flat-world preset type, and a randomized world-seed hash.
2. **Server Player Abilities.** Sends base capability bitmasks for the initial player state.
3. **Server Set Default Spawn Position.** On versions 1.19.3 and newer, sets the global spawn position at horizontal chunk center X `8.0`, vertical altitude between `3000` and `3500`, and horizontal chunk center Z `8.0`.
4. **Server Teleportation.** Chooses a randomized integer platform height between `1` and `255` and computes the theoretical fall distance for the configured movement-tick duration by iterating:

   ```
   motion_step = (motion_step - 0.1) * 0.98
   ```

   The dynamic fall-start height is the platform base height plus the ceiling of the accumulated distance. The server sends two successive position teleports:

   - The first moves the player to an elevated altitude between `3000` and `3500`, with X `8.0` and Z `8.0`, a randomized teleport identifier, and absolute-coordinate flags.
   - The second sets X `8.0`, Z `8.0`, yaw `0.0`, and pitch `-90.0` looking downward. Its relative-coordinate bitmask is `2`, indicating relative vertical motion. The transmitted vertical value is the dynamic fall-start height minus the elevated altitude.

   Versions before 1.8, which do not have relative teleport flags, receive one absolute teleport directly to the dynamic fall-start position.

5. **Server Chunk Data and World Event.** On versions 1.20.3 and newer, game event `13` announces incoming chunks, followed by empty chunk data for nine chunk columns centered on the player. Earlier versions receive one empty chunk column at chunk coordinates zero and zero.
6. **Server Section Block Update.** Builds an eight-by-eight solid platform at the randomized height, centered at X `8.0` and Z `8.0`, covering coordinates `4` through `11` on both horizontal axes. One of seven materials is selected at random, with these collision heights:

   - Enchantment Table: `0.75` blocks
   - Trapdoor: `0.1875` blocks
   - End Portal Frame: `0.8125` blocks
   - Daylight Sensor: `0.375` blocks
   - Cobblestone Wall: `1.5` blocks
   - Stone Slab: `0.5` blocks
   - White Carpet: `0.0625` blocks on version 1.8 and newer, or `0.0` blocks earlier

The expected client responses and movement rules are:

1. **Teleport Confirmation.** On versions 1.9 and newer, the client confirms the first teleport identifier and then the second. Duplicate confirmations or unexpected identifiers fail the phase. On version 1.21.2, the client sends its position-rotation packet before teleport confirmation. Earlier versions send confirmation first. Versions 1.8 and older do not have teleport confirmations, so movement tracking starts immediately.
2. **Client Tick End.** On version 1.21.2 and newer, the client interleaves client-tick-end packets with movement packets. A position update without an intervening tick-end packet, or no movement report for twenty consecutive client ticks, fails the phase.
3. **Initial Post-Teleport Movement.** The first movement packet after teleportation must be a position-and-rotation packet. X and Z must each equal exactly `8.0`, ground status must be `false`, and the vertical displacement from the previous teleport coordinate must be zero. On version 1.7, the first position packet immediately increments the movement-tick counter. Bedrock clients are exempt from the strict initial zero-displacement check.
4. **Successive Falling Movement.** Java Edition clients fall toward the platform while sending position packets. Bedrock clients are exempt from the rigid gravity calculation. The expected vertical velocity follows:

   ```
   predicted_velocity = (previous_velocity - 0.08) * 0.98
   ```

   For each tick, actual displacement is current Y minus previous Y. The gateway calculates:

   ```
   deviation = absolute(actual_displacement - predicted_velocity)
   ```

   Deviation must not exceed `1e-7` units. Linear movement, zero gravity, and an incorrect drag factor do not conform to the expected model. Horizontal coordinates must remain within the platform, with absolute deviation from its center below eight blocks. The vertical coordinate must not pass below the platform base level.
5. **Platform Contact.** On reaching the surface, the client sends a movement packet with ground status `true`. Elapsed movement ticks must equal or exceed the expected fall duration, and the reported Y must equal the platform surface, calculated as platform base height plus the block collision height. Any non-zero collision offset fails the check.

When visual fallback is enabled, a gravity or collision mismatch routes the client to the visual map phase instead of closing the connection immediately.

## Protocol responsiveness and window transactions

This phase checks bidirectional packet contracts for the active inventory. Bedrock clients skip it because of translation-layer incompatibilities.

1. **Inventory Transaction.** The server sends a window transaction for window identifier `0`, a randomized negative short action number, and accepted `false`. Under vanilla protocol rules, the client inventory engine returns a transaction confirmation for window `0` with the same negative short action number and accepted `true`. A different window identifier or acceptance status fails the phase.
2. **Hotbar Slot Synchronization.** The server sends an invalid slot selection with index `-1`, then a valid slot change. The target slot is the player's current slot plus a random integer from `1` through `7`, modulo `8`. The client sends an active-held-item packet for a target slot from `0` through `8`. Afterward, the server confirms synchronization with another negative transaction ping.
3. **Main-Hand Animation.** The server sends an entity-animation packet for the player's own entity identifier with the swing-main-arm action. The client returns an animation packet for a main-hand arm swing. Before version 1.8, the response contains the player entity identifier and the legacy swing-arm animation type.

## Vehicle kinematics and input-stream alignment

The gateway can optionally place the client in a mounted state to exercise vehicle behavior.

1. **Vehicle Spawn and Passenger Assignment.** The server sends a spawn-entity packet for a boat at an altitude between `3000` and `3500`, then a set-passengers packet attaching the player. A keep-alive exchange synchronizes the state change.
2. **Boat Kinematics Stream.** While mounted, the client sends:

   - **Vehicle Move packets.** The client reports vehicle coordinates. Boat downward acceleration follows `predicted_boat_velocity = previous_boat_velocity - 0.03999999910593033`. The difference between reported vehicle displacement and predicted velocity must remain below `1e-7` units.
   - **Paddle Boat packets.** Versions 1.9 and newer send left- and right-paddle states. Earlier versions have no paddle packets and are exempt.
   - **Player Input packets.** Before version 1.21.2, the client sends floating-point forward and sideways movement values. Each absolute value must not exceed `0.98`. Version 1.21.2 and newer clients do not send player-input packets while in vehicles. The gateway evaluates rotation packets instead.
   - **Packet cadence.** Rotation, paddle, and vehicle-move packet counts must remain consistent with input packets. Each of the three counts must equal or exceed the input count.

3. **Vehicle Dismount and Minecart Transition.** After the configured minimum packet threshold, the server sends remove-entities to destroy the boat. The client then sends falling position packets with ground status `false` and a vertical coordinate below the last boat position. The server spawns a minecart sixteen blocks below the elevated altitude and mounts the player. During the minecart phase, the client sends rotation and input packets without vehicle-move packets. Completing both vehicle stages completes this alignment layer.

## Visual map interaction

When configured as an additional interaction step, during active connection pressure, or as fallback after a physics mismatch, the server presents an interactive visual map.

1. **Map generation and delivery.** The server generates a `128` by `128` pixel image containing distorted alphanumeric characters, background noise, and color variations. It converts the pixels to the indexed Minecraft map-color palette.
2. **Client equipment and map data.** The server sends a set-container-slot packet placing a filled map with map identifier `0` into hotbar container slot `36` plus a randomized slot offset. On version 1.9 and newer, offhand slot `45` may be used. A held-item packet selects the active slot. The server then sends map data containing the complete `128` by `128` byte array of palette indices.
3. **Player suspension and perspective.** The server teleports the player to X `8.0`, Y `10000.0`, Z `8.0`, with pitch `90.0` looking vertically down at the held map. Player-abilities packets lock movement and flight using bitmask `0x02` for Java Edition and `0x06` for Bedrock.
4. **Timer and keep-alive.** Each second, set-experience packets update the experience bar with the remaining time. Keep-alive packets are sent every twenty movement updates.
5. **Chat submission.** The player reads the characters and sends the response in a system-chat packet. The server compares the packet's lowercase content with the generated answer. An exact match completes the phase. For an incorrect answer, the server sends an error message and decrements the remaining-attempt counter. Exceeding the maximum attempts or duration closes the connection.

## Session completion and handoff

After the client completes the required stages, the alignment handler runs the session-completion routines.

The gateway increments the global alignment-success counter and records the successful user's fingerprint and current timestamp in the persistent database.

For Minecraft 1.20.5 and newer, the server uses the native protocol transfer packet. It sends the target backend host and port so the client can move to the destination without closing the underlying connection. For Bedrock connections, the transfer packet is written and network codecs are stripped without closing the underlying socket.

For earlier versions, the server sends a disconnect packet with a friendly alignment-success notice. When the player reconnects, the inbound admission filter matches the cached session fingerprint and admits the player directly to the backend without repeating the alignment flow.

If a check fails, the alignment handler increments the failed-alignment counter, logs the reason with the client network address and protocol version, increments the address penalty score, and disconnects the channel.
