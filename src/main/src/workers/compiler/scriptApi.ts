import { workerData } from 'worker_threads';
import axios from 'axios';
import type { AltWithData, MacroInfo } from '../../types';
import workerScript from '../lib/workerScript';
import { iterateBots, iterateAlts } from '../scripts/iterateAlts';
import { Bot } from '../workerTypes';
import {
  AltUpdateData,
  AltUpdateRequest,
  AppVersion,
  DialogOptions,
  IterateAltsOptions,
  NotificationOptions,
  ProgressUpdate,
  PromptOptions,
  SnackbarOptions,
  StartPluginOptions,
} from 'common/types/pluginApi';
import scriptActionRunner from './scriptActions';
import { findPresetId, withPreset } from '../../../../common/pluginPresets';
import { isOnlineMode } from 'common/serverAuthentication';

const BUTTON_TYPES = new Set(['default', 'primary', 'dashed', 'link', 'text']);

const activeScripts = new Set<string>();
const passwordAccessAccounts = new Set<string>();
let passwordAccessForAllAccounts = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- UI helpers ---------- */

export function notification({ type, title, message }: NotificationOptions) {
  if (!type) throw new Error('notification: type is required');
  if (title?.length > 40)
    throw new Error('notification: title too long (max 40)');
  if (message?.length > 200)
    throw new Error('notification: message too long (max 200)');
  global.sendToClients('notification', { type, title, message });
}

export function snackbar({ type, title }: SnackbarOptions) {
  if (!type) throw new Error('snackbar: type is required');
  if (title?.length > 60) throw new Error('snackbar: title too long (max 60)');
  global.sendToClients('snackbar', { variant: type, title });
}

export function prompt(opts: PromptOptions): Promise<{ response: string }> {
  return new Promise((resolve, reject) => {
    const promptID = 'prompt-' + Math.random();

    function handle(response: any) {
      if (response?.promptID !== promptID) return;
      unsubscribe();
      if (response?.cancel) return reject(new Error("User cancelled prompt"));
      resolve({ response: response.value });
    }

    const unsubscribe = workerScript.onMessage('macro-prompt', handle);
    global.sendToClients('macro-prompt', {
      title: opts.title,
      label: opts.label,
      placeholder: opts.placeholder,
      defaultValue: opts.defaultValue,
      description: opts.description,
      promptID,
      scriptInstance: workerData.id,
      scriptId: workerData.pluginId,
      instanceId: workerData.instanceId,
      runtimeProfileId: workerData.messaging.profileId,
      runtimeScriptId: workerData.messaging.scriptId,
      messageAddress: workerData.messaging.address,
    });
  });
}

export function dialog({ title, body, buttons }: DialogOptions): Promise<any> {
  if (!title) throw new Error('dialog: title is required');
  if (title.length > 40) throw new Error('dialog: title too long (max 40)');
  if (body?.length > 400) throw new Error('dialog: body too long (max 400)');
  if (!Array.isArray(buttons))
    throw new Error('dialog: buttons must be an array');
  if (buttons.length === 0)
    throw new Error('dialog: at least one button required');
  if (buttons.length > 5) throw new Error('dialog: too many buttons (max 5)');
  if (buttons.some((b) => !b.label || b.label.length > 20))
    throw new Error('dialog: button label missing or too long (max 20)');
  if (buttons.some((b) => !BUTTON_TYPES.has(b.type)))
    throw new Error(
      'dialog: invalid button type, must be one of ' +
        [...BUTTON_TYPES].join(', '),
    );

  return new Promise((resolve) => {
    const id = Date.now() + Math.random();

    let unsubscribe = () => {};
    unsubscribe = workerScript.onMessage('DIALOG', function handle(data: any) {
      if (data.id !== id) return;
      unsubscribe();
      resolve(data.response);
    });

    global.sendToClients('DIALOG', {
      id,
      title,
      body,
      buttons,
      script: workerData.script,
      instanceId: workerData.instanceId,
      messageAddress: workerData.messaging.address,
      runtimeProfileId: workerData.messaging.profileId,
      runtimeScriptId: workerData.messaging.scriptId,
    });
  });
}

export function updateProgress({ current, total }: ProgressUpdate) {
  const c = Number(current);
  const t = Number(total);
  if (isNaN(c) || isNaN(t))
    throw new Error('updateProgress: current and total must be numbers');

  workerScript.setProgress({ current: c, total: t });
}

