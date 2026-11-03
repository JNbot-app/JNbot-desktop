import { EventEmitter } from 'node:events';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import nbt from 'prismarine-nbt';
import { app, shell } from 'electron';
import type {
  CreateMinecraftServerInput,
  MinecraftBridgeClientSummary,
  MinecraftServerSource,
  MinecraftServerState,
  MinecraftServerDetail,
  MinecraftServerPlugin,
  MinecraftServerPluginProject,
  MinecraftServerPluginSearchPage,
  MinecraftServerSummary,
  MinecraftWorldInfo,
  ShareMinecraftClientWorldInput,
  ShareMinecraftLanInput,
} from '../../../../common/minecraftServers';
import { MinecraftLauncherTypes } from '../../../../common/CommonEnums';
import StorageModule from '../storage/Storage';
import MinecraftVersion from '../minecraft/launcher/MinecraftVersion';
import MinecraftInstaller from '../minecraft/launcher/MinecraftInstaller';
import { TaskRunner } from '../minecraft/TaskRunner';
import { getMinecraftRoot } from '../minecraft/minecraftPaths';
import type MinecraftBridgeManager from '../minecraft/MinecraftBridgeManager';
import {
  MinecraftTunnelClient,
  MinecraftTunnelHost,
  queryMinecraftRoomStatus,
} from './MinecraftTunnel';
import {
  decodeMinecraftInvite,
  encodeMinecraftInvite,
  randomSecret,
  roomIdFromHostKey,
} from './invite';
import MinecraftServerPluginManager from './MinecraftServerPluginManager';
import ManagedMinecraftServerBridge from './ManagedMinecraftServerBridge';

type Secret = string;

type PersistedBase = {
  id: string;
  name: string;
  version: string;
  createdAt: number;
};

type HostedServer = PersistedBase & {
  role: 'host';
  source: MinecraftServerSource;
  hostKey: Secret;
  accessKey: Secret;
  targetPort?: number;
  serverDirectory?: string;
  memoryMB?: number;
  onlineMode?: boolean;
  eulaAcceptedAt?: number;
  bridgeClientId?: string;
  fabricLoaderVersion?: string;
  fabricInstallerVersion?: string;
};

type JoinedServer = PersistedBase & {
  role: 'joined';
  source: 'dedicated';
  roomId: string;
  accessKey: Secret;
  localPort: number;
};

type PersistedServer = HostedServer | JoinedServer;
type StoreShape = { version: 1; servers: PersistedServer[] };

type Runtime = {
  state: MinecraftServerState;
  progress?: MinecraftServerSummary['progress'];
  error?: string;
  peerCount: number;
};

const FABRIC_META = 'https://meta.fabricmc.net/v2/versions';
const MAX_LOG_LINES = 2000;
const STATUS_INTERVAL_MS = 30_000;

const cleanName = (name: string) => name.trim().replace(/[\r\n]/g, ' ').slice(0, 80);

const isStore = (value: StoreShape) =>
  Boolean(value && value.version === 1 && Array.isArray(value.servers));

