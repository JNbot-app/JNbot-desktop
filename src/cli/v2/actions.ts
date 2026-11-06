import { reminderDueAt, repeatInterval } from '../../common/cooldowns';
import fs from 'fs';
import { ServerTypes } from '../../main/src/functions/peer2peer/DeviceHandler';
import { USER_SCRIPT_NAMES } from '../../main/src/workers/scriptList';
import { isSensitivePluginOption } from '../../common/pluginOptions';
import { DEFAULT_REMOTE_PERMISSIONS } from '../../common/clientPermissions';
import { getServerMeta } from '../../common/serverInfo';
import type { ProfileScript } from '../../common/profileScripts';
import { chainPluginId } from '../../common/chains';
import type { MacroInfo } from '../../main/src/types';
import { generateTerminalQr } from './qr';
import type {
  CliAction,
  CliResult,
  CliRuntime,
  CooldownInfo,
  BotDetails,
  BotChatMessage,
  BotInventorySlot,
  RunItem,
  RunnableScript,
} from './types';
import { cliSnapshot } from './snapshot';
import { accountAuthenticationError, isOnlineMode } from '../../common/serverAuthentication';

type RemoteDevice = {
  id: string;
  token: string;
  name: string;
  permissions: { profiles: string[] | '*' };
};

export const availableScripts = USER_SCRIPT_NAMES as string[];

export function ok<T>(data: T): CliResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: unknown, code: 1 | 2 = 1): CliResult<T> {
  return { ok: false, error: error instanceof Error ? error.message : String(error), code };
}

export function action<T>(
  id: string,
  description: string,
  run: (runtime: CliRuntime) => Promise<CliResult<T>>,
): CliAction<T> {
  return { id, description, execute: run };
}

export const actions = {
  snapshot: action('snapshot', 'Show the current CLI runtime', async (runtime) => ok(cliSnapshot(runtime))),
  profiles: action('profile.list', 'List installed profiles', async ({ handler }) =>
    ok(handler.settings.getAvailableProfiles().map((profile) => ({
      id: profile.server,
      name: profile.data.name ?? profile.data.shortName ?? profile.server,
      active: profile.server === handler.getBootstrapRuntime().profileKey,
    })))),
  scripts: action('script.list', 'List profile scripts', async (runtime) => {
    const profileScripts = await getProfileScriptItems(runtime);
    return ok(profileScripts.map((s) => ({ name: s.name, type: 'profile', id: s.id })));
  }),
  plugins: action('plugin.list', 'List installed plugins', async (runtime) => {
    const macroPlugins = getLibraryPluginItems(runtime).map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      type: plugin.detail,
      source: 'library',
      author: plugin.author,
    }));
    return ok(macroPlugins);
  }),
};

export interface MarketplaceProfileRow {
  /** Share id. */
  id: string;
  name: string;
  publisher: string;
  official: boolean;
  summary: string;
  installed: boolean;
}

/** Profile shares on the marketplace (official servers first). */
export async function marketplaceProfileRows(runtime: CliRuntime): Promise<MarketplaceProfileRow[]> {
  const entries = await runtime.handler.clientEvents.shares.marketplace();
  const installed = new Set(runtime.handler.settings.profiles.list.map((profile) => profile.share?.id));
  return entries
    .filter((entry) => entry.kind === 'profile')
    .map((entry) => ({
      id: entry.id,
      name: entry.listing.title,
      publisher: entry.publisher.name,
      official: entry.publisher.official,
      summary:
        entry.listing.details.flatMap((section) => section.rows).find((row) => row.label === 'Gamemodes')?.value ??
        entry.listing.description,
      installed: installed.has(entry.id),
    }))
    .sort((a, b) => Number(b.official) - Number(a.official));
}

export async function listMarketplaceProfiles(runtime: CliRuntime): Promise<CliResult> {
  try {
    return ok(await marketplaceProfileRows(runtime));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 1);
  }
}

