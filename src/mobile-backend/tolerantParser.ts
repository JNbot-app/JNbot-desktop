import type { Client } from 'minecraft-protocol';
import { installTolerantDeserializer, type RawPacketHandler } from '../main/src/workers/bot/proxyV3/tolerantParser';

/** The mobile bundle intentionally omits the optional Rust/WASM packet parser. */
export function installPacketParser(client: Client, onRaw: RawPacketHandler): void {
  installTolerantDeserializer(client, onRaw);
}
