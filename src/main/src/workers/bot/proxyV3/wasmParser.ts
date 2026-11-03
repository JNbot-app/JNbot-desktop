/**
 * WASM-backed, tolerant packet deserializer — a drop-in for
 * {@link installTolerantDeserializer}.
 *
 * Why: a transparent proxy forwards *every* packet by raw bytes and only
 * decodes to *inspect* (pipeline, recorder, command detection). The bundled
 * minecraft-data schema occasionally can't decode bleeding-edge packets; the
 * stock JS parser then either drops them (desync) or throws (disconnect), and
 * {@link installTolerantDeserializer} works around that by forwarding raw on any
 * failure. This does the same, but the *successful* path runs on the Rust/WASM
 * parser (`mcPacketParser`) instead of the JS protodef interpreter:
 *
 *   - faster, and immune to OOM from a bogus length field;
 *   - decodes packets the JS schema chokes on, so the recorder/plugins see real
 *     `{ name, params }` instead of `unknown_<id>`.
 *
 * We replace only the deserializer's `_transform`. The client's own `'data'`
 * handler still runs afterwards (it sets `metadata.name`/`metadata.state`,
 * unwraps `data.params`, and does bundle assembly), so every downstream
 * `client.on('packet', …)` listener is unaffected. The deserializer is recreated
 * on each protocol-state change, so we re-apply on every `'state'` event.
 *
 * If the WASM module or the protocol can't be loaded, the installer throws and
 * the caller falls back to {@link installTolerantDeserializer}.
 */
import path from 'path';
import minecraftData from 'minecraft-data';
import type { Client } from 'minecraft-protocol';

import {
  installTolerantDeserializer,
  readPacketId,
  type RawPacketHandler,
} from './tolerantParser';

const PATCHED = Symbol('proxyWasmPatched');
const isPackaged =
  process.env.NODE_ENV === 'production' &&
  typeof (process as any).resourcesPath === 'string';

// Minimal shape of the wasm `Session` class we use (see mcPacketParser/pkg).
interface WasmSession {
  parsePacket(
    state: string,
    direction: 'toClient' | 'toServer',
    data: Uint8Array,
  ): { data: { name: string; params: unknown }; size: number };
}
interface WasmModule {
  Session: new (protocolJson: string) => WasmSession;
}

/** Directory holding the copied `mc_packet_parser.js` + `*_bg.wasm`. */
function pkgDir(): string {
  // Mirrors the esbuild-wasm scheme (see functions/transpile.ts): copied into
  // dist/main/src/mc-packet-parser at build time, shipped via extraResources.
  return isPackaged
    ? path.join((process as any).resourcesPath, 'src', 'mc-packet-parser')
    : path.join(
        process.cwd(),
        'release',
        'app',
        'dist',
        'main',
        'src',
        'mc-packet-parser',
      );
}

let wasm: WasmModule | null = null;

function loadWasm(): WasmModule {
  if (wasm) return wasm;
  // Indirect require so esbuild leaves it as a runtime require: the wasm-bindgen
  // node glue reads its `_bg.wasm` relative to its own __dirname, so the file
  // must stay on disk next to the glue rather than be inlined into the bundle.
  const nodeRequire = require;
  wasm = nodeRequire(path.join(pkgDir(), 'mc_packet_parser.js')) as WasmModule;
  return wasm;
}

const sessions = new Map<string, WasmSession>();
const packetNames = new Map<string, Map<number, string>>();

function sessionFor(version: string): WasmSession {
  let session = sessions.get(version);
  if (session) return session;
  const protocol = (minecraftData(version) as { protocol?: unknown })?.protocol;
  if (!protocol) throw new Error(`no protocol.json for version ${version}`);
  session = new (loadWasm().Session)(JSON.stringify(protocol));
  sessions.set(version, session);
  return session;
}

function packetNameFor(
  version: string,
  state: string,
  direction: 'toClient' | 'toServer',
  packetId: number,
): string | undefined {
  const key = `${version}:${state}:${direction}`;
  let names = packetNames.get(key);
  if (!names) {
    names = new Map();
    const packet = (minecraftData(version) as any)?.protocol?.[state]?.[
      direction
    ]?.types?.packet;
    const mappings = packet?.[1]?.[0]?.type?.[1]?.mappings;
    for (const [id, name] of Object.entries(mappings ?? {}))
      names.set(Number(id), name as string);
    packetNames.set(key, names);
  }
  return names.get(packetId);
}