export async function installMarketplaceProfile(runtime: CliRuntime, shareId: string): Promise<CliResult> {
  let profileKey: string;
  try {
    ({ localRef: profileKey } = await runtime.handler.clientEvents.shares.install({ id: shareId, decisions: [] }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 2);
  }
  if (!runtime.handler.selectBootstrapProfile(profileKey)) {
    return fail(`Installed "${profileKey}" but could not activate it.`, 1);
  }
  const meta = getServerMeta(runtime.handler.settings.JNdata, profileKey);
  return ok({ id: profileKey, name: meta.name ?? profileKey });
}

export async function importCloudData(
  runtime: CliRuntime,
  userId: string,
  shareKey: string,
): Promise<CliResult> {
  const uid = userId.trim();
  const key = shareKey.trim();
  if (!uid || !key) {
    return fail('User ID and share key are required.', 2);
  }
  try {
    await runtime.handler.getCloudStorage().importSharedFromUser({
      userId: uid,
      shareKey: key,
    });
    const available = runtime.handler.settings.getAvailableProfiles();
    if (available.length > 0) {
      const current = runtime.handler.getBootstrapRuntime().profileKey;
      const target = available.some((p) => p.server === current) ? current : available[0].server;
      runtime.handler.selectBootstrapProfile(target);
    }
    return ok({ userId: uid, profilesCount: available.length });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 1);
  }
}

export async function useProfile(runtime: CliRuntime, profileId: string): Promise<CliResult> {
  return runtime.handler.selectBootstrapProfile(profileId)
    ? ok({ profile: profileId })
    : fail(`Profile "${profileId}" is not installed.`, 2);
}

export async function settingGet(runtime: CliRuntime, settingPath?: string): Promise<CliResult> {
  let value: unknown = runtime.handler.settings.getProfileSettings(
    runtime.handler.getBootstrapRuntime().profileKey,
  );
  if (settingPath) {
    for (const part of settingPath.split('.')) {
      if (!value || typeof value !== 'object' || !(part in value))
        return fail(`Setting path "${settingPath}" does not exist.`, 2);
      value = (value as Record<string, unknown>)[part];
    }
  }
  return ok(value);
}

export async function settingSet(
  runtime: CliRuntime,
  settingPath: string,
  rawValue: string,
): Promise<CliResult> {
  const parts = settingPath.split('.');
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const settings = runtime.handler.settings.getProfileSettings(profileKey);
  let parent = settings as Record<string, any>;
  for (const part of parts.slice(0, -1)) {
    const child = parent[part];
    if (!child || typeof child !== 'object' || Array.isArray(child))
      return fail(`Setting path "${settingPath}" does not exist.`, 2);
    parent = child
  }
  const key = parts.at(-1)!;
  if (!(key in parent)) return fail(`Setting path "${settingPath}" does not exist.`, 2);
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    value = rawValue;
  }
  runtime.handler.settings.updateProfileSettings(profileKey, { path: parts, value });
  return ok({ path: settingPath, value });
}

export async function importProfile(
  runtime: CliRuntime,
  file: string,
  allowUnverified: boolean,
): Promise<CliResult> {
  if (!fs.existsSync(file)) return fail(`File not found: ${file}`, 2);
  const profile = await runtime.handler.settings.profiles.importFromPath(file, {
    allowUnverified,
    promptForUnverified: false,
  });
  if (!profile) return fail('Import was cancelled because the profile contains unverified scripts.', 2);
  runtime.handler.settings.profiles.upsert(profile);
  runtime.handler.selectBootstrapProfile(profile.id);
  return ok({ id: profile.id, name: profile.data.name ?? profile.id });
}

export async function exportProfile(runtime: CliRuntime, profileId: string, file: string): Promise<CliResult> {
  await runtime.handler.settings.profiles.exportToPath(profileId, file);
  return ok({ file });
}

export async function importPlugins(
  runtime: CliRuntime,
  files: string[],
  options: { overwrite?: boolean; keepBoth?: boolean; trustUnverified?: boolean },
): Promise<CliResult> {
  if (options.overwrite && options.keepBoth)
    return fail('Use either --overwrite or --keep-both, not both.', 2);
  const collision = options.overwrite ? 'overwrite' : options.keepBoth ? 'keep-both' : 'cancel';
  const results = await Promise.all(files.map(async (file) => ({
    file,
    ...(await runtime.handler.macros.importFileWithOptions(file, {
      collision,
      trust: options.trustUnverified ? 'allow-unverified' : 'verified-only',
    })),
  })));
  return results.every((result) => result.status === 'success')
    ? ok(results)
    : { ok: false, data: results, error: 'One or more plugins were not imported.', code: 1 };
}

