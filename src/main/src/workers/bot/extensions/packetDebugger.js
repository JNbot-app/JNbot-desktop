'use strict';

/**
 * packetDebugger — a development-only mineflayer plugin that pinpoints which
 * server->client packet causes a minecraft-protocol parse failure such as:
 *
 *   Parse error for play.toClient: Read error for undefined : array size is
 *   abnormally large, not reading: 1634888543
 *
 * Why this is hard to debug by default: the inbound pipeline is
 *   socket -> splitter -> [decompressor] -> deserializer (FullPacketParser)
 * The splitter frames each packet by its length prefix, so every chunk handed
 * to the deserializer is *exactly one packet*. When the deserializer throws,
 * minecraft-protocol's FullPacketParser calls cb(err) WITHOUT attaching the
 * buffer (only the streaming Parser does), so the emitted error has no packet
 * name and no bytes — just "play.toClient". This plugin captures the chunk on
 * its way into the deserializer, so on failure we know the exact bytes and can
 * decode the leading varint (the packet id) to name the offending packet.
 *
 * Overhead: one extra closure call per inbound packet + a small rolling history
 * of packet headers. Safe to leave on in development; gate it off in prod.
 *
 * Enable via join.js when `verbose`, `global.appSettings.debugPackets === true`,
 * or env `NMP_PACKET_DEBUG=1`.
 */

const fs = require('fs');
const path = require('path');
const { workerData } = require('worker_threads');

const HISTORY_SIZE = 64; // recent packets kept for context in the dump
const HISTORY_HEX = 32; // bytes of head-hex kept per history entry
const MAX_DUMP_HEX = 1 << 18; // cap full hex of the failing packet (256 KiB)
const TIMELINE_SIZE = 200; // bidirectional packet timeline kept for kick dumps
const PREVIEW_MAX = 4000; // cap per-packet params preview in the timeline

/** JSON-stringify packet params for the timeline, taming Buffers/BigInts/size. */
function safePreview(obj) {
  try {
    let s = JSON.stringify(obj, (k, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (Buffer.isBuffer(v)) return `<Buffer ${v.length}b ${v.toString('hex').slice(0, 32)}>`;
      if (v && v.type === 'Buffer' && Array.isArray(v.data)) return `<Buffer ${v.data.length}b>`;
      return v;
    });
    if (s === undefined) s = String(obj);
    return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) + ' …(truncated)' : s;
  } catch (e) {
    return '<unserializable: ' + e.message + '>';
  }
}

/** Decode a Minecraft VarInt at `offset`. Returns {value, size}; value=-1 on truncation. */
function readVarInt(buf, offset = 0) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result >>> 0, size: pos - offset };
    shift += 7;
    if (shift > 35) break;
  }
  return { value: -1, size: pos - offset };
}