/**
 * Enable a set of runner control buttons in the UI for this script. `controls`
 * is a `ScriptControl` bitfield, e.g. `ScriptControl.PAUSE | ScriptControl.SKIP`.
 * Pass `ScriptControl.NONE` (0) to hide all of them.
 */
export function setControls(controls: number) {
  if (
    typeof controls !== 'number' ||
    !Number.isFinite(controls) ||
    controls < 0
  ) {
    throw new Error(
      'setControls: controls must be a non-negative ScriptControl bitfield',
    );
  }
  workerScript.setControls(controls);
}

/**
 * Register a handler called when the user clicks one of the enabled control
 * buttons. The handler receives the single pressed `ScriptControl` bit.
 * Returns a function that removes the listener.
 */
export function onControl(handler: (control: number) => void): () => void {
  if (typeof handler !== 'function')
    throw new Error('onControl: handler must be a function');
  return workerScript.onControl(handler);
}

export type OptionErrorOptions = {
  /** The setting id (matches `id` in the script's config option). */
  field: string;
  /** Short error message shown next to the field. */
  message: string;
};

/**
 * Signal that a script/plugin setting is invalid. The UI will open the
 * settings panel for the current script and highlight the field with the
 * given message. Works identically for plugins (scripts in the Plugins
 * page) and dashboard profile scripts.
 */
export function optionError(
  { field, message }: OptionErrorOptions,
  scriptInfo?: MacroInfo,
) {
  workerScript.optionError({ field, message }, scriptInfo);
}

/* ---------- Lifecycle ---------- */

export async function restart(): Promise<never> {
  await sleep(500);
  global.send('RESTART');
  throw new Error("Restarting")
}

export function stop(): never {
  process.exit(0);
}

/**
 * Register a handler invoked when this script is about to end — fired when the
 * app stops the script (stop button, app close, restart). You get a short grace
 * window (~100ms, longer if your script opted into `waitBeforeTerminate`) to do
 * cleanup before the worker is killed, so keep the handler quick and avoid
 * long-running async work. Returns a function that removes the listener.
 */
export function onExit(handler: () => void): () => void {
  if (typeof handler !== 'function')
    throw new Error('onExit: handler must be a function');
  return workerScript.onceMessage('TERMINATE', handler);
}

/** Add a preset, picked by name or id, to a run's option overrides. */
function presetOverrides(
  pluginId: string,
  preset?: string,
  optionOverrides?: Record<string, any>,
) {
  if (!preset) return optionOverrides;
  const presetId = findPresetId(global.settings.scripts?.[pluginId], preset);
  if (!presetId) throw new Error(`${pluginId} has no preset "${preset}"`);
  return withPreset(optionOverrides ?? {}, presetId);
}

export function startPlugin({
  name,
  pluginId,
  preset,
  optionOverrides,
}: StartPluginOptions) {
  if (!pluginId) throw new Error('startPlugin: name and pluginId are required');
  if (pluginId.toLowerCase() === 'kit collector' || name === 'kit collector') {
    pluginId = 'mpqqzf5mlsgzkgxyk7d';
  }
  global.send('SIMULATE', [
    'START_SCRIPT',
    {
      script: 'macro',
      arguments: {
        macroInfo: { name, pluginId },
        optionOverrides: presetOverrides(pluginId, preset, optionOverrides),
      },
    },
  ]);
}

export function stopPlugin({ pluginId }: { pluginId: string }) {
  if (!pluginId) throw new Error('stopPlugin: pluginId is required');
  global.send('SIMULATE', ['STOP_ALL', pluginId]);
  activeScripts.delete(pluginId);
}

export function startScript({
  name,
  quitOnExit = false,
}: {
  name: string;
  quitOnExit?: boolean | string;
}) {
  if (!name) throw new Error('startScript: name is required');
  global.send('SIMULATE', [
    'START_SCRIPT',
    { script: name, scriptOptions: { quitOnExit } },
  ]);
}

export function stopScript({ name }: { name: string }) {
  stopPlugin({ pluginId: name });
}

export async function getPluginInfo(
  pluginId: string,
): Promise<MacroInfo | null> {
  if (!pluginId) throw new Error('getPluginInfo: pluginId is required');
  return workerScript.sendAsync('GET_PLUGIN_INFO', { pluginId });
}

