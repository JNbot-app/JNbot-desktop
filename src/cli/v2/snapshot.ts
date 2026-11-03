import type { CliRuntime, CliSnapshot } from './types';

function elapsed(start: number | undefined): string {
  const seconds = Math.max(0, Math.floor((Date.now() - (start ?? Date.now())) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function serverAddress(host: string | undefined, port: number | undefined, fallback: string): string {
  const address = host || fallback;
  return port !== undefined && !address.includes(':') ? `${address}:${port}` : address;
}

export function cliSnapshot({ handler }: CliRuntime): CliSnapshot {
  const runtime = handler.getBootstrapRuntime();
  const profile = handler.settings.getProfile(runtime.profileKey);
  const profileServer = handler.settings.getProfileAppSettings(runtime.profileKey);
  const devices = Object.values(handler.deviceHandler.getDevices());
  const peer = devices.find((device) => device.server === 'peer2peer');
  const remote = handler.deviceHandler as unknown as {
    getServerInfo?: () => { peer2peer: { status: boolean; url: string | null; room: string | null } };
  };
  const server = remote.getServerInfo?.().peer2peer ?? { status: false, url: null, room: null };
  return {
    profile: {
      id: runtime.profileKey,
      name: profile?.data.name ?? profile?.data.shortName ?? runtime.profileKey,
    },
    scripts: Object.values(runtime.activeScripts.scripts).map((script) => ({
      id: String(script.instanceId),
      name: script.name,
      elapsed: elapsed(script.startTime),
      progress: runtime.activeScripts.getProgress(script.instanceId)
        ? `${runtime.activeScripts.getProgress(script.instanceId)?.current ?? 0}/${runtime.activeScripts.getProgress(script.instanceId)?.total ?? 0}`
        : undefined,
    })),
    bots: Object.values(runtime.activeBots.bots).map((bot) => ({
      id: String(bot.botInfo.id),
      username: bot.botInfo.username,
      server: serverAddress(
        bot.botInfo.host,
        bot.botInfo.port ?? profileServer.port ?? 25565,
        profileServer.ip || runtime.profileKey,
      ),
      script: bot.script.name,
      status: bot.botInfo.status,
    })),
    remote: {
      active: server.status,
      connections: peer?.connectionCount ?? 0,
      url: server.url,
      room: server.room,
    },
  };
}
