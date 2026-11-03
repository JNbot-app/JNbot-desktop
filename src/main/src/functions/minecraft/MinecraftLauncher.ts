import { createMinecraftProcessWatcher } from '@xmcl/core';

import events from 'node:events';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type {
  AppSettings,
  LaunchMinecraftOptions,
  LaunchLogEntry,
  MinecraftLaunchLogBatch,
  MinecraftLaunchLogSnapshot,
} from '../../types';
import uuid from '../actions/uuid';
import { getMinecraftRoot, offlineUuid } from './minecraftPaths';
import { TaskRunner } from './TaskRunner';
import MinecraftVersion from './launcher/MinecraftVersion';
import { MinecraftLauncherTypes } from '../../../../common/CommonEnums';
import { VersionInfo } from './launcher/MinecraftLauncherTypes';
import { collectCrashInfo, ensureDir } from './launcher/util/errorHandling';
import ModHandler from './launcher/ModHandler';
import {
  getJnbotModManifest,
  installJnbotMod,
  isJnbotModAvailable,
} from './launcher/JnbotMods';
import {
  getLunarVersions,
  launchLunarClient,
  type LunarAccount,
} from './launcher/LunarClient';
import { appendTextTail, LauncherDiagnostics } from './LauncherDiagnostics';

export type MinecraftUserSession = {
  accessToken: string;
  uuid: string;
  name: string;
};

export type MinecraftLaunchResult = {
  pid: number;
  instancePath: string;
  minecraftRoot: string;
};

type MinecraftVersionFetchCache = {
  launcherVersion: string;
  versions: VersionInfo[];
  lastFetched: number;
};

export default class MinecraftLauncher {
  public static readonly VERSION = '1.0.7'; // Used to know when to refresh the version cache

  private static readonly runningPids = new Set<number>();
  private static cleanupHookInstalled = false;

  private readonly defaultMinecraftRoot: string;
  private readonly sendProgress: (event: string, data?: unknown) => void;
  private activeProcessPid: number | null = null;
  private readonly processByInstance = new Map<string, number>();
  public modHandler: ModHandler;

  private readonly diagnostics = new LauncherDiagnostics();

  constructor(sendProgress: (event: string, data?: unknown) => void) {
    events.setMaxListeners(50);

    this.defaultMinecraftRoot = getMinecraftRoot(
      path.join(app.getPath('userData'), '..'),
    );
    this.sendProgress = sendProgress;

    this.installShutdownHook();

    this.modHandler = new ModHandler(this.defaultMinecraftRoot);
  }

  addLog(
    bridgeInstanceId: string,
    message: string,
    type: 'stdout' | 'stderr' | 'info' | 'error' = 'info',
  ) {
    const entry = this.diagnostics.append(bridgeInstanceId, message, type);
    if (entry) this.sendLogBatch(bridgeInstanceId, [entry]);
  }

  getRecentLogs(bridgeInstanceId?: string): MinecraftLaunchLogSnapshot {
    const snapshot = this.diagnostics.snapshot();
    if (!bridgeInstanceId || snapshot.bridgeInstanceId === bridgeInstanceId) {
      return snapshot;
    }
    return { bridgeInstanceId, entries: [], truncated: false };
  }

  clearRecentLogs(bridgeInstanceId: string): boolean {
    return this.diagnostics.clear(bridgeInstanceId);
  }

  private sendLogBatch(
    bridgeInstanceId: string,
    entries: LaunchLogEntry[],
    reset = false,
  ): void {
    const payload: MinecraftLaunchLogBatch = {
      bridgeInstanceId,
      entries,
      reset,
      truncated: this.diagnostics.wasTruncated,
    };
    this.sendProgress('MC_LAUNCH_LOGS', payload);
  }

