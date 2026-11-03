/**
 * Proxy-routed bots must answer downstream keep-alives, including the local
 * barriers used during a switch. The proxy owns upstream liveness, so this
 * deliberately has no timeout/watchdog of its own.
 */
function installProxyKeepAlive(client) {
  client.on('keep_alive', (packet) => {
    client.write('keep_alive', { keepAliveId: packet.keepAliveId });
  });
}

module.exports = installProxyKeepAlive;