export async function getProfileScriptItems(
  runtime: CliRuntime,
): Promise<Array<RunItem>> {
  const bootstrap = runtime.handler.getBootstrapRuntime();
  const rawScripts = (
    (runtime.handler.settings.JNdata?.data?.[bootstrap.profileKey]?.scripts ?? []) as ProfileScript[]
  ).filter((s) => !s.hidden);
  const resolver = runtime.handler.settings.profiles?.scripts;

  const items = await Promise.all(
    rawScripts.map(async (s) => {
      let name = s.pluginId;
      let detail = 'Profile script';
      let config: any = undefined;
      let author: string | undefined;
      if (resolver) {
        try {
          const res = await (resolver.resolveInfo ? resolver.resolveInfo(s) : resolver.resolve(s));
          if (res?.info?.name) {
            name = res.info.name;
            detail = res.info.scriptType ?? 'Profile script';
            config = res.info.config;
            author = res.info.security?.publisherName;
          }
        } catch {
          // fallback to pluginId
        }
      }
      return {
        id: s.pluginId,
        name,
        type: 'script' as const,
        detail,
        author,
        config,
      };
    }),
  );
  return items;
}

export function getInitialProfileScriptItems(
  runtime: CliRuntime,
): Array<RunItem> {
  const bootstrap = runtime.handler.getBootstrapRuntime();
  const rawScripts = (
    (runtime.handler.settings.JNdata?.data?.[bootstrap.profileKey]?.scripts ?? []) as ProfileScript[]
  ).filter((s) => !s.hidden);
  const resolver = runtime.handler.settings.profiles?.scripts;

  return rawScripts.map((s) => {
    let name = s.pluginId;
    let detail = 'Profile script';
    if (resolver && s.source?.kind === 'url') {
      const cached = (resolver as any).readUrlInfoCache?.(s.source.url);
      if (cached?.name) {
        name = cached.name;
        detail = cached.scriptType ?? 'Profile script';
      }
    }
    return {
      id: s.pluginId,
      name,
      type: 'script' as const,
      detail,
    };
  });
}

export function getLibraryPluginItems(
  runtime: CliRuntime,
): Array<RunItem> {
  return runtime.handler.macros
    .toList()
    .sort((a, b) => (a.editedAt ?? 0) - (b.editedAt ?? 0))
    .map((plugin) => ({
      id: plugin.pluginId,
      name: plugin.name,
      type: 'plugin' as const,
      detail: plugin.scriptType,
      author: plugin.security?.publisherName || undefined,
      config: plugin.config,
    }));
}

/** Everything a `scriptSelect` option can offer, matching the app's picker. */
export async function getRunnableScripts(runtime: CliRuntime): Promise<RunnableScript[]> {
  const { handler } = runtime;
  const { profileId, profileKey } = handler.getBootstrapRuntime();
  const entries = handler.settings.JNdata.data[profileKey]?.scripts ?? [];
  const resolved = await Promise.all(entries.map(async (entry): Promise<RunnableScript | undefined> => {
    const result = await handler.settings.profiles.scripts?.resolveInfo(entry);
    return result?.info && { info: result.info, profileScriptId: entry.id };
  }));
  const byId = new Map<string, RunnableScript>();
  for (const script of [...resolved, ...handler.macros.toList().map((info) => ({ info }))]) {
    if (!script || byId.has(script.info.pluginId)) continue;
    if (script.info.scriptType !== 'script' && script.info.scriptType !== 'action') continue;
    if (!handler.isPluginDisallowed(profileId, script.info.pluginId)) byId.set(script.info.pluginId, script);
  }
  const { scripts } = handler.settings.getProfileSettings(profileKey);
  const chains = Object.values(scripts?.chains ?? {}).map((chain: any): RunnableScript => ({
    info: {
      pluginId: chainPluginId(chain.id),
      name: scripts[chain.id]?.name ?? chain.name ?? 'Chain',
      scriptType: 'script',
    } as MacroInfo,
  }));
  return [...byId.values(), ...chains];
}

export async function runPlugin(runtime: CliRuntime, idOrName: string): Promise<CliResult> {
  const plugin = await resolvePlugin(runtime, idOrName);
  if (!plugin.ok || !plugin.data) return plugin;
  await runtime.handler.runByPluginId(runtime.handler.getBootstrapRuntime().profileId, plugin.data.pluginId);
  return ok({ plugin: plugin.data.name });
}

