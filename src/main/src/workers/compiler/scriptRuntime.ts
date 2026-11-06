import type { MacroInfo } from '../../types';
import type { AltUpdateRequest, ScriptAPI } from 'common/types/pluginApi';
import * as scriptApi from './scriptApi';
import workerScript from '../lib/workerScript';
import BotMachine from '../bot/statemachines/BotMachine';
import Bot from '../bot/Bot';
import Brain from '../brain/Brain';
import * as proxyV3 from '../bot/proxyV3';
import { ScriptControl } from 'common/CommonEnums';
import WorkerAutomationApi from '../lib/WorkerAutomationApi';
import AiClient from '../../ai/AiClient';

/* ---------- script.* object ----------
 *
 * The per-run `script` API: the stateless helpers in `scriptApi` bound to this
 * run's `scriptInfo` + user `options`. Shared verbatim by plugins and profile
 * bot extensions so both get exactly the same surface.
 */

function buildScript(scriptInfo: MacroInfo, options: Record<string, any> = {}) {
  const blocked = (capability: string) => () => {
    throw new Error(
      `AI-authored plugins are not allowed to use ${capability}.`,
    );
  };
  const ai = scriptInfo.security?.ai;
  const networkAllowed = !ai || ai.networkAllowed;
  return {
    stop: scriptApi.stop,
    restart: scriptApi.restart,
    onExit: scriptApi.onExit,
    prompt: scriptApi.prompt,
    notification: scriptApi.notification,
    snackbar: scriptApi.snackbar,
    dialog: scriptApi.dialog,
    updateProgress: scriptApi.updateProgress,
    setControls: scriptApi.setControls,
    onControl: scriptApi.onControl,
    Controls: ScriptControl,
    optionError: (opts: scriptApi.OptionErrorOptions) =>
      scriptApi.optionError(opts, scriptInfo),
    startPlugin: scriptApi.startPlugin,
    stopPlugin: scriptApi.stopPlugin,
    startScript: scriptApi.startScript,
    stopScript: scriptApi.stopScript,
    getActiveScripts: scriptApi.getActiveScripts,
    getPluginInfo: scriptApi.getPluginInfo,
    runAction: scriptApi.runAction,
    startAction: scriptApi.startAction,
    getAlts: scriptApi.getAlts,
    requestAccountPassword: ai
      ? blocked('account passwords')
      : scriptApi.requestAccountPassword,
    forEachBot: scriptApi.forEachBot,
    forEachAlt: scriptApi.forEachAlt,
    requestAltUpdate: (updates: AltUpdateRequest) =>
      scriptApi.requestAltUpdate(updates, scriptInfo),
    getCooldowns: () => scriptApi.getCooldowns(scriptInfo.pluginId),
    getReminders: () => scriptApi.getReminders(scriptInfo.pluginId),
    automations: new WorkerAutomationApi(),
    ai: new AiClient((request) => {
      if (request.kind === 'cancel') {
        workerScript.send('AI_CANCEL', request);
        return Promise.resolve({ kind: 'ended' });
      }
      const remaining = 'deadline' in request
        ? Math.max(1, request.deadline - Date.now())
        : 120_000;
      return workerScript.sendAsync('AI_REQUEST', request, {
        // RequestScope owns long deadlines; Node's transport timer is 32-bit.
        timeoutMs: remaining > 2_147_483_647 ? 0 : remaining,
      });
    }, networkAllowed),

    addCooldown: (d: scriptApi.AddCooldownOptions) =>
      scriptApi.addCooldown(d, scriptInfo.pluginId),
    addReminder: (d: scriptApi.AddReminderOptions) =>
      scriptApi.addReminder(d, scriptInfo.pluginId),
    sendDiscordMessage: networkAllowed
      ? scriptApi.sendDiscordMessage
      : blocked('external network access'),
    getMcClients: ai
      ? blocked('Fabric clients')
      : global.client?.getMcClients?.bind(global.client) ?? (() => []),
    getMcClient: ai
      ? blocked('Fabric clients')
      : global.client?.getMcClient?.bind(global.client) ?? (() => undefined),
    getMcServers: ai
      ? blocked('managed servers')
      : global.client?.getMcServers?.bind(global.client) ?? (() => []),
    getMcServer: ai
      ? blocked('managed servers')
      : global.client?.getMcServer?.bind(global.client) ?? (() => undefined),
    scriptInfo: { ...scriptInfo },
    settings: options,
    JNdata: { gamemodes: workerScript.workerData?.profile?.gamemodes ?? {} },
    appVersion: scriptApi.appVersion,
  } satisfies ScriptAPI;
}