export async function getActiveScripts(): Promise<any> {
  return workerScript.sendAsync('GET_ACTIVE_SCRIPTS');
}

/* ---------- Cooldowns ---------- */

export type AddCooldownOptions = {
  name: string;
  /** Cooldown length in milliseconds before the cooldown becomes ready. */
  cooldown: number;
  /** Plugin-defined id (e.g. the gamemode). Unique within this plugin. */
  reminderId?: string;
  /** Start epoch (ms). Defaults to now. */
  time?: number;
  /**
   * Option overrides (field id → value) to replay when this cooldown
   * auto-runs the plugin — captures the context it was created for so it runs
   * the same way regardless of what's selected later, e.g.
   * `{ gamemode: 'skyblockdream' }`.
   */
  options?: Record<string, any>;
};

/** @deprecated Use {@link AddCooldownOptions} instead. */
export type AddReminderOptions = AddCooldownOptions;

/** Raw cooldown payload exchanged with the main process. */
export type CooldownData = {
  id: string;
  name: string;
  pluginId: string;
  reminderId?: string;
  cooldown: number; // milliseconds until ready
  time: number;
  options?: Record<string, any>;
};

/** @deprecated Use {@link CooldownData} instead. */
export type ReminderData = CooldownData;

/** Max cooldowns a script may create — mirrors the cap enforced in the main process. */
export const MAX_COOLDOWNS = 10;
/** @deprecated Use {@link MAX_COOLDOWNS} instead. */
export const MAX_REMINDERS = MAX_COOLDOWNS;

/**
 * A cooldown owned by your plugin. Returned by {@link getCooldowns} and
 * {@link addCooldown}. Use the methods to inspect or restart its countdown —
 * mutating the fields directly does nothing.
 */
export class Cooldown {
  readonly id: string;
  readonly pluginId: string;
  /** Plugin-defined id (e.g. the gamemode). Unique within your plugin. */
  reminderId?: string;
  name: string;
  /** Cooldown length in milliseconds. */
  cooldown: number;
  /** Start epoch (ms); the cooldown is ready at `time + cooldown`. */
  time: number;
  /** Option overrides replayed when this cooldown auto-runs the plugin. */
  options?: Record<string, any>;

  constructor(data: CooldownData) {
    this.id = data.id;
    this.pluginId = data.pluginId;
    this.reminderId = data.reminderId;
    this.name = data.name;
    this.cooldown = data.cooldown;
    this.time = data.time;
    this.options = data.options;
  }

  /** Epoch (ms) at which this cooldown becomes ready. */
  get readyAt(): number {
    return this.time + this.cooldown;
  }

  /** `true` once the cooldown has fully elapsed. */
  isCompleted(): boolean {
    return Date.now() >= this.readyAt;
  }

  /** Milliseconds left until the cooldown is ready (0 once completed). */
  remaining(): number {
    return Math.max(0, this.readyAt - Date.now());
  }

  /** Restart the countdown from now (i.e. ready again after one cooldown). */
  async reset(): Promise<this> {
    const res = await workerScript.sendAsync<{ ok: boolean; error?: string; reminders?: CooldownData[] }>('COOLDOWN_RESET', {
      id: this.id,
      pluginId: this.pluginId,
    });
    if (!res?.ok)
      throw new Error(res?.error || 'reset: failed to reset cooldown');
    this.time = res.reminders?.[0]?.time ?? Date.now();
    return this;
  }

  /** Permanently remove this cooldown. */
  async delete(): Promise<void> {
    const res = await workerScript.sendAsync<{ ok: boolean; error?: string }>('COOLDOWN_REMOVE', {
      id: this.id,
      pluginId: this.pluginId,
    });
    if (!res?.ok)
      throw new Error(res?.error || 'delete: failed to remove cooldown');
  }
}

/** @deprecated Use {@link Cooldown} instead. */
export class Reminder extends Cooldown {}

/** Returns this plugin's stored cooldowns for the active server. */
export async function getCooldowns(pluginId: string): Promise<Cooldown[]> {
  const data: CooldownData[] = await workerScript.sendAsync(
    'COOLDOWN_GET',
    pluginId,
  );
  return (data ?? []).map((c) => new Cooldown(c));
}

