import { createDeserializer } from 'minecraft-protocol';

/** Minecraft 64-bit fields decode as BigInt, which JSON.stringify throws on. */
const jsonSafe = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

/**
 * Decode the raw packets of a recording's NDJSON data (`r`, written by the
 * proxy recorder) into params (`p`). Lines that already have params are kept
 * as they are; a packet that can't be decoded keeps its bytes, flagged.
 */
export function decodeRecording(data: string, version: string): string {
  const parsers = new Map<string, ReturnType<typeof createDeserializer>>();
  const parserFor = (state: string, direction: string) => {
    const key = `${state}:${direction}`;
    let parser = parsers.get(key);
    if (!parser) {
      parser = createDeserializer({ state, version, isServer: direction === 'c2s', noErrorLogging: true });
      parsers.set(key, parser);
    }
    return parser;
  };

  return data
    .split('\n')
    .map((line) => {
      if (!line.includes('"r":')) return line;
      try {
        const { r, ...packet } = JSON.parse(line);
        try {
          const parsed = parserFor(packet.m?.phase ?? 'play', packet.d ?? 'c2s').parsePacketBuffer(
            Buffer.from(r, 'base64'),
          );
          packet.p = parsed.data.params;
        } catch (error) {
          packet.p = { __unparsed: true, error: (error as Error).message, raw: r };
        }
        return JSON.stringify(packet, jsonSafe);
      } catch {
        return line;
      }
    })
    .join('\n');
}
