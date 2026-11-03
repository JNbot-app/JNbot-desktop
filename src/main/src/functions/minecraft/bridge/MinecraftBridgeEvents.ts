import type Settings_ from '../../Settings';
import type JnbotMcBridgeServer from './JnbotMcBridgeServer';
import type { JnbotMcBridgeClientInfo } from './JnbotMcBridgeServer';
import type { JnbotMcBridgeEvent } from './protocol';
import type { JNdata, ServerTypes } from '../../../types';

type EventData = Record<string, unknown> | null;

const resolveServerKeyFromAddress = (
  jndata: JNdata,
  serverAddress: string | null,
  fallback: ServerTypes,
): ServerTypes => {
  const addr = (serverAddress ?? '').toLowerCase().trim();
  if (!addr) return fallback;

  for (const id of jndata.serverList ?? []) {
    const data = jndata.data?.[id];
    if (!data) continue;
    const hosts = [data.defaultIp, ...(data.ips ?? [])]
      .filter((h): h is string => typeof h === 'string' && h.length > 0)
      .map((h) => h.toLowerCase().trim());
    if (hosts.some((h) => addr.includes(h))) return id;
  }
  return fallback;
};

export default class MinecraftBridgeEvents {
  private readonly settings: Settings_;

  constructor(
    settings: Settings_,
    private readonly profileKeyForInstance: (
      instanceId: string | undefined,
    ) => string | undefined,
  ) {
    this.settings = settings;
  }

  handle(server: JnbotMcBridgeServer, client: JnbotMcBridgeClientInfo, event: JnbotMcBridgeEvent): void {
    const name = event.name?.toUpperCase?.();
    if (!name) return;

    const data: EventData =
      typeof event.data === 'object' && event.data !== null
        ? (event.data as Record<string, unknown>)
        : null;

    if (name === 'PASSWORD_REQUEST') {
      this.PASSWORD_REQUEST(server, client, data);
    }
  }

  private PASSWORD_REQUEST(
    server: JnbotMcBridgeServer,
    client: JnbotMcBridgeClientInfo,
    data: EventData,
  ): void {
    const username = client.username;
    if (!username) return;

    const serverAddress = typeof data?.serverAddress === 'string' ? data.serverAddress : null;

    const profileKey = this.profileKeyForInstance(client.instanceId);
    if (!profileKey) return;

    const serverKey = resolveServerKeyFromAddress(
      this.settings.JNdata,
      serverAddress,
      profileKey as ServerTypes,
    );

    const password = this.settings.getAltPassword(username, serverKey);

    if (!password || !password.trim()) return;

    const message = `/login ${password}`;
    server.sendCommand(client.clientId, 'chat.send', { message });

    const gm = this.settings.shared.launcherOptions?.gamemode;
    if (gm?.length) {
      setTimeout(() => {
        const gmMessage = `/server ${gm.toLowerCase()}`;
        server.sendCommand(client.clientId, 'chat.send', { message: gmMessage });
      }, 1000);
    }
  }
}
