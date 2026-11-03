/**
 * Proxy support for the Minecraft TCP connection.
 *
 * Parses a single proxy URL string (e.g. `socks5://user:pass@host:1080`)
 * and returns a `connect` function compatible with mineflayer's
 * `createBot({ connect })` option. Supports SOCKS5 and SOCKS4 only —
 * Minecraft uses raw TCP, so HTTP proxies are not supported.
 *
 * DNS resolution happens locally (matching `curl --socks5 host:port` /
 * `socks5://` behavior), not at the proxy. Use this if you've seen
 * "HostUnreachable" errors when the proxy can't resolve hostnames itself.
 */

const dns = require('dns').promises;
const net = require('net');
const { SocksClient } = require('socks');

const PROTOCOL_ALIASES = {
  socks: 'socks5',
  socks5: 'socks5',
  socks5h: 'socks5',
  socks4: 'socks4',
  socks4a: 'socks4',
};

function parseProxy(url) {
  if (!url || typeof url !== 'string') return null;
  let raw = url.trim();
  if (!raw) return null;
  // Allow users to type "host:port" without a protocol — assume socks5.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    raw = 'socks5://' + raw;
  }
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return null;
  }
  const protoKey = u.protocol.replace(':', '').toLowerCase();
  const protocol = PROTOCOL_ALIASES[protoKey];
  if (!protocol) return null;
  if (!u.hostname) return null;
  const port = Number(u.port) || 1080;
  return {
    protocol,
    host: u.hostname,
    port,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

async function resolveTarget(host) {
  if (net.isIP(host)) return host;
  const { address } = await dns.lookup(host);
  return address;
}

function createConnect(proxy, target, { timeout = 15000 } = {}) {

  if (typeof target.port === "string") target.port = parseInt(target.port, 10);

  return function connect(client) {
    resolveTarget(target.host)
      .then((destHost) =>{
        return SocksClient.createConnection({
          proxy: {
            host: proxy.host,
            port: proxy.port,
            type: proxy.protocol === 'socks4' ? 4 : 5,
            userId: proxy.username,
            password: proxy.password,
          },
          command: 'connect',
          destination: { host: destHost, port: target.port },
          timeout,
        })},
      )
      .then((info) => {
        client.setSocket(info.socket);
        client.emit('connect');
      })
      .catch((err) => client.emit('error', err));
  };
}

function describeProxy(proxy) {
  const auth = proxy.username ? proxy.username + '@' : '';
  return proxy.protocol + '://' + auth + proxy.host + ':' + proxy.port;
}

module.exports = { parseProxy, createConnect, describeProxy };
