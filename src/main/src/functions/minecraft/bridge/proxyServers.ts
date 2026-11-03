import { EventEmitter, once } from 'node:events';
import { getMcBridgeServer } from '.';

const START_TIMEOUT_MS = 20_000;

/** Running JNbot proxies, keyed by `${profileId}:${scriptInstanceId}`. */
const proxies = new Map<string, { profileId: number; port: number }>();
const listening = new EventEmitter();

/** Starts the proxy for the profile owning a Minecraft instance, or the default profile. */
type ProxyStarter = {
  defaultPort(): number;
  start(minecraftInstanceId?: string): Promise<number>;
};
let starter: ProxyStarter | undefined;

export const setProxyStarter = (value: ProxyStarter) => {
  starter = value;
};

export const proxyPort = (profileId: number) =>
  [...proxies.values()].find((proxy) => proxy.profileId === profileId)?.port;

/** Resolves with the port once a proxy of `profileId` is listening. */
export const waitForProxy = async (profileId: number) =>
  proxyPort(profileId) ??
  ((await once(listening, String(profileId), {
    signal: AbortSignal.timeout(START_TIMEOUT_MS),
  })) as [number])[0];

const entry = (port: number, active: boolean) => ({
  name: 'JNbot Proxy',
  address: `localhost:${port}`,
  active,
});

/**
 * Server-list entries the mod shows at the top of the multiplayer screen.
 * Without a running proxy there is an inactive entry that starts one on join.
 */
export const proxyServersCommand = () => {
  const ports = new Set([...proxies.values()].map((proxy) => proxy.port));
  return {
    servers: ports.size
      ? [...ports].map((port) => entry(port, true))
      : [entry(starter?.defaultPort() ?? 25565, false)],
  };
};

export const setProxyServer = (key: string, proxy?: { profileId: number; port: number }) => {
  if (proxy) {
    proxies.set(key, proxy);
    listening.emit(String(proxy.profileId), proxy.port);
  } else if (!proxies.delete(key)) return;
  getMcBridgeServer()?.broadcastCommand('proxy.servers', proxyServersCommand());
};

export const startProxy = async (minecraftInstanceId?: string) => {
  if (!starter) throw new Error('JNbot is not ready yet');
  const port = await starter.start(minecraftInstanceId);
  return entry(port, true);
};