export async function resolvePlugin(
  runtime: CliRuntime,
  idOrName: string,
): Promise<CliResult<{ pluginId: string; name: string; config?: any }>> {
  const macroMatches = runtime.handler.macros
    .toList()
    .filter((plugin) => plugin.pluginId === idOrName || plugin.name === idOrName);
  if (macroMatches.length === 1) return ok(macroMatches[0]);
  if (macroMatches.length > 1) return fail('Plugin name is ambiguous; use its id.', 2);

  const bootstrap = runtime.handler.getBootstrapRuntime();
  const rawScripts = (
    (runtime.handler.settings.JNdata?.data?.[bootstrap.profileKey]?.scripts ?? []) as ProfileScript[]
  ).filter((s) => !s.hidden);
  const resolver = runtime.handler.settings.profiles?.scripts;

  const matchedScript = rawScripts.find((s) => s.pluginId === idOrName || s.id === idOrName);
  if (matchedScript) {
    let name = matchedScript.pluginId;
    let config: any = undefined;
    if (resolver) {
      try {
        const res = await (resolver.resolveInfo ? resolver.resolveInfo(matchedScript) : resolver.resolve(matchedScript));
        if (res?.info) {
          name = res.info.name ?? name;
          config = res.info.config;
        }
      } catch {
        // use fallback
      }
    }
    return ok({ pluginId: matchedScript.pluginId, name, config });
  }

  // Also check if any profile script matches by resolved name
  if (resolver) {
    for (const script of rawScripts) {
      try {
        const res = await (resolver.resolveInfo ? resolver.resolveInfo(script) : resolver.resolve(script));
        if (res?.info?.name === idOrName) {
          return ok({ pluginId: script.pluginId, name: res.info.name, config: res.info.config });
        }
      } catch {
        // continue
      }
    }
  }

  return fail('Plugin not found.', 2);
}

export async function pluginOptions(runtime: CliRuntime, idOrName: string): Promise<CliResult> {
  const plugin = await resolvePlugin(runtime, idOrName);
  if (!plugin.ok || !plugin.data) return plugin;
  const values = runtime.handler.settings.getProfileSettings(runtime.handler.getBootstrapRuntime().profileKey)
    .scripts?.[plugin.data.pluginId] ?? {};
  return ok({
    id: plugin.data.pluginId,
    name: plugin.data.name,
    options: (plugin.data.config ?? []).flatMap((section: any) => section.options.map((option: any) => ({
      id: option.id,
      label: option.label,
      type: option.type,
      value: isSensitivePluginOption(option) ? '[hidden]' : values[option.id] ?? option.defaultValue,
    }))),
  });
}

export async function setPluginOption(
  runtime: CliRuntime,
  idOrName: string,
  optionId: string,
  rawValue: string,
): Promise<CliResult> {
  const plugin = await resolvePlugin(runtime, idOrName);
  if (!plugin.ok || !plugin.data) return plugin;
  const option = plugin.data.config?.flatMap((section: any) => section.options)
    ?.find((item: any) => item.id === optionId);
  let value: unknown;
  try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  runtime.handler.settings.updateProfileSettings(runtime.handler.getBootstrapRuntime().profileKey, {
    path: ['scripts', plugin.data.pluginId, optionId], value,
  });
  return ok({ plugin: plugin.data.name, option: optionId, value: option && isSensitivePluginOption(option) ? '[updated]' : value });
}

export async function getScriptOptionSchema(
  runtime: CliRuntime,
  idOrName: string,
): Promise<CliResult<{ id: string; name: string; sections: any[]; values: Record<string, any> }>> {
  const plugin = await resolvePlugin(runtime, idOrName);
  if (!plugin.ok || !plugin.data) return plugin as any;
  const values = runtime.handler.settings.getProfileSettings(runtime.handler.getBootstrapRuntime().profileKey)
    ?.scripts?.[plugin.data.pluginId] ?? {};
  return ok({
    id: plugin.data.pluginId,
    name: plugin.data.name,
    sections: plugin.data.config ?? [],
    values: { ...values },
  });
}

export async function saveScriptOptions(
  runtime: CliRuntime,
  idOrName: string,
  updatedValues: Record<string, any>,
): Promise<CliResult<{ id: string; name: string }>> {
  const plugin = await resolvePlugin(runtime, idOrName);
  if (!plugin.ok || !plugin.data) return plugin as any;
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const existing = runtime.handler.settings.getProfileSettings(profileKey)?.scripts?.[plugin.data.pluginId] ?? {};
  const next = { ...existing, ...updatedValues };
  runtime.handler.settings.updateProfileSettings(profileKey, {
    path: ['scripts', plugin.data.pluginId],
    value: next,
  });
  return ok({ id: plugin.data.pluginId, name: plugin.data.name });
}

export function listAlts(runtime: CliRuntime): CliResult {
  return ok(runtime.handler.settings.getAltsWithDataForProfile(runtime.handler.getBootstrapRuntime().profileKey)
    .map((alt) => ({
      username: alt.username,
      premium: Boolean(alt.data?.premium),
      hasPassword: Boolean(alt.data?.password),
    })));
}