const injectPacketDebugger = (bot, pluginOptions = {}) => {
  const client = bot._client;
  if (!client || client.__packetDebuggerInstalled) return;
  client.__packetDebuggerInstalled = true;

  const log =
    typeof global !== 'undefined' && typeof global.log === 'function'
      ? global.log
      : (m) => console.log(m);

  const history = []; // ring buffer of recent inbound packets (parse-fail dump)
  const idToName = {}; // learned at runtime: state -> { id: name }
  const mapperCache = {}; // minecraft-data fallback: "version:state" -> { id: name }

  const timeline = []; // bidirectional ring of recent packets (kick/disconnect dump)
  const startedAt = Date.now();
  const keepAlive = { in: 0, out: 0 }; // counted, not stored, so they don't flood the ring

  function remember(entry) {
    history.push(entry);
    if (history.length > HISTORY_SIZE) history.shift();
  }

  function track(entry) {
    // keep_alive is high-frequency noise that would push the meaningful
    // handshake packets out of the ring; count it instead of storing it.
    if (entry.name === 'keep_alive') {
      if (entry.dir === 'S->C') keepAlive.in++;
      else if (entry.dir === 'C->S') keepAlive.out++;
      return;
    }
    entry.t = Date.now();
    timeline.push(entry);
    if (timeline.length > TIMELINE_SIZE) timeline.shift();
  }

  // Learn id -> name from every successfully parsed inbound packet. This is
  // version-agnostic and reflects the exact protocol in use, so even on heavily
  // modded servers the failing id usually resolves to a real name.
  client.on('raw', (buffer, meta) => {
    try {
      const { value: id } = readVarInt(buffer, 0);
      const state = meta.state;
      (idToName[state] || (idToName[state] = {}))[id] = meta.name;
      remember({
        dir: 'S->C',
        state,
        name: meta.name,
        id,
        len: buffer.length,
        hex: buffer.toString('hex').slice(0, HISTORY_HEX * 2),
        t: Date.now(),
      });
    } catch {
      /* never let debugging break the connection */
    }
  });

  // minecraft-data fallback for ids we have not seen parse successfully yet.
  function mcDataName(version, state, id) {
    try {
      const key = version + ':' + state;
      if (!mapperCache[key]) {
        const mcData = require('minecraft-data')(version);
        const packet = mcData.protocol?.[state]?.toClient?.types?.packet;
        const nameField = packet?.[1]?.find?.((f) => f.name === 'name');
        const mappings = nameField?.type?.[1]?.mappings; // { "0x00": "name", ... }
        const map = {};
        if (mappings) {
          for (const k in mappings) map[parseInt(k, 16)] = mappings[k];
        }
        mapperCache[key] = map;
      }
      return mapperCache[key][id];
    } catch {
      return undefined;
    }
  }

  function nameForId(state, id) {
    return idToName[state]?.[id] ?? mcDataName(bot.version, state, id) ?? '?';
  }

  function writeDump(text, name) {
    try {
      const baseDir =
        pluginOptions.dir ||
        (workerData?.paths?.recordings
          ? path.join(path.dirname(workerData.paths.recordings), 'packet-debug')
          : path.join(process.cwd(), 'packet-debug'));
      fs.mkdirSync(baseDir, { recursive: true });
      const safe = String(name || 'unknown').replace(/[^a-z0-9_]/gi, '_');
      const file = path.join(baseDir, `parsefail-${Date.now()}-${safe}.txt`);
      fs.writeFileSync(file, text);
      log('[packetDebugger] full dump written to ' + file, 'warning');
    } catch (e) {
      log('[packetDebugger] could not write dump: ' + e.message, 'error');
    }
  }

  function dumpFailure(chunk, state, err) {
    try {
      const { value: id } = readVarInt(chunk, 0);
      const name = nameForId(state, id);
      const hex = chunk.toString('hex');
      const idHex = id >= 0 ? '0x' + id.toString(16) : '?';

      const lines = [];
      lines.push('================ PACKET PARSE FAILURE ================');
      lines.push(`time       : ${new Date().toISOString()}`);
      lines.push(
        `bot        : ${bot.username} @ ${client.socket?.remoteAddress || '?'}:${
          client.socket?.remotePort || '?'
        }  (mc ${bot.version})`,
      );
      lines.push(`state      : ${state}`);
      lines.push(`failed pkt : id=${idHex} (${id})  name=${name}`);
      lines.push(`error      : ${err.message}`);
      if (err.field) lines.push(`field      : ${err.field}`);
      lines.push(`length     : ${chunk.length} bytes`);
      lines.push(
        `full hex   : ${hex.slice(0, MAX_DUMP_HEX * 2)}${
          hex.length > MAX_DUMP_HEX * 2 ? ' …(truncated)' : ''
        }`,
      );
      lines.push('');
      lines.push(
        `--- last ${history.length} inbound packets before failure (oldest first) ---`,
      );
      for (const h of history) {
        lines.push(
          `  ${h.dir} ${h.state}/${h.name} id=0x${h.id.toString(16)} ${h.len}b  ${h.hex}`,
        );
      }
      lines.push('=====================================================');

      // Concise line in the live console for immediate triage.
      log(
        `[packetDebugger] PARSE FAILED on '${name}' (id ${idHex}, ${chunk.length}b) in state '${state}': ${err.message}`,
        'error',
      );
      log(
        `[packetDebugger] recent packets: ${history
          .slice(-8)
          .map((h) => h.name)
          .join(' -> ')}`,
        'error',
      );
      writeDump(lines.join('\n'), name);
    } catch (e) {
      log('[packetDebugger] error while building dump: ' + (e?.stack || e), 'error');
    }
  }

  // The deserializer is recreated on every protocol state change (see
  // Client#setSerializer), so re-wrap whenever state changes.
  function wrapDeserializer() {
    const des = client.deserializer;
    if (!des || des.__pdWrapped) return;
    des.__pdWrapped = true;
    const orig = des._transform;
    des._transform = function (chunk, enc, cb) {
      orig.call(this, chunk, enc, (err) => {
        if (err) dumpFailure(chunk, client.state, err);
        cb(err);
      });
    };
  }

  wrapDeserializer();
  client.on('state', wrapDeserializer);

  // ---- bidirectional timeline (for "internal error" / kick diagnosis) -------
  // A server-side kick like "An internal error occurred in your connection"
  // means the *server* threw while handling us — almost always because we sent
  // a packet it couldn't decode. The inbound parse tracer can't see that, so we
  // also record everything we SEND and RECEIVE (with params) plus state changes,
  // and dump the tail when the connection is kicked/ends.

  // Inbound: full parsed packet incl. params.
  client.on('packet', (data, meta) => {
    try {
      track({ dir: 'S->C', state: meta.state, name: meta.name, preview: safePreview(data) });
    } catch {
      /* never break the connection for debugging */
    }
  });

  // Outbound: hook client.write so we capture exactly what we send, with params.
  if (typeof client.write === 'function' && !client.__pdWriteWrapped) {
    client.__pdWriteWrapped = true;
    const origWrite = client.write.bind(client);
    client.write = function (name, params) {
      try {
        track({ dir: 'C->S', state: client.state, name, preview: safePreview(params) });
      } catch {
        /* ignore */
      }
      return origWrite(name, params);
    };
  }

  function dumpTimeline(tag, reason) {
    try {
      const reasonStr =
        typeof reason === 'string' ? reason : reason != null ? safePreview(reason) : '(none)';
      const lines = [];
      lines.push('================ PACKET TIMELINE DUMP ================');
      lines.push(`time       : ${new Date().toISOString()}`);
      lines.push(`trigger    : ${tag}`);
      lines.push(
        `bot        : ${bot.username} @ ${client.socket?.remoteAddress || '?'}:${
          client.socket?.remotePort || '?'
        }  (mc ${bot.version})`,
      );
      lines.push(`last state : ${client.state}`);
      lines.push(`uptime     : ${Date.now() - startedAt} ms`);
      lines.push(`keep_alive : ${keepAlive.in} in / ${keepAlive.out} out (collapsed)`);
      lines.push(`reason     : ${reasonStr}`);
      lines.push('');
      lines.push(
        `--- last ${timeline.length} packets, keep_alive excluded (oldest first; t = ms since start) ---`,
      );
      for (const e of timeline) {
        const rel = String(e.t - startedAt).padStart(6, ' ');
        lines.push(`  +${rel}ms ${e.dir.padEnd(4)} ${e.state}/${e.name}  ${e.preview || ''}`);
      }
      lines.push('=====================================================');

      // The last thing we SENT is the prime suspect for a server-side decode error.
      const lastSent = [...timeline].reverse().find((e) => e.dir === 'C->S');
      log(
        `[packetDebugger] TIMELINE DUMP (${tag}) in state '${client.state}'. reason: ${reasonStr}`,
        'error',
      );
      if (lastSent) {
        log(`[packetDebugger] last packet we SENT: ${lastSent.name}  ${lastSent.preview}`, 'error');
      }
      log(
        `[packetDebugger] recent (no keep_alive): ${timeline
          .slice(-16)
          .map((e) => `${e.dir === 'C->S' ? '>' : e.dir === 'S->C' ? '<' : '='}${e.name}`)
          .join(' ')}`,
        'error',
      );
      writeDump(lines.join('\n'), tag);
    } catch (e) {
      log('[packetDebugger] error while building timeline dump: ' + (e?.stack || e), 'error');
    }
  }

  // Auto-dump when we get stuck in the configuration state. A normal join passes
  // through configuration in well under a second; sitting there means the server
  // is waiting on something we didn't send, and the connection never ends (so no
  // disconnect dump would ever fire). This captures the handshake so we can see
  // exactly which packet is missing.
  let stuckTimer = null;
  let stuckDumped = false;

  // Protocol state transitions (handshaking -> login -> configuration -> play).
  client.on('state', (newState, oldState) => {
    track({ dir: '--', state: newState, name: `STATE ${oldState} -> ${newState}`, preview: '' });
    clearTimeout(stuckTimer);
    if (newState === 'configuration') {
      stuckDumped = false;
      stuckTimer = setTimeout(() => {
        if (client.state === 'configuration' && !stuckDumped) {
          stuckDumped = true;
          dumpTimeline('stuck-configuration', 'still in configuration after 10s');
        }
      }, 10000);
      if (stuckTimer.unref) stuckTimer.unref();
    }
  });

  let endDumped = false;
  function dumpOnce(tag, reason) {
    if (endDumped) return; // one end-of-connection dump is enough
    endDumped = true;
    clearTimeout(stuckTimer);
    dumpTimeline(tag, reason);
  }
  bot.on('kicked', (reason) => dumpOnce('disconnect-kicked', reason));
  client.on('disconnect', (packet) => dumpOnce('disconnect', packet?.reason));
  bot.on('end', (reason) => dumpOnce('disconnect-end', reason));
  client.on('error', (e) => {
    track({ dir: 'ERR', state: client.state, name: 'client.error', preview: e?.message || String(e) });
  });

  log(
    '[packetDebugger] installed (parse-failure tracing + bidirectional timeline + stuck-config dump)',
    'info',
  );
};

module.exports = injectPacketDebugger;