/**
 * Replace `client`'s deserializer with the WASM parser. `onRaw` receives the
 * raw (already-decompressed) body of any packet that fails to decode, exactly
 * like {@link installTolerantDeserializer}.
 *
 * Throws synchronously if the WASM module or this version's protocol can't be
 * loaded — callers should catch and fall back to the JS parser.
 */
export function installWasmDeserializer(
  client: Client,
  onRaw: RawPacketHandler,
  shouldDecode?: (name: string | undefined, state: string) => boolean,
): void {
  const anyClient = client as any;
  // Direction of packets arriving on this socket (server reads c2s, client s2c).
  const direction: 'toClient' | 'toServer' = anyClient.isServer
    ? 'toServer'
    : 'toClient';
  // Validate eagerly so installation fails fast (and the caller can fall back).
  const session = sessionFor(client.version);

  const patch = () => {
    const des = anyClient.deserializer;
    if (!des || des[PATCHED]) return;
    des[PATCHED] = true;

    // Bind the state for this deserializer instance, matching the library's own
    // per-instance `state` closure (a new deserializer is made per state change).
    const state: string = anyClient.protocolState ?? client.state;

    des._transform = function (
      chunk: Buffer,
      _enc: unknown,
      cb: (err?: Error) => void,
    ) {
      // ProtoDef mutates a few packet buffers while decoding. A transparent
      // proxy must always retain the original bytes for forwarding.
      const raw = Buffer.from(chunk);
      const packetId = readPacketId(raw);
      const name = packetNameFor(client.version, state, direction, packetId);
      if (shouldDecode && !shouldDecode(name, state)) {
        try {
          onRaw(raw, name);
        } catch (error) {
          console.error('[proxy] raw forward handler failed:', error);
        }
        cb();
        return;
      }
      try {
        const res = session.parsePacket(
          state,
          direction,
          raw as unknown as Uint8Array,
        );
        this.push({
          data: res.data,
          metadata: { size: res.size },
          buffer: raw.subarray(0, res.size),
          fullBuffer: raw,
        });
      } catch (wasmError) {
        try {
          const parsed = des.proto.parsePacketBuffer(
            des.mainType,
            Buffer.from(raw),
          );
          if (parsed) {
            parsed.buffer = raw.subarray(0, parsed.metadata.size);
            parsed.fullBuffer = raw;
            console.warn(
              `[proxy] WASM decoder fell back to ProtoDef for ${state} ${direction} packet (id=${readPacketId(raw)}):`,
              (wasmError as Error)?.message || wasmError,
            );
            this.push(parsed);
            cb();
            return;
          }
        } catch (protoError) {
          console.warn(
            `[proxy] Failed to decode ${state} ${direction} packet (id=${readPacketId(raw)}, length=${raw.length}) [wasm: ${(wasmError as Error)?.message || wasmError}; protodef: ${(protoError as Error)?.message || protoError}]`,
          );
        }
        console.warn(
          `[proxy] forwarding undecodable ${state} ${direction} packet (id=${readPacketId(raw)}, length=${raw.length})`,
        );
        try {
          onRaw(raw);
        } catch (error) {
          console.error('[proxy] raw forward handler failed:', error);
        }
      }
      cb();
    };
  };

  patch();
  client.on('state', patch);
}

let warnedFallback = false;

/**
 * Install the WASM parser, transparently falling back to the JS tolerant parser
 * if the WASM module or this version's protocol can't be loaded. Same signature
 * as {@link installTolerantDeserializer}, so it's a 1:1 swap at the call site.
 */
export function installPacketParser(
  client: Client,
  onRaw: RawPacketHandler,
  shouldDecode?: (name: string | undefined, state: string) => boolean,
): void {
  try {
    installWasmDeserializer(client, onRaw, shouldDecode);
  } catch (error) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(
        '[proxy] WASM packet parser unavailable, using JS parser:',
        (error as Error)?.message,
      );
    }
    const direction: 'toClient' | 'toServer' = (client as any).isServer
      ? 'toServer'
      : 'toClient';
    installTolerantDeserializer(
      client,
      onRaw,
      shouldDecode
        ? (raw, state) =>
            shouldDecode(
              packetNameFor(
                client.version,
                state,
                direction,
                readPacketId(raw),
              ),
              state,
            )
        : undefined,
    );
  }
}