export function addAlt(
  runtime: CliRuntime,
  username: string,
  options: { premium?: boolean; email?: string; password?: string },
): CliResult {
  const name = username.trim();
  if (!name) return fail('Enter a username.', 2);
  const profile = runtime.handler.getBootstrapRuntime().profileKey;
  const authenticationError = accountAuthenticationError(options, isOnlineMode(runtime.handler.settings.JNdata.data?.[profile]));
  if (authenticationError) return fail(authenticationError, 2);
  const alts = runtime.handler.settings.getAltsWithDataForProfile(profile);
  if (alts.some((alt) => alt.username.toLowerCase() === name.toLowerCase()))
    return fail(`Alt "${name}" already exists in this profile.`, 2);
  alts.push({
    username: name,
    data: {
      premium: options.premium === true,
      password: options.password?.trim() || undefined,
      ranks: {},
      gkits: {},
    },
  });
  runtime.handler.settings.setAltsForProfile(profile, alts);
  return ok({ username: name });
}

export function deleteAlt(runtime: CliRuntime, username: string): CliResult {
  const profile = runtime.handler.getBootstrapRuntime().profileKey;
  const alts = runtime.handler.settings.getAltsWithDataForProfile(profile);
  const next = alts.filter((alt) => alt.username.toLowerCase() !== username.toLowerCase());
  if (next.length === alts.length) return fail(`Alt "${username}" was not found.`, 2);
  runtime.handler.settings.setAltsForProfile(profile, next);
  return ok({ username, deleted: true });
}

export function formatRemainingTime(ms: number): string {
  if (ms <= 0) return 'Ready';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${sec % 60}s`;
  return `${sec}s`;
}

export function listCooldowns(runtime: CliRuntime): CliResult<CooldownInfo[]> {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const settings = runtime.handler.settings.getProfileSettings(profileKey);
  const reminders = settings?.reminders ?? [];
  const now = Date.now();
  const list: CooldownInfo[] = reminders.map((c) => {
    const remainingMs = Math.max(0, reminderDueAt(c) - now);
    return {
      id: c.id,
      pluginId: c.pluginId,
      name: c.name || c.pluginId,
      ...(c.kind === 'schedule' ? { kind: c.kind, repeat: c.repeat } : {}),
      cooldown: c.kind === 'schedule' ? repeatInterval(c.repeat) : c.cooldown,
      time: c.kind === 'schedule' ? c.nextRunAt - repeatInterval(c.repeat) : c.time,
      autoStart: Boolean(c.autoStart),
      remainingMs,
      remainingFormatted: formatRemainingTime(remainingMs),
      ready: remainingMs === 0,
    };
  }).sort((a, b) => a.remainingMs - b.remainingMs);
  return ok(list);
}

export function setScriptCooldown(
  runtime: CliRuntime,
  pluginId: string,
  cooldownMs: number,
  autoStart = true,
  options?: any,
): CliResult<{ id: string; pluginId: string; cooldown: number; autoStart: boolean }> {
  if (!cooldownMs || cooldownMs < 1000) {
    return fail('Interval must be at least 1 second (1000ms).', 2);
  }
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const settings = runtime.handler.settings.getProfileSettings(profileKey);
  const reminders = [...(settings?.reminders ?? [])];
  const now = Date.now();
  const existingIndex = reminders.findIndex((r: any) => r.pluginId === pluginId);
  const id = existingIndex >= 0 ? reminders[existingIndex].id : `cd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const item = {
    id,
    pluginId,
    name: pluginId,
    cooldown: cooldownMs,
    time: now,
    autoStart,
    options: options ?? (existingIndex >= 0 ? reminders[existingIndex].options : undefined),
  };
  if (existingIndex >= 0) {
    reminders[existingIndex] = item;
  } else {
    reminders.push(item);
  }
  runtime.handler.settings.updateProfileSettings(profileKey, {
    path: ['reminders'],
    value: reminders,
  });
  return ok({ id, pluginId, cooldown: cooldownMs, autoStart });
}

export function removeCooldown(runtime: CliRuntime, idOrPluginId: string): CliResult<{ removed: boolean }> {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const settings = runtime.handler.settings.getProfileSettings(profileKey);
  const reminders = (settings?.reminders ?? []).filter(
    (r: any) => r.id !== idOrPluginId && r.pluginId !== idOrPluginId,
  );
  runtime.handler.settings.updateProfileSettings(profileKey, {
    path: ['reminders'],
    value: reminders,
  });
  return ok({ removed: true });
}

