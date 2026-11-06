import type { ActiveScriptsType, ScriptOptions } from '../../main/src/types';
import type React from 'react';
import { withPreset } from '../../common/pluginPresets';

export type StartScriptPayload = {
  script: string;
  arguments?: any;
  console?: string;
  scriptOptions?: ScriptOptions;
};

export class ActiveScriptsService {
  private state: ActiveScriptsType;

  constructor(state: ActiveScriptsType) {
    this.state = state || {};
  }

  get raw(): ActiveScriptsType {
    return this.state;
  }

  isScriptActiveByName(name: string): boolean {
    return Object.values(this.state).some((s) => s?.name === name);
  }

  isScriptActiveById(scriptId: string): boolean {
    return Object.values(this.state).some((v) => v?.scriptId === scriptId);
  }

  getInstanceIdsByName(name: string): number[] {
    return Object.values(this.state)
      .filter((v) => v?.name === name)
      .map((v) => v.instanceId)
      .filter(Boolean);
  }

  getInstancesById(scriptId: string) {
    return Object.values(this.state).filter(
      (v) => v?.scriptId === scriptId && v.instanceId,
    );
  }

  getInstanceIdsById(scriptId: string): number[] {
    return this.getInstancesById(scriptId).map((v) => v.instanceId);
  }

  send(instanceId: number, event: string, data?: unknown) {
    const script = Object.values(this.state).find(
      (value) => value.instanceId === instanceId,
    );
    if (script?.runtimeProfileId && script.runtimeScriptId) {
      window.messenger.sendToScript(
        script.runtimeProfileId,
        script.runtimeScriptId,
        event,
        data,
      );
      return;
    }
    throw new Error(`Script ${instanceId} has no messaging address`);
  }

  stop(instanceId: number) {
    const script = Object.values(this.state).find(
      (value) => value.instanceId === instanceId,
    );
    if (script?.origin === 'minecraft' && script.minecraft?.instanceId) {
      window.ipcRenderer.action('STOP', {
        minecraftInstanceId: script.minecraft.instanceId,
      });
      return;
    }
    window.ipcRenderer.action('STOP', instanceId);
  }

  stopByScriptId(scriptId: string) {
    for (const id of this.getInstanceIdsById(scriptId)) {
      this.stop(id);
    }
  }

  stopByName(name: string) {
    for (const id of this.getInstanceIdsByName(name)) {
      this.stop(id);
    }
  }

  /** Backwards-compat: accepts either a numeric instance id or a script name. */
  stopAll(target: number | string) {
    if (typeof target === 'number') this.stop(target);
    else this.stopByName(target);
  }

  restart(instanceId: number) {
    window.ipcRenderer.action('RESTART_ALL', instanceId);
  }

  /** Send a single ScriptControl bit (pause/resume/skip/etc.) to a running script. */
  sendControl(instanceId: number, control: number) {
    window.ipcRenderer.action('SCRIPT_CONTROL', { instanceId, control });
  }

  async startScript(payload: StartScriptPayload) {
    return await window.ipcRenderer.get('START_SCRIPT', payload);
  }

  /** Start an instance of a plugin, on the given preset or else the selected one. */
  async runPlugin(
    macroInfo: { pluginId: string; name?: string },
    presetId?: string,
  ) {
    return await this.startScript({
      script: 'macro',
      arguments: {
        macroInfo,
        devMode: false,
        optionOverrides: withPreset({}, presetId),
      },
      console: 'macro_console',
    });
  }

  async startMacro({
    pluginInfo,
    args,
    consoleType = 'console',
    codeRef,
  }: {
    pluginInfo: any;
    args?: any;
    consoleType?: string;
    codeRef?: React.RefObject<any>;
  }) {
    if (!pluginInfo?.pluginId) return;

    if (this.isScriptActiveById(pluginInfo.pluginId)) {
      this.stopByScriptId(pluginInfo.pluginId);
      return;
    }

    const payload: StartScriptPayload = {
      script: 'macro',
      arguments: {
        macroInfo: pluginInfo,
        ...(args || {}),
      },
      console: consoleType,
    };

    if (codeRef?.current) {
      payload.arguments = {
        ...payload.arguments,
        components: { code: codeRef.current },
      };
    }

    return await this.startScript(payload);
  }
}

export const makeActiveScriptsService = (state: ActiveScriptsType) =>
  new ActiveScriptsService(state);