// Compile-time guarantee that the runtime `script` object stays in sync with the
// public ScriptAPI surface (single-sourced in common/pluginApi.d.ts → generates
// fullApiTypes.txt). If you add/rename a `script.*` method, update ScriptAPI and
// this will keep them honest.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
buildScript satisfies (
  scriptInfo: MacroInfo,
  options?: Record<string, any>,
) => ScriptAPI;

/* ---------- the "JNbot" package exposed via require('JNbot') ----------
 *
 * The clean, importable surface for jnbot-specific helpers. `script` is
 * per-run so the package is built per run; everything else is shared.
 */

function buildJNbotPackage(script: ScriptAPI, scriptInfo: MacroInfo) {
  const ai = scriptInfo.security?.ai;
  const denied = class {
    constructor() {
      throw new Error('AI-authored plugins are not allowed to use proxy APIs.');
    }
  };
  const proxy = ai
    ? {
        ProxyServer: denied,
        ProxyPlugin: denied,
        ProxySession: denied,
        ProxyParticipant: denied,
        PluginManager: denied,
        PacketPipeline: denied,
        PacketContext: denied,
        DebugPlugin: denied,
        PacketGroups: undefined,
        RECORDINGS_PATH: undefined,
        ANY_PACKET: undefined,
      }
    : {
        ProxyServer: proxyV3.ProxyServer,
        ProxyPlugin: proxyV3.Plugin,
        ProxySession: proxyV3.Session,
        ProxyParticipant: proxyV3.Participant,
        PluginManager: proxyV3.PluginManager,
        PacketPipeline: proxyV3.PacketPipeline,
        PacketContext: proxyV3.PacketContext,
        DebugPlugin: proxyV3.DebugPlugin,
        PacketGroups: proxyV3.PacketGroups,
        RECORDINGS_PATH: proxyV3.RECORDINGS_PATH,
        ANY_PACKET: proxyV3.ANY_PACKET,
      };
  return {
    Bot,
    BotMachine,
    Brain,
    ...proxy,
    script,
    join: Bot.join,
  };
}

/* ---------- module allow-list exposed via require() ---------- */

function fixtureAxios() {
  if (!workerScript.workerData?.testHarness?.http) return require('axios');

  return {
    async get(url: string, config?: unknown) {
      const response = await workerScript.sendAsync<{
        ok: boolean;
        data?: unknown;
        status?: number;
        headers?: Record<string, string>;
        error?: string;
      }>('TEST_HTTP_REQUEST', { method: 'GET', url, config });
      if (!response?.ok)
        throw new Error(response?.error || `No fixture response for ${url}`);
      return {
        data: response.data,
        status: response.status ?? 200,
        headers: response.headers ?? {},
      };
    },
  };
}

const allowedModules: Record<string, () => any> = {
  events: () => require('events'),
  axios: fixtureAxios,
  'mineflayer-pathfinder': () => require('mineflayer-pathfinder'),
  'prismarine-item': () => require('prismarine-item'),
  'prismarine-entity': () => require('prismarine-entity'),
  'prismarine-block': () => require('prismarine-block'),
  'prismarine-world': () => require('prismarine-world'),
  'prismarine-chunk': () => require('prismarine-chunk'),
  'prismarine-chat': () => require('prismarine-chat'),
  'prismarine-nbt': () => require('prismarine-nbt'),
  'prismarine-windows': () => require('prismarine-windows'),
  vec3: () => require('vec3'),
  assert: () => require('assert'),
  nbt: () => require('prismarine-nbt'),
  jnbotNbt: () => require('../bot/extensions/nbtParser'),
};

function makeSandboxRequire(
  jnbotPackage: ReturnType<typeof buildJNbotPackage>,
  scriptInfo: MacroInfo,
) {
  return function sandboxRequire(name: string) {
    if (name === 'JNbot' || name === 'jnbot') return jnbotPackage;
    if (
      scriptInfo.security?.ai &&
      name === 'axios' &&
      !scriptInfo.security.ai.networkAllowed
    )
      throw new Error(
        'This AI-authored plugin has no external network permission.',
      );
    if (allowedModules[name]) return allowedModules[name]();

    throw new Error(`Module "${name}" is not allowed in the plugins.`);
    // return nativeRequire(name);
  };
}

/**
 * Assemble everything a unit of user code needs to run: its bound `script`
 * object, the importable `JNbot` package, and the `require` that resolves the
 * module allow-list (and `require('JNbot')`), falling back to Node's resolver.
 *
 * Used by plugins and profile bot actions through compiler/jsRuntime.
 */
export function buildScriptRuntime(
  scriptInfo: MacroInfo,
  options: Record<string, any> = {},
) {
  const script = buildScript(scriptInfo, options);
  const jnbotPackage = buildJNbotPackage(script, scriptInfo);
  return {
    script,
    jnbotPackage,
    require: makeSandboxRequire(jnbotPackage, scriptInfo),
  };
}