/** @deprecated Use {@link getCooldowns} instead. */
export async function getReminders(pluginId: string): Promise<Cooldown[]> {
  const list = await getCooldowns(pluginId);
  return list.map((c) => new Cooldown(c));
}

/**
 * Create (or update) a cooldown owned by this plugin. Passing a `reminderId`
 * that already exists for this plugin updates it instead of adding a duplicate.
 * Throws if the cooldown limit (10) is reached. Resolves with the cooldown.
 */
export async function addCooldown(
  opts: AddCooldownOptions,
  pluginId: string,
): Promise<Cooldown> {
  if (!opts || typeof opts !== 'object') {
    throw new Error('addCooldown: options object is required');
  }
  if (!opts.name || typeof opts.name !== 'string') {
    throw new Error('addCooldown: name is required');
  }
  if (opts.name.length > 60) {
    throw new Error('addCooldown: name too long (max 60)');
  }
  if (
    typeof opts.cooldown !== 'number' ||
    !Number.isFinite(opts.cooldown) ||
    opts.cooldown <= 0
  ) {
    throw new Error(
      'addCooldown: cooldown must be a positive number of milliseconds',
    );
  }
  if (
    opts.time !== undefined &&
    (typeof opts.time !== 'number' || !Number.isFinite(opts.time))
  ) {
    throw new Error('addCooldown: time must be an epoch in milliseconds');
  }
  if (!pluginId || typeof pluginId !== 'string') {
    throw new Error('addCooldown: plugin ID is not found');
  }

  const res = await workerScript.sendAsync<{ ok: boolean; error?: string; reminder?: CooldownData }>('COOLDOWN_ADD', {
    reminder: {
      name: opts.name,
      reminderId: opts.reminderId,
      cooldown: opts.cooldown,
      time: opts.time,
      options: opts.options,
    },
    pluginId: pluginId,
  });
  if (!res?.ok)
    throw new Error(res?.error || 'addCooldown: failed to add cooldown');
  return new Cooldown(res.reminder!);
}

/** @deprecated Use {@link addCooldown} instead. */
export async function addReminder(
  opts: AddReminderOptions,
  pluginId: string,
): Promise<Reminder> {
  const cooldown = await addCooldown(opts, pluginId);
  return new Reminder(cooldown);
}

/* ---------- Cross-script actions ---------- */

export async function runAction(
  action: string,
  bot?: Bot,
  ...args: any[]
): Promise<any> {
  if (!action) throw new Error('runAction: action name is required');
  return scriptActionRunner({ name: action, bot, args });
}

export async function startAction({
  actionId,
  bot,
  preset,
  optionOverrides,
  args,
}: {
  actionId: string;
  bot?: Bot;
  preset?: string;
  optionOverrides?: Record<string, unknown>;
  args: any[];
}): Promise<any> {
  if (!actionId) throw new Error('startAction: action ID is required');
  return scriptActionRunner({
    id: actionId,
    bot,
    args,
    optionOverrides: presetOverrides(actionId, preset, optionOverrides),
  });
}

/* ---------- Alts ---------- */

/**
 * Returns alts list with passwords replaced by their sha256 hash.
 */
export function getAlts() {
  return workerScript.getAlts({ fullAlts: false });
}

export async function requestAccountPassword(
  username: string,
): Promise<string | null> {
  if (typeof username !== 'string' || !username.trim()) {
    throw new Error('requestAccountPassword: username is required');
  }

  const requestedUsername = username.trim();
  const alt = workerScript
    .getAlts({ fullAlts: false })
    .find(
      (entry) =>
        entry.username.toLowerCase() === requestedUsername.toLowerCase(),
    );
  if (!alt) {
    throw new Error(
      `requestAccountPassword: account not found: ${requestedUsername}`,
    );
  }
  if (isOnlineMode(workerData.profile?.data)) return null;

  const accountKey = alt.username.toLowerCase();
  if (
    !passwordAccessForAllAccounts &&
    !passwordAccessAccounts.has(accountKey)
  ) {
    const response = await dialog({
      title: 'Allow password access?',
      body: `${workerData.script} wants to access the password for ${alt.username}. Passwords are sensitive; only allow access if you trust this script.`,
      buttons: [
        { label: 'Allow this account', type: 'primary' },
        { label: 'Allow all accounts', type: 'default' },
        { label: 'Deny', type: 'default' },
      ],
    });

    if (response === 'Allow all accounts')
      passwordAccessForAllAccounts = true;
    else if (response === 'Allow this account')
      passwordAccessAccounts.add(accountKey);
    else
      throw new Error(
        `requestAccountPassword: password access declined for account: ${alt.username}`,
      );
  }

  return workerScript.sendAsync('REQUEST_ACCOUNT_PASSWORD', {
    username: alt.username,
  });
}

