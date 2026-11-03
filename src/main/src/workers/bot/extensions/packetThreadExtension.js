/**
 * Vanilla packet threading (1.8 – 26.x).
 *
 * The vanilla client answers keep_alive straight from the network thread, but
 * queues every other play packet for the main thread, which handles it on the
 * next frame. So when a server sends e.g. a teleport + keep_alive together, a
 * real client replies keep_alive BEFORE teleport_confirm / position_look, while
 * mineflayer replies in arrival order. Anti-bots bundle keep_alives with
 * teleports to detect exactly this.
 *
 * Play packets are therefore deferred to the next frame (the main thread drains
 * its queue once per frame), except keep_alive which is handled at once. A
 * keep_alive sent a few ms after the teleport still wins, like in vanilla.
 */
const FRAME_MS = 1000 / 60;
const NETWORK_THREAD = "keep_alive"
// Change the protocol state, so later packets can only be parsed after them
const STATE_CHANGING = "start_configuration"

function packetThreadPlugin(bot) {
  const client = bot._client;
  const emit = client.emit;
  const deferred = new WeakSet(); // metadata of queued packets
  const queue = [];
  let frameTimer;

  function flush() {
    clearTimeout(frameTimer);
    frameTimer = undefined;
    for (const [event, args] of queue.splice(0)) emit.call(client, event, ...args);
  }

  // nmp emits 'packet', '<name>', 'raw.<name>' and 'raw' per packet, all
  // sharing the same metadata object, so the whole group is queued together.
  client.emit = function (event, ...args) {
    const meta = args[1];
    if (event === 'packet' && meta?.state === 'play') {
      if (STATE_CHANGING === meta.name) flush();
      else if (NETWORK_THREAD !== meta.name) deferred.add(meta);
    }
    if (!meta || !deferred.has(meta)) return emit.call(this, event, ...args);
    queue.push([event, args]);
    frameTimer ??= setTimeout(flush, FRAME_MS);
    return true;
  };
}

module.exports = packetThreadPlugin;