async function freePort(): Promise<number> {
  const server = net.createServer();
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function canConnect(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export default class MinecraftServerManager extends EventEmitter {
  private readonly storage: StorageModule<StoreShape>;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly hostTunnels = new Map<string, MinecraftTunnelHost>();
  private readonly clients = new Map<string, MinecraftTunnelClient>();
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly logs = new Map<string, string[]>();
  private readonly healthFailures = new Map<string, number>();
  private activeHostId?: string;
  private statusTimer?: NodeJS.Timeout;
  private activation?: Promise<void>;
  readonly pluginManager: MinecraftServerPluginManager;
  readonly managedBridge: ManagedMinecraftServerBridge;

  constructor(private readonly bridgeManager: MinecraftBridgeManager) {
    super();
    const storagePath = path.join(app.getPath('userData'), 'minecraft-servers.json');
    this.storage = new StorageModule<StoreShape>(
      storagePath,
      () => ({ version: 1, servers: [] }),
      { validate: isStore },
    );
    try { fs.chmodSync(storagePath, 0o600); } catch { /* best effort on Windows */ }
    for (const server of this.servers)
      this.runtimes.set(server.id, {
        state: server.role === 'joined' ? 'offline' : 'stopped',
        peerCount: 0,
      });
    this.managedBridge = new ManagedMinecraftServerBridge(
      bridgeManager,
      (id) => {
        const server = this.servers.find((entry) => entry.id === id);
        return server ? this.toSummary(server) : undefined;
      },
      () => this.publish(),
    );
    this.pluginManager = new MinecraftServerPluginManager(
      (id) => {
        const server = this.find(id);
        if (
          server.role !== 'host' ||
          server.source !== 'dedicated' ||
          !server.serverDirectory ||
          !this.isManagedDirectory(server.serverDirectory)
        )
          throw new Error(
            'Plugins are only available for JNbot-managed Fabric servers',
          );
        return {
          id: server.id,
          version: server.version,
          directory: server.serverDirectory,
          running: this.processes.has(server.id),
        };
      },
      (id) => {
        this.publish();
        void this.plugins(id).then((plugins) =>
          global.send?.('MC_SERVER_PLUGINS_UPDATE', { id, plugins }),
        );
      },
    );
    app.once('before-quit', () => void this.close());
  }

  activate(): Promise<void> {
    if (this.activation) return this.activation;
    this.activation = this.restoreJoinedServers().then(async () => {
      await Promise.all(
        this.servers
          .filter(
            (server) =>
              server.role === 'host' && server.source === 'dedicated',
          )
          .map((server) =>
            this.pluginManager.state(server.id).catch(() => undefined),
          ),
      );
      this.publish();
      if (this.statusTimer) return;
      this.statusTimer = setInterval(() => {
        void this.refreshJoinedStatus();
        void this.checkActiveHostHealth();
      }, STATUS_INTERVAL_MS);
      this.statusTimer.unref();
    });
    return this.activation;
  }

  private get servers() {
    return this.storage.get().servers;
  }

  private persist() {
    this.storage.set({ version: 1, servers: [...this.servers] });
    this.storage.save();
  }

  private runtime(id: string): Runtime {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = { state: 'stopped', peerCount: 0 };
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  private update(id: string, patch: Partial<Runtime>) {
    const runtime = this.runtime(id);
    const previousState = runtime.state;
    Object.assign(runtime, patch);
    if (patch.state && patch.state !== previousState)
      this.managedBridge?.publishState(id, previousState, patch.state);
    if ('progress' in patch)
      global.send?.('MC_SERVER_PROGRESS', { id, progress: patch.progress });
    this.publish();
  }

  private publish() {
    const summaries = this.list();
    this.emit('changed', summaries);
    global.send?.('MC_SERVERS_UPDATE', summaries);
  }

  list(): MinecraftServerSummary[] {
    return this.servers.map((server) => this.toSummary(server));
  }

  detail(id: string): MinecraftServerDetail {
    const summary = this.list().find((server) => server.id === id);
    if (!summary) throw new Error('Minecraft server not found');
    const dedicated =
      summary.role === 'host' && summary.source === 'dedicated';
    return {
      ...summary,
      capabilities: {
        console: dedicated,
        plugins: dedicated,
        api: dedicated && this.managedBridge.supports(summary.version),
      },
    };
  }

  private toSummary(server: PersistedServer): MinecraftServerSummary {
    const runtime = this.runtime(server.id);
    const port =
      server.role === 'joined'
        ? server.localPort
        : runtime.state === 'online'
          ? server.targetPort
          : undefined;
    const dedicated =
      server.role === 'host' && server.source === 'dedicated';
    const pluginState = dedicated
      ? this.pluginManager?.stateSync(server.id) ?? {
          pluginCount: 0,
          restartRequired: false,
        }
      : { pluginCount: 0, restartRequired: false };
    const supported = dedicated && this.managedBridge?.supports(server.version);
    const connected = supported
      ? this.managedBridge.isConnected(server.id)
      : false;
    const apiState =
      !supported
        ? 'unsupported'
        : connected
          ? 'online'
          : runtime.state === 'starting' || runtime.state === 'installing'
            ? 'connecting'
            : runtime.state === 'error'
              ? 'error'
              : 'offline';
    return {
      id: server.id,
      name: server.name,
      version: server.version,
      role: server.role,
      source: server.source,
      state: runtime.state,
      localAddress:
        port && runtime.state === 'online'
          ? `127.0.0.1:${port}`
          : undefined,
      peerCount: runtime.peerCount,
      progress: runtime.progress,
      error: runtime.error,
      onlineMode: server.role === 'host' ? server.onlineMode : undefined,
      memoryMB: server.role === 'host' ? server.memoryMB : undefined,
      createdAt: server.createdAt,
      apiState,
      apiVersion: connected
        ? this.managedBridge.apiVersion(server.id)
        : undefined,
      restartRequired: pluginState.restartRequired,
      pluginCount: pluginState.pluginCount,
    };
  }

  private find(id: string): PersistedServer {
    const server = this.servers.find((entry) => entry.id === id);
    if (!server) throw new Error('Minecraft server not found');
    return server;
  }

  private managedDirectory(id: string) {
    return path.join(app.getPath('userData'), 'minecraft-servers', id);
  }

  private isManagedDirectory(directory: string) {
    const root = path.join(app.getPath('userData'), 'minecraft-servers');
    const relative = path.relative(root, path.resolve(directory));
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  async createDedicated(input: CreateMinecraftServerInput): Promise<MinecraftServerSummary> {
    const name = cleanName(input.name);
    if (!name || !input.version?.trim()) throw new Error('Name and version are required');
    if (!input.eulaAccepted) throw new Error('You must accept the Minecraft EULA');
    const memoryMB = Math.max(512, Math.min(16_384, Math.floor(input.memoryMB ?? 2048)));
    if (input.world?.version && input.world.version !== input.version)
      throw new Error(`World ${input.world.name} requires Minecraft ${input.world.version}`);
    if (input.world && !input.world.version && !input.allowUnknownWorldVersion)
      throw new Error('Confirm the unknown world version before importing it');

    const id = cryptoRandomId();
    const serverDirectory = this.managedDirectory(id);
    await fsp.mkdir(serverDirectory, { recursive: true, mode: 0o700 });
    if (input.world) await this.copyWorld(input.world.path, path.join(serverDirectory, 'world'));
    const hostKey = randomSecret();
    const server: HostedServer = {
      id,
      name,
      version: input.version.trim(),
      role: 'host',
      source: 'dedicated',
      hostKey,
      accessKey: randomSecret(),
      serverDirectory,
      memoryMB,
      onlineMode: input.onlineMode !== false,
      eulaAcceptedAt: Date.now(),
      createdAt: Date.now(),
    };
    this.servers.push(server);
    this.runtimes.set(id, { state: 'stopped', peerCount: 0 });
    this.persist();
    this.publish();
    return this.list().find((entry) => entry.id === id)!;
  }

  async shareManualLan(input: ShareMinecraftLanInput): Promise<MinecraftServerSummary> {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
      throw new Error('Enter a valid localhost port');
    if (!(await canConnect(input.port))) throw new Error('Nothing is listening on that localhost port');
    const server = this.createLanDefinition(input.name, input.version, 'manual-lan', input.port);
    await this.start(server.id);
    return this.list().find((entry) => entry.id === server.id)!;
  }

  async shareClientWorld(input: ShareMinecraftClientWorldInput): Promise<MinecraftServerSummary> {
    const bridgeClient = this.bridgeManager
      .getClients()
      .find((candidate) => candidate.clientId === input.clientId);
    const client = this.bridgeManager.getClient(input.clientId);
    const version = bridgeClient?.mcVersion?.trim() || input.version;
    if (!version)
      throw new Error('Unable to determine the Minecraft client version');
    const status = await client.request<{ singleplayer: boolean; open: boolean; port?: number }>(
      'mc.server.status',
    );
    if (!status.singleplayer) throw new Error('Open a singleplayer world in JNbot Client first');
    let port = status.port;
    if (!status.open || !port) {
      const requestedPort = await freePort();
      const opened = await client.request<{ ok: boolean; port?: number }>('mc.server.openToLan', {
        port: requestedPort,
        cheatsAllowed: Boolean(input.cheatsAllowed),
      });
      if (!opened.ok || !opened.port) throw new Error('Minecraft could not open the world to LAN');
      port = opened.port;
    }
    const server = this.createLanDefinition(input.name, version, 'client-lan', port);
    server.bridgeClientId = input.clientId;
    this.persist();
    await this.start(server.id);
    return this.list().find((entry) => entry.id === server.id)!;
  }

  private createLanDefinition(
    rawName: string,
    version: string,
    source: 'client-lan' | 'manual-lan',
    targetPort: number,
  ): HostedServer {
    const name = cleanName(rawName);
    if (!name || !version?.trim()) throw new Error('Name and version are required');
    const server: HostedServer = {
      id: cryptoRandomId(),
      name,
      version: version.trim(),
      role: 'host',
      source,
      hostKey: randomSecret(),
      accessKey: randomSecret(),
      targetPort,
      createdAt: Date.now(),
    };
    this.servers.push(server);
    this.runtimes.set(server.id, { state: 'stopped', peerCount: 0 });
    this.persist();
    return server;
  }

  async importInvite(raw: string): Promise<MinecraftServerSummary> {
    const invite = decodeMinecraftInvite(raw);
    const existing = this.servers.find(
      (server): server is JoinedServer => server.role === 'joined' && server.roomId === invite.r,
    );
    if (existing) return this.list().find((entry) => entry.id === existing.id)!;
    const localPort = await freePort();
    const server: JoinedServer = {
      id: cryptoRandomId(),
      name: cleanName(invite.n),
      version: invite.m,
      role: 'joined',
      source: 'dedicated',
      roomId: invite.r,
      accessKey: invite.k,
      localPort,
      createdAt: Date.now(),
    };
    this.servers.push(server);
    this.runtimes.set(server.id, { state: 'offline', peerCount: 0 });
    this.persist();
    await this.startJoinedProxy(server);
    await this.refreshJoinedStatus();
    return this.list().find((entry) => entry.id === server.id)!;
  }

  invite(id: string): string {
    const server = this.find(id);
    if (server.role !== 'host') throw new Error('Only hosted servers have invite codes');
    return encodeMinecraftInvite({
      v: 1,
      r: roomIdFromHostKey(server.hostKey),
      k: server.accessKey,
      n: server.name,
      m: server.version,
    });
  }

  async rotateInvite(id: string): Promise<string> {
    const server = this.find(id);
    if (server.role !== 'host') throw new Error('Only hosted servers have invite codes');
    const wasOnline = this.runtime(id).state === 'online';
    this.hostTunnels.get(id)?.stop();
    this.hostTunnels.delete(id);
    server.hostKey = randomSecret();
    server.accessKey = randomSecret();
    this.persist();
    if (wasOnline && server.targetPort) await this.startTunnel(server);
    this.publish();
    return this.invite(id);
  }

  async start(id: string): Promise<void> {
    const server = this.find(id);
    if (server.role === 'joined') {
      await this.startJoinedProxy(server);
      return;
    }
    if (this.activeHostId && this.activeHostId !== id)
      throw new Error('Stop the currently hosted Minecraft server first');
    if (this.runtime(id).state === 'online' || this.runtime(id).state === 'starting') return;
    this.activeHostId = id;
    this.update(id, { state: 'starting', error: undefined, progress: undefined });
    try {
      if (server.source === 'dedicated') await this.startDedicated(server);
      else {
        if (!server.targetPort || !(await canConnect(server.targetPort)))
          throw new Error('The shared localhost Minecraft world is not available');
        await this.startTunnel(server);
      }
      this.update(id, { state: 'online', progress: undefined });
      this.healthFailures.delete(id);
    } catch (error) {
      await this.stop(id).catch(() => undefined);
      this.update(id, { state: 'error', error: errorMessage(error), progress: undefined });
      throw error;
    }
  }

  private async startDedicated(server: HostedServer) {
    if (!server.eulaAcceptedAt || !server.serverDirectory)
      throw new Error('Minecraft EULA acceptance is required');
    if (!this.isManagedDirectory(server.serverDirectory))
      throw new Error('Invalid managed Minecraft server directory');
    const directory = server.serverDirectory;
    await this.pluginManager.applyPending(server.id);
    await this.installSystemMods(server, directory);
    this.update(server.id, { state: 'installing', progress: { label: 'Preparing Java runtime' } });
    const taskRunner = new TaskRunner((_event, data: any) => {
      this.update(server.id, {
        progress: {
          label: data?.name || 'Installing Java runtime',
          current: data?.progress,
          total: data?.total,
        },
      });
    });
    const version = await MinecraftVersion.fromVersionId(server.version, {
      launcher: MinecraftLauncherTypes.VANILLA,
      minecraftRoot: path.join(directory, '.minecraft-runtime'),
      taskRunner,
    });
    const { javaPath } = await version.getJavaPath();
    const serverJavaPath =
      process.platform === 'win32' && javaPath.toLowerCase().endsWith('javaw.exe')
        ? javaPath.slice(0, -9) + 'java.exe'
        : javaPath;
    const jarPath = await this.ensureFabricServer(server, directory);
    server.targetPort = await freePort();
    await fsp.writeFile(path.join(directory, 'eula.txt'), 'eula=true\n', 'utf8');
    await fsp.writeFile(
      path.join(directory, 'server.properties'),
      [
        'server-ip=127.0.0.1',
        `server-port=${server.targetPort}`,
        'level-name=world',
        `online-mode=${server.onlineMode !== false}`,
        'enable-rcon=false',
        'enable-query=false',
        'motd=Hosted privately with JNbot',
      ].join('\n') + '\n',
      'utf8',
    );
    this.persist();
    this.update(server.id, { state: 'starting', progress: { label: 'Starting Fabric server' } });
    const memory = server.memoryMB ?? 2048;
    const bridgeToken = this.managedBridge.supports(server.version)
      ? this.managedBridge.register(server.id)
      : undefined;
    const proc = spawn(
      serverJavaPath,
      [`-Xms512M`, `-Xmx${memory}M`, '-jar', jarPath, 'nogui'],
      {
        cwd: directory,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: bridgeToken
          ? {
              ...process.env,
              JNBOT_MC_SERVER_ID: server.id,
              JNBOT_MC_BRIDGE_TOKEN: bridgeToken,
            }
          : process.env,
      },
    );
    this.processes.set(server.id, proc);
    this.captureLogs(server.id, proc);
    proc.once('exit', (code) => this.onProcessExit(server.id, code));
    proc.once('error', (error) => this.onProcessError(server.id, error));
    await this.waitUntilReady(server.id, server.targetPort, 120_000);
    await this.startTunnel(server);
  }

  private async ensureFabricServer(server: HostedServer, directory: string): Promise<string> {
    const jarPath = path.join(directory, `fabric-server-${server.version}.jar`);
    if (
      fs.existsSync(jarPath) &&
      server.fabricLoaderVersion &&
      server.fabricInstallerVersion
    ) return jarPath;
    this.update(server.id, { progress: { label: 'Downloading Fabric server' } });
    const loaderResponse = await axios.get<any[]>(
      `${FABRIC_META}/loader/${encodeURIComponent(server.version)}`,
      { timeout: 30_000 },
    );
    const installerResponse = await axios.get<any[]>(`${FABRIC_META}/installer`, { timeout: 30_000 });
    const loader = loaderResponse.data.find((entry) => entry?.loader?.stable) ?? loaderResponse.data[0];
    const installer = installerResponse.data.find((entry) => entry?.stable) ?? installerResponse.data[0];
    if (!loader?.loader?.version || !installer?.version)
      throw new Error(`Fabric is not available for Minecraft ${server.version}`);
    server.fabricLoaderVersion = loader.loader.version;
    server.fabricInstallerVersion = installer.version;
    this.persist();
    if (fs.existsSync(jarPath)) return jarPath;
    const url = `${FABRIC_META}/loader/${encodeURIComponent(server.version)}/${encodeURIComponent(server.fabricLoaderVersion!)}/${encodeURIComponent(server.fabricInstallerVersion!)}/server/jar`;
    const response = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120_000 });
    const partialPath = `${jarPath}.part`;
    await fsp.writeFile(partialPath, Buffer.from(response.data));
    await fsp.rename(partialPath, jarPath);
    return jarPath;
  }

  private async installSystemMods(server: HostedServer, directory: string) {
    const modsDirectory = path.join(directory, 'mods');
    const runtimeRoot = path.join(directory, '.minecraft-runtime');
    await fsp.mkdir(modsDirectory, { recursive: true, mode: 0o700 });
    const fabricApi = await MinecraftInstaller.installFabricMod(
      server.version,
      runtimeRoot,
    );
    const systemMods = [fabricApi];
    if (this.managedBridge.supports(server.version)) {
      const { modJarPath } = await MinecraftInstaller.getJNbotMod(
        server.version,
      );
      systemMods.push(modJarPath);
    }
    for (const source of systemMods) {
      const destination = path.join(modsDirectory, path.basename(source));
      const partial = `${destination}.part`;
      await fsp.copyFile(source, partial);
      await fsp.rename(partial, destination);
    }
  }

  private captureLogs(id: string, proc: ChildProcessWithoutNullStreams) {
    const consume = (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) this.appendLog(id, line);
    };
    proc.stdout.on('data', consume);
    proc.stderr.on('data', consume);
  }

  private appendLog(id: string, line: string) {
    const log = this.logs.get(id) ?? [];
    log.push(line);
    if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
    this.logs.set(id, log);
    global.send?.('MC_SERVER_LOG', { id, line });
  }

  private async waitUntilReady(id: string, port: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.processes.has(id)) throw new Error('Minecraft server exited during startup');
      if (await canConnect(port, 500)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Minecraft server did not become ready in time');
  }

  private async startTunnel(server: HostedServer) {
    if (!server.targetPort) throw new Error('Minecraft target port is unavailable');
    const hostKey = server.hostKey;
    const tunnel = new MinecraftTunnelHost(
      roomIdFromHostKey(hostKey),
      hostKey,
      server.accessKey,
      server.targetPort,
    );
    tunnel.on('peers', (peerCount) => this.update(server.id, { peerCount }));
    tunnel.on('log', (message) => this.appendLog(server.id, `[P2P] ${message}`));
    try {
      await tunnel.start();
      this.hostTunnels.set(server.id, tunnel);
    } catch (error) {
      tunnel.stop();
      throw error;
    }
  }

  consoleLines(id: string): string[] {
    return [...(this.logs.get(id) ?? [])];
  }

  consoleCommand(id: string, command: string) {
    const proc = this.processes.get(id);
    const value = command?.replace(/[\r\n]+/g, ' ').trim();
    if (!proc || !value) throw new Error('Minecraft server is not running');
    if (value.length > 4096) throw new Error('Console command is too long');
    proc.stdin.write(`${value}\n`);
  }

  async stop(id: string): Promise<void> {
    const server = this.find(id);
    if (server.role === 'joined') {
      await this.clients.get(id)?.stop();
      this.clients.delete(id);
      this.update(id, { state: 'offline' });
      return;
    }
    if (this.runtime(id).state === 'stopped') return;
    this.update(id, { state: 'stopping' });
    this.hostTunnels.get(id)?.stop();
    this.hostTunnels.delete(id);
    const proc = this.processes.get(id);
    if (proc) {
      proc.stdin.write('stop\n');
      await this.waitForExit(proc, 15_000);
      if (this.processes.has(id)) await killProcessTree(proc.pid);
      this.processes.delete(id);
    }
    if (this.activeHostId === id) this.activeHostId = undefined;
    this.managedBridge.revoke(id);
    this.healthFailures.delete(id);
    this.update(id, { state: 'stopped', peerCount: 0, progress: undefined });
  }

  private waitForExit(proc: ChildProcessWithoutNullStreams, timeoutMs: number) {
    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, timeoutMs);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private onProcessExit(id: string, code: number | null) {
    this.processes.delete(id);
    this.hostTunnels.get(id)?.stop();
    this.hostTunnels.delete(id);
    if (this.activeHostId === id) this.activeHostId = undefined;
    this.managedBridge.revoke(id);
    const stopping = this.runtime(id).state === 'stopping';
    this.update(id, stopping || code === 0
      ? { state: 'stopped', peerCount: 0 }
      : { state: 'error', peerCount: 0, error: `Minecraft server exited with code ${code}` });
  }

  private onProcessError(id: string, error: Error) {
    this.processes.delete(id);
    if (this.activeHostId === id) this.activeHostId = undefined;
    this.managedBridge.revoke(id);
    this.update(id, { state: 'error', error: error.message, peerCount: 0 });
  }

  async remove(id: string, deleteFiles = false): Promise<void> {
    const server = this.find(id);
    const directory =
      deleteFiles && server.role === 'host' ? server.serverDirectory : undefined;
    if (directory && !this.isManagedDirectory(directory))
      throw new Error('Refusing to remove a directory outside JNbot server storage');
    await this.stop(id).catch(() => undefined);
    if (directory && fs.existsSync(directory)) await shell.trashItem(directory);
    const index = this.servers.findIndex((entry) => entry.id === id);
    this.servers.splice(index, 1);
    this.runtimes.delete(id);
    this.logs.delete(id);
    this.pluginManager.forget(id);
    this.persist();
    this.publish();
  }

  bridgeClients(): MinecraftBridgeClientSummary[] {
    return this.bridgeManager.ensureMcBridgeServer().listClients().map((client) => ({
      clientId: client.clientId,
      username: client.username,
      mcVersion: client.mcVersion,
      instanceId: client.instanceId,
    }));
  }

  plugins(id: string): Promise<MinecraftServerPlugin[]> {
    return this.pluginManager.list(id);
  }

  searchPlugins(
    id: string,
    query?: string,
    offset?: number,
    limit?: number,
  ): Promise<MinecraftServerPluginSearchPage> {
    return this.pluginManager.search(id, query, offset, limit);
  }

  pluginProject(
    id: string,
    projectId: string,
  ): Promise<MinecraftServerPluginProject> {
    return this.pluginManager.project(id, projectId);
  }

  installPlugin(id: string, projectId: string, versionId?: string) {
    return this.pluginManager.install(id, projectId, versionId);
  }

  removePlugin(id: string, projectId: string) {
    return this.pluginManager.remove(id, projectId);
  }

  async restart(id: string): Promise<void> {
    const server = this.find(id);
    if (server.role !== 'host' || server.source !== 'dedicated')
      throw new Error('Only managed Fabric servers can be restarted');
    await this.stop(id);
    await this.start(id);
  }

  async discoverWorlds(root?: string): Promise<MinecraftWorldInfo[]> {
    const roots = root ? [root] : this.defaultWorldRoots();
    const worlds: MinecraftWorldInfo[] = [];
    const seen = new Set<string>();
    for (const saves of roots) {
      if (root && fs.existsSync(path.join(saves, 'level.dat'))) {
        const real = await fsp.realpath(saves).catch(() => saves);
        const info = await this.readWorldInfo(real).catch(() => null);
        if (info) { worlds.push(info); seen.add(real); }
        continue;
      }
      let entries: fs.Dirent[] = [];
      try { entries = await fsp.readdir(saves, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const worldPath = path.join(saves, entry.name);
        const real = await fsp.realpath(worldPath).catch(() => worldPath);
        if (seen.has(real)) continue;
        const info = await this.readWorldInfo(real).catch(() => null);
        if (info) { worlds.push(info); seen.add(real); }
      }
    }
    return worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  }

  private defaultWorldRoots(): string[] {
    const home = os.homedir();
    const official =
      process.platform === 'win32'
        ? path.join(app.getPath('appData'), '.minecraft', 'saves')
        : process.platform === 'darwin'
          ? path.join(home, 'Library', 'Application Support', 'minecraft', 'saves')
          : path.join(home, '.minecraft', 'saves');
    return [
      official,
      path.join(getMinecraftRoot(path.join(app.getPath('userData'), '..')), 'saves'),
    ];
  }

  private async readWorldInfo(worldPath: string): Promise<MinecraftWorldInfo | null> {
    const levelPath = path.join(worldPath, 'level.dat');
    const data = await fsp.readFile(levelPath).catch(() => null);
    if (!data) return null;
    const parsed = await nbt.parse(data);
    const simplified = nbt.simplify(parsed.parsed) as any;
    const world = simplified?.Data ?? simplified;
    const lastPlayed = Number(world?.LastPlayed);
    const iconPath = path.join(worldPath, 'icon.png');
    return {
      path: worldPath,
      name: String(world?.LevelName || path.basename(worldPath)).slice(0, 80),
      version: typeof world?.Version?.Name === 'string' ? world.Version.Name : undefined,
      lastPlayed: Number.isFinite(lastPlayed) ? lastPlayed : undefined,
      iconPath: fs.existsSync(iconPath) ? iconPath : undefined,
    };
  }

  private async copyWorld(source: string, destination: string) {
    const realSource = await fsp.realpath(source);
    const stat = await fsp.stat(realSource);
    if (!stat.isDirectory() || !fs.existsSync(path.join(realSource, 'level.dat')))
      throw new Error('Select a valid Minecraft world directory');
    await rejectSymlinks(realSource);
    const stage = `${destination}.importing`;
    await fsp.rm(stage, { recursive: true, force: true });
    try {
      await fsp.cp(realSource, stage, { recursive: true, errorOnExist: true, force: false });
      await rejectSymlinks(stage);
      await fsp.rename(stage, destination);
    } catch (error) {
      await fsp.rm(stage, { recursive: true, force: true });
      throw error;
    }
  }

  private async restoreJoinedServers() {
    for (const server of this.servers) {
      if (server.role !== 'joined') continue;
      await this.startJoinedProxy(server).catch(async () => {
        server.localPort = await freePort();
        this.persist();
        await this.startJoinedProxy(server).catch(() => undefined);
      });
    }
    await this.refreshJoinedStatus();
  }

  private async startJoinedProxy(server: JoinedServer) {
    if (this.clients.has(server.id)) return;
    const client = new MinecraftTunnelClient(
      server.roomId,
      server.accessKey,
      server.localPort,
    );
    client.on('log', (message) => this.appendLog(server.id, `[P2P] ${message}`));
    client.on('failure', (message) => this.update(server.id, { error: message }));
    client.on('connected', () => this.update(server.id, { error: undefined }));
    await client.startLocalProxy();
    this.clients.set(server.id, client);
  }

  private async refreshJoinedStatus() {
    const joined = this.servers.filter((server): server is JoinedServer => server.role === 'joined');
    const status = await queryMinecraftRoomStatus(joined.map((server) => server.roomId));
    for (const server of joined)
      Object.assign(this.runtime(server.id), {
        state: status[server.roomId] ? 'online' : 'offline',
      });
    this.publish();
  }

  private async checkActiveHostHealth() {
    if (!this.activeHostId) return;
    const server = this.find(this.activeHostId);
    if (server.role !== 'host' || server.source === 'dedicated' || !server.targetPort) return;
    if (await canConnect(server.targetPort)) {
      this.healthFailures.delete(server.id);
      return;
    }
    const failures = (this.healthFailures.get(server.id) ?? 0) + 1;
    this.healthFailures.set(server.id, failures);
    if (failures >= 3) await this.stop(server.id).catch(() => undefined);
  }

  async close() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    for (const server of [...this.servers]) await this.stop(server.id).catch(() => undefined);
    this.storage.close();
  }
}

const cryptoRandomId = () => randomSecret().slice(0, 22);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function rejectSymlinks(root: string): Promise<void> {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('World folders containing symbolic links are not supported');
      if (entry.isDirectory()) pending.push(next);
    }
  }
}

async function killProcessTree(pid?: number) {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()));
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
}