export function toggleCooldownAutoStart(runtime: CliRuntime, idOrPluginId: string): CliResult<{ autoStart: boolean }> {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const settings = runtime.handler.settings.getProfileSettings(profileKey);
  const reminders = [...(settings?.reminders ?? [])];
  const item = reminders.find((r: any) => r.id === idOrPluginId || r.pluginId === idOrPluginId);
  if (!item) return fail(`Cooldown "${idOrPluginId}" not found.`, 2);
  item.autoStart = !item.autoStart;
  runtime.handler.settings.updateProfileSettings(profileKey, {
    path: ['reminders'],
    value: reminders,
  });
  return ok({ autoStart: Boolean(item.autoStart) });
}

export function resetCooldown(runtime: CliRuntime, idOrPluginId: string): CliResult<{ reset: boolean }> {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const settings = runtime.handler.settings.getProfileSettings(profileKey);
  const reminders = [...(settings?.reminders ?? [])];
  const item = reminders.find((r: any) => r.id === idOrPluginId || r.pluginId === idOrPluginId);
  if (!item) return fail(`Cooldown "${idOrPluginId}" not found.`, 2);
  if (item.kind === 'schedule') return fail('Edit scheduled dates in the schedule editor.', 2);
  item.time = Date.now();
  runtime.handler.settings.updateProfileSettings(profileKey, {
    path: ['reminders'],
    value: reminders,
  });
  return ok({ reset: true });
}

function findActiveBot(runtime: CliRuntime, botIdOrIndex: number | string) {
  const activeBots = Object.values(runtime.handler.getBootstrapRuntime().activeBots.bots);
  if (typeof botIdOrIndex === 'number') {
    const byId = activeBots.find((b) => b.botInfo.botId === botIdOrIndex);
    if (byId) return byId;
    return activeBots[botIdOrIndex];
  }
  const numeric = Number(botIdOrIndex);
  if (!isNaN(numeric)) {
    const byId = activeBots.find((b) => b.botInfo.botId === numeric);
    if (byId) return byId;
    if (numeric >= 0 && numeric < activeBots.length) return activeBots[numeric];
  }
  return activeBots.find((b) => b.botInfo.username.toLowerCase() === String(botIdOrIndex).toLowerCase());
}

export async function getBotState(runtime: CliRuntime, botIdOrIndex: number | string): Promise<CliResult<BotDetails>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  let extra: any = {};
  try {
    extra = (await bot.requestAction('mcpGetState')) ?? {};
  } catch {
    // fallback
  }
  return ok({
    botId: bot.botInfo.botId,
    username: bot.botInfo.username,
    server: bot.botInfo.host,
    script: bot.script.name,
    status: bot.botInfo.status ?? 'connected',
    health: extra.health ?? (bot.botInfo as any).health ?? null,
    food: extra.food ?? (bot.botInfo as any).food ?? null,
    gamemode: extra.gamemode ?? (bot.botInfo as any).gamemode ?? null,
    ping: (bot.botInfo as any).ping ?? 0,
    position: extra.position ?? null,
    heldItem: extra.heldItem ? (extra.heldItem.displayName ?? extra.heldItem.name) : null,
  });
}

export async function getBotChat(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
  limit = 50,
): Promise<CliResult<BotChatMessage[]>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  try {
    const chatData = await bot.requestAction('mcpGetChat', { limit });
    if (chatData?.entries && Array.isArray(chatData.entries) && chatData.entries.length > 0) {
      const messages: BotChatMessage[] = chatData.entries
        .map((entry: any) => ({
          text: entry.message ?? entry.rawText ?? entry.text ?? (typeof entry === 'string' ? entry : ''),
          timestamp: entry.timestamp ?? Date.now(),
          sender: entry.sender,
        }))
        .filter((m: BotChatMessage) => Boolean(m.text));
      if (messages.length > 0) return ok(messages);
    }
  } catch {
    // fallback
  }

  try {
    const packet = await bot.requestAction('chatPacket');
    if (packet?.messages && Array.isArray(packet.messages)) {
      const messages: BotChatMessage[] = packet.messages
        .map((m: any) => ({
          text: typeof m === 'string' ? m : m.message ?? m.text ?? '',
          timestamp: Date.now(),
        }))
        .filter((m: BotChatMessage) => Boolean(m.text));
      return ok(messages);
    }
  } catch {
    // fallback
  }

  return ok([]);
}

export async function sendBotChat(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
  message: string,
): Promise<CliResult<{ sent: boolean }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  const trimmed = message.trim();
  if (!trimmed) return fail('Message cannot be empty.', 2);
  bot.chat(trimmed);
  return ok({ sent: true });
}

