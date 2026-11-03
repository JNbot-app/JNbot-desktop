import JnbotMcBridgeServer from './JnbotMcBridgeServer';
import { proxyServersCommand, startProxy } from './proxyServers';

let instance: JnbotMcBridgeServer | null = null;

export const getMcBridgeServer = (): JnbotMcBridgeServer | null => instance;

export const startMcBridgeServer = (options?: {
  host?: string;
  port?: number;
  authToken?: string | null;
}) => {
  if (instance) return instance;

  const host = options?.host ?? process.env.JNBOT_MC_BRIDGE_HOST ?? '127.0.0.1';
  const portRaw = options?.port ?? Number(process.env.JNBOT_MC_BRIDGE_PORT ?? 17340);
  const port = Number.isFinite(portRaw) ? portRaw : 17340;

  const authToken =
    options?.authToken ?? (process.env.JNBOT_MC_BRIDGE_TOKEN ? String(process.env.JNBOT_MC_BRIDGE_TOKEN) : null);

  const server = new JnbotMcBridgeServer({ host, port, authToken });
  server.on('client-connected', ({ clientId }) =>
    server.sendCommand(clientId, 'proxy.servers', proxyServersCommand()),
  );
  server.handle('proxy.start', (client) => startProxy(client?.instanceId));
  instance = server;
  instance.start();
  return instance;
};

export const stopMcBridgeServer = () => {
  if (!instance) return;
  instance.stop();
  instance = null;
};
