import { ActiveScriptsType, ExtendedProgress } from '../types';
import { BrowserWindow } from 'electron';

import ScriptHandler_ from './ScriptHandler';
import Script_ from './Script';
import Settings_ from './Settings';
import EventEmitter from 'node:events';
import { backendMessaging } from '../messaging';

class ActiveScripts_ extends EventEmitter {
  mainWindow: BrowserWindow;
  scripts: { [instanceId: number]: Script_ } = {};
  minecraftEntries: ActiveScriptsType = {};
  settings: Settings_;
  queue: Set<Script_> = new Set();
  scriptHandler: ScriptHandler_;
  readonly profileId: number;
  readonly profileKey: string;

  constructor(
    mainWindow: BrowserWindow,
    settings: Settings_,
    scriptHandler: ScriptHandler_,
    profileId: number,
    profileKey: string,
  ) {
    super();
    this.mainWindow = mainWindow;
    this.settings = settings;
    this.scriptHandler = scriptHandler;
    this.profileId = profileId;
    this.profileKey = profileKey;
    process.once('exit', () => this.onExit());
  }

  addScript(script: Script_) {
    this.scripts[script.instanceId] = script;
    this.queue.delete(script);
    this.emit('script-started', script);
    this.send();
  }

  upsertMinecraftInstance(info: {
    instanceId: string;
    requestedVersion?: string;
    stage?: string;
    status?: string;
    pid?: number;
    clientId?: string;
  }) {
    const key = `minecraft:${info.instanceId}`;
    const existing = this.minecraftEntries[key];

    this.minecraftEntries[key] = {
      name: existing?.name ?? 'Minecraft',
      origin: 'minecraft',
      scriptId: existing?.scriptId ?? 'minecraft',
      instanceId: existing?.instanceId ?? -Math.abs(this.hashString(key)),
      minecraft: {
        ...existing?.minecraft,
        ...info,
      },
    };
    this.send();
  }

  removeMinecraftInstance(instanceId: string) {
    const key = `minecraft:${instanceId}`;
    if (!this.minecraftEntries[key]) return;
    delete this.minecraftEntries[key];
    this.send();
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return hash;
  }

  toObject(): ActiveScriptsType {
    let obj: ActiveScriptsType = {};
    Object.values(this.scripts).forEach((s) => {
      obj[s.instanceId] = {
        name: s.name,
        scriptId: s.scriptId,
        pluginId: s.pluginId,
        runtimeProfileId: s.runtimeProfileId,
        runtimeScriptId: s.runtimeScriptId,
        address: s.messagingAddress,
        instanceId: s.instanceId,
        controls: s.controls,
      };
    });
    obj = {
      ...obj,
      ...this.minecraftEntries,
    };
    return obj;
  }

  send() {
    backendMessaging.messenger.publishToProfile(
      this.profileId,
      'activeScripts',
      this.toObject(),
    );
    this.scriptHandler.publishRuntimeSummary(this.profileId);
  }

  sendTo(instanceId: number, event: string, data: any) {
    const script = this.getScript(instanceId);
    if (!script) return console.warn('script id not found', instanceId);
    script.send(event, data);
  }

  removeScript(script: Script_) {
    if (!(script.instanceId in this.scripts)) return;
    this.scriptHandler
      .getRuntime(this.profileId)
      .scriptActionHandler.quitScript(script.instanceId);
    delete this.scripts[script.instanceId];
    this.emit('script-ended', script.instanceId);
    this.send();
  }

  prepare(script: Script_): void {
    this.queue.add(script);
  }

  getScript(instanceId: number): Script_ | null {
    return this.scripts[instanceId] ?? null;
  }

  isActiveScript(instanceId: number): boolean {
    return instanceId in this.scripts;
  }

  getScriptName(instanceId: number): string | null {
    return this.scripts[instanceId]?.name ?? null;
  }

  getProgress(instanceId: number): ExtendedProgress | null;
  getProgress(): Record<number, ExtendedProgress>;
  getProgress(
    instanceId?: number,
  ): Record<number, ExtendedProgress> | ExtendedProgress | null {
    if (instanceId !== undefined) {
      const script = this.scripts[instanceId];
      if (!script?.progress) return null;
      const progress: ExtendedProgress = {
        current: script.progress.current || 0,
        total: script.progress.total || 0,
        eta: script.progress.eta,
        instanceId,
      };
      if (progress.total === 0) return null;
      return progress;
    } else {
      const progresses: Record<number, ExtendedProgress> = {};
      Object.values(this.scripts).forEach((s) => {
        const progress = this.getProgress(s.instanceId);
        if (progress) {
          progresses[progress.instanceId] = progress;
        }
      });
      return progresses;
    }
  }

  onExit() {
    Object.values(this.scripts).forEach((s) => {
      delete this.scripts[s.instanceId];
    });
  }

  toString() {
    return `${Object.values(this.scripts)
      .map((s) => s.toString())
      .join(',\n')}`;
  }

  getScriptsByScriptId(scriptId: string): Script_[] {
    return Object.values(this.scripts).filter((s) => s.scriptId === scriptId);
  }

  getScriptsByName(name: string): Script_[] {
    return Object.values(this.scripts).filter((s) => s.name === name);
  }

  *[Symbol.iterator]() {
    for (const script of Object.values(this.scripts)) {
      yield script;
    }
  }
}

export default ActiveScripts_;
