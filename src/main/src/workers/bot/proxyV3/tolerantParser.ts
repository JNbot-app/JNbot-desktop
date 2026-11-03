/**
 * Makes a {@link Client}'s packet deserializer tolerant of parse failures.
 *
 * Why this exists: a transparent proxy must forward *every* packet, but the
 * bundled `minecraft-data` schemas are not always perfect — on bleeding-edge
 * versions (1.20+, 1.21+) some server -> client packets (e.g. `world_particles`,
 * registry data) fail to deserialize. node-minecraft-protocol's stock
 * `FullPacketParser` reacts to that by either:
 *   - `partialReadError` -> `console.log(stack)` and silently *dropping* the
 *     packet (the "spam" + a desynced stream missing data), or
 *   - any other error -> emitting a fatal `'error'` (which our Connection turns
 *     into a disconnect).
 * Both are wrong for a passthrough proxy. We only decode to *inspect*; if a
 * packet can't be decoded we still want its raw bytes forwarded verbatim.
 *
 * This replaces the deserializer's `_transform` so that on any parse error it
 * hands the raw (already decompressed) packet body to `onRaw` and continues,
 * instead of logging/dropping/erroring. Parseable packets are pushed unchanged,
 * so the library's normal `'packet'` event still fires for them.
 *
 * The deserializer is recreated by the library on every protocol-state change
 * (`setSerializer`), so we re-apply the patch on each `'state'` event as well as
 * once immediately for the current state.
 */
import type { Client } from 'minecraft-protocol';

const PATCHED = Symbol('proxyTolerantPatched');

export type RawPacketHandler = (chunk: Buffer, name?: string) => void;
export type DecodeGate = (chunk: Buffer, state: string) => boolean;

export function installTolerantDeserializer(
  client: Client,
  onRaw: RawPacketHandler,
  shouldDecode?: DecodeGate,
): void {
  const anyClient = client as any;

  const patch = () => {
    const des = anyClient.deserializer;
    if (!des || des[PATCHED]) return;
    des[PATCHED] = true;

    const proto = des.proto;
    const mainType = des.mainType;
    const state: string = anyClient.protocolState ?? client.state;

    des._transform = function (
      chunk: Buffer,
      _enc: unknown,
      cb: (err?: Error) => void,
    ) {
      // Some minecraft-protocol datatypes mutate their input while decoding.
      // In particular topBitSetTerminatedArray clears continuation bits in
      // entity_equipment. Preserve the wire bytes before parsing so transparent
      // forwarding never sends the parser's modified buffer.
      const raw = Buffer.from(chunk);
      if (shouldDecode && !shouldDecode(raw, state)) {
        try {
          onRaw(raw);
        } catch (error) {
          console.error('[proxy] raw forward handler failed:', error);
        }
        cb();
        return;
      }
      let packet;
      try {
        packet = proto.parsePacketBuffer(mainType, chunk);
        if (packet) {
          packet.buffer = raw.subarray(0, packet.metadata.size);
          packet.fullBuffer = raw;
        }
      } catch (err) {
        console.warn(
          `[proxy] Failed to parse ${mainType} packet (id=${readPacketId(raw)}, length=${raw.length}):`,
          (err as Error)?.message || err,
        );
        try {
          onRaw(raw);
        } catch (error) {
          console.error('[proxy] raw forward handler failed:', error);
        }
        return cb();
      }
      this.push(packet);
      cb();
    };
  };

  patch();
  client.on('state', patch);
}

/**
 * Reads the leading VarInt packet id from a decompressed packet body. Used only
 * to give unparseable packets a human-readable label (`unknown_<id>`) for the
 * recorder / debug views — forwarding itself never needs it.
 */
export function readPacketId(buffer: Buffer): number {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < buffer.length && i < 5; i++) {
    const byte = buffer[i];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return value >>> 0;
}