  private installShutdownHook() {
    if (MinecraftLauncher.cleanupHookInstalled) return;
    MinecraftLauncher.cleanupHookInstalled = true;

    const killAll = () => {
      void MinecraftLauncher.killAllRunningMinecraft();
    };

    app.on('before-quit', killAll);
    app.on('will-quit', killAll);
    process.once('exit', () => {
      void MinecraftLauncher.killAllRunningMinecraft();
    });
  }

  private static async killAllRunningMinecraft(): Promise<void> {
    const pids = [...MinecraftLauncher.runningPids].filter(
      (p) => Number.isFinite(p) && p > 0,
    );
    if (!pids.length) return;

    await Promise.all(
      pids.map(async (pid) => {
        try {
          await MinecraftLauncher.killProcessTree(pid);
        } catch {
          // best-effort
        } finally {
          MinecraftLauncher.runningPids.delete(pid);
        }
      }),
    );
  }

  private static isProcessAlive(pid: number): boolean {
    try {
      // Signal 0 checks existence without killing.
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private static async killProcessTree(pid: number): Promise<void> {
    if (!MinecraftLauncher.isProcessAlive(pid)) return;

    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () =>
          resolve(),
        );
      });
      return;
    }

    // POSIX: try graceful, then hard kill.
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }

    await new Promise((r) => setTimeout(r, 1500));

    if (MinecraftLauncher.isProcessAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
  }

  async launchMinecraft(
    options: LaunchMinecraftOptions,
    appSettings: AppSettings,
    session?: MinecraftUserSession,
    lunar?: {
      accounts: LunarAccount[];
      getSession: (name: string) => Promise<MinecraftUserSession>;
    },
  ): Promise<MinecraftLaunchResult> {
    if (!options?.username) throw new Error('Missing username');
    if (!options?.version) throw new Error('Missing version');

    const minecraftRoot = this.resolveMinecraftRoot(options.minecraftDirectory);
    await ensureDir(minecraftRoot);

    const username = options.username;
    const requestedVersionId = options.version;
    const server = options.server ?? appSettings.ip;
    const launcherFlags =
      options.launcherFlags ?? MinecraftLauncherTypes.VANILLA;
    const bridgeInstanceId = options.bridgeInstanceId ?? randomUUID();
    const taskRunner = new TaskRunner((event, data) => {
      const payload =
        data && typeof data === 'object'
          ? { ...data, bridgeInstanceId }
          : { bridgeInstanceId };
      this.sendProgress(event, payload);
    });

    this.diagnostics.begin(bridgeInstanceId);
    this.sendLogBatch(bridgeInstanceId, [], true);

    this.addLog(
      bridgeInstanceId,
      `[Launcher] Initializing launch for Minecraft ${requestedVersionId} (${username})...`,
      'info',
    );

    this.sendProgress('MC_LAUNCH_STATUS', {
      stage: 'installing',
      bridgeInstanceId,
      username,
      version: requestedVersionId,
      instancePath: minecraftRoot,
    });

    try {
      this.addLog(
        bridgeInstanceId,
        `[Launcher] Resolving version manifest and loader...`,
        'info',
      );

      const resolvedUuid =
        session?.uuid ?? (await uuid(username)) ?? offlineUuid(username);
      const resolvedName = session?.name ?? username;

      // Lunar runs from its own install, everything else from a resolved version
      const version =
        launcherFlags === MinecraftLauncherTypes.LUNAR
          ? null
          : await MinecraftVersion.fromVersionId(requestedVersionId, {
              launcher: launcherFlags,
              minecraftRoot,
              taskRunner,
            });

      if (version) {
        const activeMods =
          await this.modHandler.loadAllActiveMods(requestedVersionId);
        console.log(
          'Loading mods for version',
          requestedVersionId,
          'found',
          activeMods,
        );
        version.addMods(activeMods);
      }
      const launchVersionId = version?.version.id ?? requestedVersionId;

      this.addLog(
        bridgeInstanceId,
        `[Launcher] Version resolved (${launchVersionId}). Checking runtime and dependencies...`,
        'info',
      );

      this.sendProgress('MC_LAUNCH_STATUS', {
        stage: 'launching',
        bridgeInstanceId,
        username,
        version: requestedVersionId,
        launchVersionId,
        launcherFlags,
        instancePath: minecraftRoot,
      });

      const extraJVMArgs: string[] = options.extraJvmArgs?.length
        ? [options.extraJvmArgs]
        : [];
      if (bridgeInstanceId) {
        extraJVMArgs.push(`-Djnbot.bridge.instanceId=${bridgeInstanceId}`);
      }

      this.addLog(
        bridgeInstanceId,
        `[Launcher] Starting Minecraft process...`,
        'info',
      );

      const proc = version
        ? await version.launch({
            minMemory: options.minMemoryMB,
            maxMemory: options.maxMemoryMB,
            extraJVMArgs: extraJVMArgs,
            gameProfile: {
              name: resolvedName,
              id: resolvedUuid.replace(/-/g, ''),
            },
            accessToken: session?.accessToken ?? '',
            userType: session ? 'mojang' : 'legacy',
            resolution: {
              fullscreen: options.window?.fullscreen ?? false,
            },
            ...(server ? { quickPlayMultiplayer: server } : {}),
          })
        : await launchLunarClient({
            version: requestedVersionId,
            gameDir: path.join(minecraftRoot, 'lunar'),
            session: {
              name: resolvedName,
              uuid: resolvedUuid,
              accessToken: session?.accessToken,
            },
            accounts: lunar?.accounts,
            getSession: lunar?.getSession,
            maxMemoryMB: options.maxMemoryMB,
            server,
            jvmArgs: [
              ...(options.extraJvmArgs?.split(' ').filter(Boolean) ?? []),
              `-Djnbot.bridge.instanceId=${bridgeInstanceId}`,
              // Lunar's Fabric loader honours addMods; its profile already ships Fabric API
              ...(isJnbotModAvailable(requestedVersionId)
                ? [`-Dfabric.addMods=${(await installJnbotMod(requestedVersionId)).jarPath}`]
                : []),
            ],
            log: (message) => this.addLog(bridgeInstanceId, message),
          });

      this.addLog(
        bridgeInstanceId,
        `[Launcher] Process spawned (PID: ${proc.pid ?? -1})`,
        'info',
      );

      let stdoutTail = '';
      let stderrTail = '';
      let pendingOutput: LaunchLogEntry[] = [];
      let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const flushOutput = () => {
        if (outputFlushTimer) clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
        if (!pendingOutput.length) return;
        this.sendLogBatch(bridgeInstanceId, pendingOutput);
        pendingOutput = [];
      };
      const pushOutput = (chunk: unknown, type: 'stdout' | 'stderr') => {
        if (type === 'stdout')
          stdoutTail = appendTextTail(stdoutTail, chunk, 64 * 1024);
        else stderrTail = appendTextTail(stderrTail, chunk, 64 * 1024);

        const entries = this.diagnostics.appendOutput(
          bridgeInstanceId,
          chunk,
          type,
        );
        if (!entries.length) return;
        pendingOutput = [...pendingOutput, ...entries].slice(-500);
        if (!outputFlushTimer) outputFlushTimer = setTimeout(flushOutput, 50);
      };

      const procWithIo = proc as unknown as {
        stdout?: NodeJS.ReadableStream | null;
        stderr?: NodeJS.ReadableStream | null;
      };
      procWithIo.stdout?.on('data', (chunk: unknown) =>
        pushOutput(chunk, 'stdout'),
      );
      procWithIo.stderr?.on('data', (chunk: unknown) =>
        pushOutput(chunk, 'stderr'),
      );

      this.activeProcessPid = proc.pid ?? null;
      if (this.activeProcessPid)
        MinecraftLauncher.runningPids.add(this.activeProcessPid);
      if (proc.pid) {
        this.processByInstance.set(bridgeInstanceId, proc.pid);
      }

      const watcher = createMinecraftProcessWatcher(proc);
      watcher.on('minecraft-window-ready', () => {
        this.addLog(
          bridgeInstanceId,
          `[Launcher] Minecraft window ready`,
          'info',
        );
        this.sendProgress('MC_LAUNCH_STATUS', {
          stage: 'window-ready',
          bridgeInstanceId,
          username,
          version: requestedVersionId,
          launchVersionId,
          pid: proc.pid,
        });
      });

      watcher.on('minecraft-exit', (event) => {
        flushOutput();
        this.addLog(
          bridgeInstanceId,
          `[Launcher] Process exited with code ${event.code} (signal: ${event.signal ?? 'none'})`,
          event.code === 0 ? 'info' : 'error',
        );
        if (this.activeProcessPid === proc.pid) this.activeProcessPid = null;
        if (proc.pid) MinecraftLauncher.runningPids.delete(proc.pid);
        this.processByInstance.delete(bridgeInstanceId);
        this.sendProgress('MC_LAUNCH_STATUS', {
          stage: 'exit',
          bridgeInstanceId,
          username,
          version: requestedVersionId,
          launchVersionId,
          pid: proc.pid,
          code: event.code,
          signal: event.signal,
        });

        if (event.code !== 0) {
          void (async () => {
            const crashInfo = await collectCrashInfo({
              bridgeInstanceId,
              username,
              version: requestedVersionId,
              instancePath: minecraftRoot,
              code: event.code,
              signal: event.signal,
              stdoutTail,
              stderrTail,
            });
            console.error('Minecraft crash info', crashInfo);
            this.sendProgress('MC_LAUNCH_CRASH_INFO', crashInfo);
          })();
        }
      });

      watcher.on('error', (error) => {
        flushOutput();
        const errorMsg = error?.message ?? String(error);
        this.addLog(
          bridgeInstanceId,
          `[Launcher] Process error: ${errorMsg}`,
          'error',
        );
        if (this.activeProcessPid === proc.pid) this.activeProcessPid = null;
        if (proc.pid) MinecraftLauncher.runningPids.delete(proc.pid);
        this.processByInstance.delete(bridgeInstanceId);
        this.sendProgress('MC_LAUNCH_STATUS', {
          stage: 'error',
          bridgeInstanceId,
          username,
          version: requestedVersionId,
          launchVersionId,
          pid: proc.pid,
          error: errorMsg,
        });

        void (async () => {
          const crashInfo = await collectCrashInfo({
            bridgeInstanceId,
            username,
            version: requestedVersionId,
            instancePath: minecraftRoot,
            error,
            stdoutTail,
            stderrTail,
          });
          console.error('Minecraft launch error details', crashInfo);
          this.sendProgress('MC_LAUNCH_CRASH_INFO', crashInfo);
        })();
      });

      return {
        pid: proc.pid ?? -1,
        instancePath: minecraftRoot,
        minecraftRoot,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addLog(
        bridgeInstanceId,
        `[Launcher] Launch failed: ${errorMsg}`,
        'error',
      );
      this.sendProgress('MC_LAUNCH_STATUS', {
        stage: 'error',
        bridgeInstanceId,
        username,
        version: requestedVersionId,
        error: errorMsg,
      });
      throw error;
    }
  }

  async stopMinecraft(instanceId: string): Promise<boolean> {
    const pid = this.processByInstance.get(instanceId);
    if (!pid) return false;
    await MinecraftLauncher.killProcessTree(pid);
    this.processByInstance.delete(instanceId);
    MinecraftLauncher.runningPids.delete(pid);
    if (this.activeProcessPid === pid) this.activeProcessPid = null;
    return true;
  }

  private async fetchAllVersions(
    verionCachePath: string,
    limit?: number,
  ): Promise<VersionInfo[]> {
    console.log('Fetching all minecraft versions...');

    const results = await Promise.allSettled([
      MinecraftVersion.getAllVersions(),
      this.getJnbotSupportedMinecraftVersions(),
      MinecraftVersion.getFabricVersionList(),
      MinecraftVersion.getQuiltVersionList(),
      getLunarVersions(),
      // MinecraftVersion.getForgeVersionList(),
      // MinecraftVersion.getLabyModVersionList(),
    ]);

    const [
      vanillaResult,
      jnbotResult,
      fabricResult,
      quiltResult,
      lunarResult,
      //  forgeResult,
      // labyModResult,
    ] = results;

    const extractVersions = <T>(
      result: PromiseSettledResult<T>,
      name: string,
    ): T => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`Failed to fetch ${name} versions:`, result.reason);
        return [] as T;
      }
    };

    const vanillaVersions = extractVersions(vanillaResult, 'vanilla');
    const jnbotVersions = extractVersions(jnbotResult, 'jnbot');
    const fabricVersions = extractVersions(fabricResult, 'fabric');
    const quiltVersions = extractVersions(quiltResult, 'quilt');
    const lunarVersions = extractVersions(lunarResult, 'lunar');
    // const forgeVersions = extractVersions(forgeResult, 'forge');
    // const labyModVersions = extractVersions(labyModResult, 'labymod');

    let limitedVanillaVersions = vanillaVersions;
    if (limit) {
      const snapshots = vanillaVersions
        .filter((v) => v.type === 'snapshot')
        .slice(0, limit);

      const nonSnapshots = vanillaVersions.filter((v) => v.type !== 'snapshot');
      limitedVanillaVersions = [...nonSnapshots, ...snapshots];
    }

    const allVersions = [
      ...jnbotVersions,
      ...lunarVersions,
      ...limitedVanillaVersions,
      ...fabricVersions,
      /*...optifineVersions,*/ ...quiltVersions,
      // ...forgeVersions,
      // ...labyModVersions,
    ];
    fs.writeFile(
      verionCachePath,
      JSON.stringify({
        launcherVersion: MinecraftLauncher.VERSION,
        versions: allVersions,
        lastFetched: Date.now(),
      } satisfies MinecraftVersionFetchCache),
      'utf8',
    ).catch((err) => {
      console.error('Failed to write minecraft version cache:', err);
    });
    console.log('Total minecraft versions fetched:', allVersions.length);
    return allVersions;
  }

  async getMinecraftVersions(params?: {
    limit?: number;
  }): Promise<VersionInfo[]> {
    const verionCachePath = path.join(
      app.getPath('userData'),
      'mc_version_cache.json',
    );

    if (
      await fs
        .access(verionCachePath)
        .then(() => true)
        .catch(() => false)
    ) {
      const data = await fs.readFile(verionCachePath, 'utf8').catch(() => null);
      if (data) {
        try {
          const jsonData = JSON.parse(data) as MinecraftVersionFetchCache;
          console.log(
            'Loaded minecraft version cache, launcher version:',
            jsonData.launcherVersion,
            'current version:',
            MinecraftLauncher.VERSION,
          );
          if (jsonData.launcherVersion === MinecraftLauncher.VERSION) {
            if (
              !jsonData.lastFetched ||
              jsonData.lastFetched + 60 * 60 * 1000 < Date.now()
            ) {
              this.fetchAllVersions(verionCachePath, params?.limit);
            }
            return jsonData.versions;
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
    return this.fetchAllVersions(verionCachePath, params?.limit);
  }

  async getJnbotSupportedMinecraftVersions(): Promise<VersionInfo[]> {
    const { versions } = await getJnbotModManifest();
    return Object.keys(versions).map((key) => ({
      id: key,
      launcherType: MinecraftLauncherTypes.JNBOT_CLIENT,
      name: key,
      type: 'release',
    }));
  }

  private resolveMinecraftRoot(minecraftDirectory?: string) {
    const trimmed = minecraftDirectory?.trim();
    return trimmed ? trimmed : this.defaultMinecraftRoot;
  }
}