export async function getBotInventory(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
): Promise<CliResult<{ title: string; isInventory: boolean; items: BotInventorySlot[] }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  try {
    let packet = await bot.requestAction('mcpGetInventory');
    if (!packet || !Array.isArray(packet.items)) {
      packet = await bot.requestAction('sendInventoryPacket');
    }
    if (packet && Array.isArray(packet.items)) {
      const items: BotInventorySlot[] = packet.items
        .map((item: any, slot: number) => {
          if (!item) return null;
          return {
            slot: item.slot ?? slot,
            name: item.name ?? 'unknown',
            displayName: item.display?.name ?? item.displayName ?? item.name,
            count: item.count ?? 1,
            lore: item.display?.lore,
          };
        })
        .filter((item: any): item is BotInventorySlot => Boolean(item));
      return ok({
        title: packet.title ?? 'Inventory',
        isInventory: Boolean(packet.isInventory),
        items,
      });
    }
  } catch (err: any) {
    return fail(err?.message ?? 'Failed to get inventory', 1);
  }
  return ok({ title: 'Inventory', isInventory: true, items: [] });
}

export async function clickBotInventory(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
  slot: number,
  button = 0,
  mode = 0,
): Promise<CliResult<{ clicked: boolean }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  bot.clickWindow(slot, button, mode);
  return ok({ clicked: true });
}

export async function botJoinGamemode(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
  gamemode: string,
): Promise<CliResult<{ joined: boolean }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  try {
    await bot.requestAction('joinGamemode', gamemode);
    return ok({ joined: true });
  } catch (err: any) {
    return fail(err?.message ?? `Failed to join ${gamemode}`, 1);
  }
}

export async function botToggleMovement(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
  movement: 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'sneak' | 'fly',
): Promise<CliResult<{ movement: string }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  try {
    await bot.requestAction('toggleMovement', movement);
    return ok({ movement });
  } catch (err: any) {
    return fail(err?.message ?? 'Failed to toggle movement', 1);
  }
}

export async function botTossItem(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
  count = 1,
): Promise<CliResult<{ tossed: boolean }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  try {
    await bot.requestAction('tossItems', count);
    return ok({ tossed: true });
  } catch (err: any) {
    return fail(err?.message ?? 'Failed to drop item', 1);
  }
}

export async function botCloseWindow(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
): Promise<CliResult<{ closed: boolean }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  bot.closeWindow();
  return ok({ closed: true });
}

export async function runBotControl(
  runtime: CliRuntime,
  botIdOrIndex: number | string,
  action: 'disconnect' | 'login' | 'respawn' | 'activateItem',
): Promise<CliResult<{ action: string }>> {
  const bot = findActiveBot(runtime, botIdOrIndex);
  if (!bot) return fail('Bot not found.', 2);
  if (action === 'disconnect') bot.disconnect();
  else if (action === 'login') bot.login();
  else if (action === 'respawn') bot.respawn();
  else if (action === 'activateItem') bot.activateItem();
  return ok({ action });
}

export function updateCooldownDuration(
  runtime: CliRuntime,
  idOrPluginId: string,
  newCooldownMs: number,
): CliResult<{ updated: boolean; cooldown: number }> {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const settings = runtime.handler.settings.getProfileSettings(profileKey);
  const reminders = [...(settings?.reminders ?? [])];
  const item = reminders.find((r: any) => r.id === idOrPluginId || r.pluginId === idOrPluginId);
  if (!item) return fail(`Cooldown "${idOrPluginId}" not found.`, 2);
  if (item.kind === 'schedule') return fail('Edit scheduled intervals in the schedule editor.', 2);
  item.cooldown = newCooldownMs;
  item.time = Date.now();
  runtime.handler.settings.updateProfileSettings(profileKey, {
    path: ['reminders'],
    value: reminders,
  });
  return ok({ updated: true, cooldown: newCooldownMs });
}

export async function startDiscordBot(runtime: CliRuntime): Promise<CliResult> {
  return runScript(runtime, 'discordBot');
}

export async function startProxy(runtime: CliRuntime): Promise<CliResult> {
  return runScript(runtime, 'jnbotproxy');
}

export async function runScript(runtime: CliRuntime, script: string, rawOptions?: string): Promise<CliResult> {
  let arguments_: unknown;
  if (rawOptions) {
    try {
      arguments_ = JSON.parse(rawOptions);
    } catch {
      return fail('--options must be valid JSON.', 2);
    }
  }

  if (availableScripts.includes(script)) {
    await runtime.handler.clientEvents.profileAction(
      runtime.handler.getBootstrapRuntime().profileId,
      'START_SCRIPT',
      { script, arguments: arguments_, scriptOptions: {} },
    );
    return ok({ script });
  }

  // Profile script / plugin
  const plugin = await resolvePlugin(runtime, script);
  if (plugin.ok && plugin.data) {
    await runtime.handler.runByPluginId(runtime.handler.getBootstrapRuntime().profileId, plugin.data.pluginId);
    return ok({ script: plugin.data.name });
  }

  return fail(`Unknown script or plugin: ${script}`, 2);
}