/**
 * Iterate over your alts the easy way. Pass your alts (from `getAlts()`) and
 * the script's options; the iterator filters the alts (tags, ranks, gkits,
 * altRange, ignored alts, ...), wires up the pause/skip/previous buttons,
 * joins + logs in each alt, yields the live bot and ends it afterwards.
 *
 *   for await (const bot of script.forEachBot(script.getAlts(), script.settings)) {
 *     // drive `bot` here — it's already joined and logged in
 *   }
 */
export function forEachBot(
  alts: AltWithData[],
  scriptOptions: Record<string, any> = {},
  options: IterateAltsOptions = {},
) {
  return iterateBots(alts, scriptOptions, options);
}

/**
 * Like {@link forEachBot}, but does NOT join the server: it filters your alts
 * and wires up the pause/skip/previous buttons the same way, yet yields the
 * plain alt object instead of a joined bot. Use it when you only need each
 * alt's data and don't want to log in.
 *
 *   for await (const alt of script.forEachAlt(script.getAlts(), script.settings)) {
 *     // inspect `alt` — no bot has been joined
 *   }
 */
export function forEachAlt(
  alts: AltWithData[],
  scriptOptions: Record<string, any> = {},
  options: Omit<IterateAltsOptions, 'filter' | 'join'> = {},
) {
  return iterateAlts(alts, scriptOptions, options);
}
// export type AltRequestUpdate = {
//   password?: string;
//   ranks?: Record<string, string | null>;
//   gkits?: Record<string, string[]>;
// };

// export type AltRequestType = Record<string, AltRequestUpdate | null>;

export function requestAltUpdate(
  updates: AltUpdateRequest,
  scriptInfo?: MacroInfo,
) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error(
      'requestAltUpdate(updates): updates must be an object keyed by username',
    );
  }

  const cleaned: AltUpdateRequest = {};
  for (const [username, raw] of Object.entries(updates)) {
    if (!username || typeof username !== 'string') continue;
    if (raw === null) {
      cleaned[username] = null;
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const entry: AltUpdateData = {};
    if ('password' in raw) entry.password = raw.password;
    if (raw.ranks && typeof raw.ranks === 'object') entry.ranks = raw.ranks;
    if (raw.gkits && typeof raw.gkits === 'object') entry.gkits = raw.gkits;
    if (Object.keys(entry).length > 0) cleaned[username] = entry;
  }
  if (Object.keys(cleaned).length === 0)
    return console.warn('requestAltUpdate: no valid updates found');

  global.sendToClients('altUpdateRequest', {
    id: `${scriptInfo?.pluginId ?? 'plugin'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scriptName: scriptInfo?.name ?? 'Unknown script',
    scriptId: scriptInfo?.pluginId,
    updates: cleaned,
  });
}

/* ---------- Discord (kept for backward compatibility with older user scripts) ---------- */

export async function sendDiscordMessage({
  message,
  webhook_url,
}: {
  message: string;
  webhook_url: string;
}) {
  if (!webhook_url || webhook_url.length < 115)
    throw new Error('sendDiscordMessage: invalid webhook_url');
  if (!message?.length)
    throw new Error('sendDiscordMessage: message is required');
  try {
    await axios({
      method: 'POST',
      url: webhook_url,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ content: message }),
    });
  } catch {
    /* ignore network errors */
  }
}

export const appVersion: AppVersion = {
  current: workerScript.workerData?.appVersion,

  isLaterThan(otherVersion: string): boolean {
    if (!this.current) return false;
    const parseVersion = (v: string) => v.split('.').map(Number);
    // Access the current version safely using 'this.current'
    const [major, minor, patch] = parseVersion(this.current);
    const [otherMajor, otherMinor, otherPatch] = parseVersion(otherVersion);

    if (major !== otherMajor) return major > otherMajor;
    if (minor !== otherMinor) return minor > otherMinor;
    return patch > otherPatch;
  },
};