export async function joinBot(runtime: CliRuntime, username: string, version?: string): Promise<CliResult> {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const customSettings = JSON.parse(JSON.stringify({
    ...runtime.handler.settings.getProfileSettings(profileKey),
    alts: runtime.handler.settings.getAltsWithDataForProfile(profileKey),
    devices: runtime.handler.settings.shared.devices,
    launcherOptions: runtime.handler.settings.shared.launcherOptions,
  }));
  customSettings.scripts ??= {};
  customSettings.scripts.chat ??= {};
  customSettings.scripts.chat.username = username;
  if (version) customSettings.scripts.chat.version = version;
  const selectedVersion = version ?? customSettings.scripts.chat.version ?? '1.8.9';
  await runtime.handler.clientEvents.profileAction(
    runtime.handler.getBootstrapRuntime().profileId,
    'START_SCRIPT',
    {
      script: 'chat',
      arguments: { username, version: selectedVersion },
      scriptOptions: { customSettings },
    },
  );
  return ok({ username, version: selectedVersion });
}

export async function startRemote(runtime: CliRuntime, deviceId?: string): Promise<CliResult> {
  const result = await runtime.handler.deviceHandler.start(ServerTypes.PEER2PEER);
  if (!result) return fail('Failed to start remote server.', 2);
  const server = result.server;
  const device = deviceId
    ? runtime.handler.deviceHandler.getDevice(deviceId)
    : result.device;
  if (!device) return fail(`Device "${deviceId}" was not found.`, 2);
  const link = remoteAccessUrl(runtime, device.id);
  return ok({
    active: Boolean(server.status),
    device: device.name,
    room: server.room,
    url: link.ok ? link.data!.url : undefined,
    mobileUrl: link.ok ? link.data!.mobileUrl : undefined,
    qr: link.ok ? link.data!.mobileQr : undefined,
    mobileQr: link.ok ? link.data!.mobileQr : undefined,
    webQr: link.ok ? link.data!.webQr : undefined,
  });
}

export async function remoteDevices(runtime: CliRuntime): Promise<CliResult> {
  return ok(Object.values(runtime.handler.deviceHandler.getDevices()).map((device) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    connections: device.connectionCount,
    profiles: device.permissions.profiles,
  })));
}

export interface RemoteAccessLinks {
  id: string;
  name: string;
  url: string;
  mobileUrl: string;
  qr: string;
  mobileQr: string;
  webQr: string;
}

export function remoteAccessUrl(
  runtime: CliRuntime,
  deviceId: string,
): CliResult<RemoteAccessLinks> {
  const device = runtime.handler.deviceHandler.getDevice(deviceId) as RemoteDevice | undefined;
  if (!device) return fail(`Device "${deviceId}" was not found.`, 2);
  const remote = cliSnapshot(runtime).remote;
  if (!remote.url || !remote.room)
    return fail('Remote access is not ready. Start it with `jnbot remote start`.', 2);
  const url = new URL(remote.url);
  url.searchParams.set('room', remote.room);
  url.searchParams.set('token', device.token);
  url.searchParams.set('id', device.id);
  url.searchParams.set('p2p', 'true');
  const webUrl = url.toString();

  const mobileParams = new URLSearchParams({
    room: remote.room,
    token: device.token,
    id: device.id,
  });
  const mobileUrl = `jnbot://connect?${mobileParams.toString()}`;
  const mobileQr = generateTerminalQr(mobileUrl);
  const webQr = generateTerminalQr(webUrl);

  return ok({
    id: device.id,
    name: device.name,
    url: webUrl,
    mobileUrl,
    qr: mobileQr,
    mobileQr,
    webQr,
  });
}

export function createRemoteDevice(runtime: CliRuntime, name: string): CliResult {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 25)
    return fail('A device name must contain 1–25 characters.', 2);
  const device = runtime.handler.deviceHandler.createDevice(trimmed, {
    profiles: [runtime.handler.getBootstrapRuntime().profileKey],
    permissionMask: DEFAULT_REMOTE_PERMISSIONS,
    mcp: { tools: [] },
  } as never);
  return ok({ id: device.id, name: device.name });
}
