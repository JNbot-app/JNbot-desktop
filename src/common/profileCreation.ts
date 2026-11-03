import type { ProfileCreationAdvanced, ProfileCreationDefaults, ProfileCreationSection, ProfileJoinBehaviour, ProfilePluginReference } from './mobileClientContract';

export class ProfileCreationError extends Error {
  constructor(public readonly section: ProfileCreationSection, message: string) {
    super(`[${section}] ${message}`);
  }
}

function fail(section: ProfileCreationSection, message: string): never { throw new ProfileCreationError(section, message); }
function record(value: unknown, section: ProfileCreationSection): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(section, 'Invalid configuration.');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown, section: ProfileCreationSection, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(section, `Enter ${label}.`);
  return value.trim();
}
function number(value: unknown, section: ProfileCreationSection, label: string, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(section, `Enter a valid ${label}.`);
  return value;
}
function boolean(value: unknown, section: ProfileCreationSection): boolean {
  if (typeof value !== 'boolean') fail(section, 'Choose on or off.');
  return value;
}
function strings(value: unknown, section: ProfileCreationSection, label: string): string[] {
  if (!Array.isArray(value)) fail(section, `Invalid ${label}.`);
  return [...new Set(value.map((v) => text(v, section, label)))];
}
function color(value: unknown, section: ProfileCreationSection): string {
  const result = text(value, section, 'a hex color');
  if (!/^#[\da-f]{6}$/i.test(result)) fail(section, 'Use a six-digit hex color, such as #E6BF4C.');
  return result;
}
function action(value: unknown): 0 | 1 | 2 {
  if (value !== 0 && value !== 1 && value !== 2) fail('defaults', 'Choose a valid kick action.');
  return value;
}
function key(value: string, section: ProfileCreationSection): string {
  if (!value.trim() || ['__proto__', 'constructor', 'prototype'].includes(value.toLowerCase())) fail(section, 'Enter a valid name.');
  return value;
}
function join(value: unknown): ProfileJoinBehaviour {
  const v = record(value, 'gamemodes');
  if (v.kind === 'auto' || v.kind === 'direct') return { kind: v.kind };
  if (v.kind === 'command') return { kind: 'command', command: text(v.command, 'gamemodes', 'a join command') };
  if (v.kind !== 'selector' || (v.pick !== 'name' && v.pick !== 'slot')) fail('gamemodes', 'Choose a valid join method.');
  const hotbarSlot = number(v.hotbarSlot, 'gamemodes', 'hotbar slot (1–9)', 1, 9, true);
  return v.pick === 'name' ? { kind: 'selector', hotbarSlot, pick: 'name' } : {
    kind: 'selector', hotbarSlot, pick: 'slot', staticSlot: number(v.staticSlot, 'gamemodes', 'menu slot (0–53)', 0, 53, true),
  };
}
function defaults(value: unknown): ProfileCreationDefaults {
  const v = record(value, 'defaults');
  const out: ProfileCreationDefaults = {};
  if (v.version !== undefined) out.version = text(v.version, 'defaults', 'a Minecraft version');
  if (v.ip !== undefined) out.ip = text(v.ip, 'defaults', 'a server address');
  if (v.port !== undefined) out.port = number(v.port, 'defaults', 'port (1–65535)', 1, 65535, true);
  for (const k of ['serverIpRotation', 'retryOnLoginFail', 'auto_v4guard', 'autoResourcePackAccept'] as const) {
    if (v[k] !== undefined) out[k] = boolean(v[k], 'defaults');
  }
  for (const k of ['joinServerTimeout', 'join_delay', 'join_delay_premium', 'delay_between_actions'] as const) {
    if (v[k] !== undefined) out[k] = number(v[k], 'defaults', 'time in milliseconds', 0, Number.MAX_SAFE_INTEGER, true);
  }
  if (v.kickBehaviour !== undefined) {
    const kick = record(v.kickBehaviour, 'defaults');
    if (!Array.isArray(kick.rules)) fail('defaults', 'Invalid kick rules.');
    out.kickBehaviour = { defaultAction: action(kick.defaultAction), rules: kick.rules.map((raw) => {
      const rule = record(raw, 'defaults');
      return { id: text(rule.id, 'defaults', 'a rule ID'), kickMessage: text(rule.kickMessage, 'defaults', 'a kick message'), action: action(rule.action) };
    }) };
  }
  if (v.proxy !== undefined) {
    const proxy = record(v.proxy, 'defaults');
    const urls = strings(proxy.urls, 'defaults', 'a proxy address');
    for (const url of urls) {
      try {
        const parsed = new URL(url.includes('://') ? url : `socks5://${url}`);
        if (!['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname || !parsed.port || Number(parsed.port) < 1 || Number(parsed.port) > 65535) fail('defaults', 'Use a SOCKS proxy with a host and port.');
      } catch { fail('defaults', 'Use a SOCKS proxy with a host and port.'); }
    }
    const enabled = boolean(proxy.enabled, 'defaults');
    if (enabled && !urls.length) fail('defaults', 'Add a proxy or turn off the proxy pool.');
    out.proxy = { enabled, urls };
  }
  return out;
}

export type ProfilePluginChoice = { pluginId: string; scriptType: string };

/** Validate and reconstruct the portable creation input. Shared by mobile and backend. */
export function parseProfileAdvanced(value: unknown, plugins: readonly ProfilePluginChoice[]): ProfileCreationAdvanced {
  const v = record(value, 'identity');
  const out: ProfileCreationAdvanced = {};
  if (v.shortName !== undefined) {
    out.shortName = text(v.shortName, 'identity', 'a short name', true);
    if (out.shortName.length > 12) fail('identity', 'Keep the short name to 12 characters.');
  }
  if (v.icon !== undefined) {
    out.icon = v.icon === null ? null : text(v.icon, 'identity', 'an icon URL', true) || null;
    if (out.icon) {
      try { if (!['https:', 'http:'].includes(new URL(out.icon).protocol) && !out.icon.startsWith('data:image/png;base64,')) fail('identity', 'Use an HTTP or HTTPS icon URL.'); }
      catch { fail('identity', 'Use an HTTP or HTTPS icon URL.'); }
    }
  }
  if (v.color !== undefined) out.color = color(v.color, 'identity');
  if (v.ips !== undefined) out.ips = strings(v.ips, 'connection', 'a server address');
  if (v.gamemodes !== undefined) {
    out.gamemodes = strings(v.gamemodes, 'gamemodes', 'a gamemode');
    const canonical = new Set<string>();
    for (const mode of out.gamemodes) {
      if (!/^[a-z\d]+$/i.test(mode)) fail('gamemodes', 'Gamemode names can only contain letters and numbers.');
      key(mode, 'gamemodes');
      if (canonical.has(mode.toLowerCase())) fail('gamemodes', 'Gamemode names must be unique, regardless of capitalization.');
      canonical.add(mode.toLowerCase());
    }
  }
  if (v.kitGamemodes !== undefined) out.kitGamemodes = strings(v.kitGamemodes, 'gamemodes', 'a kit gamemode');
  if (v.defaultGamemode !== undefined) out.defaultGamemode = text(v.defaultGamemode, 'gamemodes', 'a default gamemode', true);
  if (v.joinBehaviours !== undefined) out.joinBehaviours = Object.fromEntries(Object.entries(record(v.joinBehaviours, 'gamemodes')).map(([k, val]) => [key(k, 'gamemodes'), join(val)]));
  if (v.ranksGkits !== undefined) out.ranksGkits = Object.fromEntries(Object.entries(record(v.ranksGkits, 'ranks')).map(([mode, raw]) => {
    const data = record(raw, 'ranks');
    const ranks = Object.fromEntries(Object.entries(record(data.ranks, 'ranks')).map(([name, rawRank]) => {
      const rank = record(rawRank, 'ranks');
      return [key(name, 'ranks'), { price: number(rank.price, 'ranks', 'rank price'), color: color(rank.color, 'ranks') }];
    }));
    const gkits = Object.fromEntries(Object.entries(record(data.gkits, 'ranks')).map(([name, price]) => [key(name, 'ranks'), number(price, 'ranks', 'GKit price')]));
    return [key(mode, 'ranks'), { ranks, gkits }];
  }));
  const catalog = new Map(plugins.map((plugin) => [plugin.pluginId, plugin]));
  const reference = (raw: unknown, section: ProfileCreationSection, allowed?: string[]): ProfilePluginReference => {
    const ref = record(raw, section);
    const pluginId = text(ref.pluginId, section, 'a plugin');
    const source = record(ref.source, section);
    const plugin = catalog.get(pluginId);
    if (source.kind !== 'plugin' || source.pluginId !== pluginId || !plugin || (allowed && !allowed.includes(plugin.scriptType))) fail(section, 'Choose a compatible plugin installed on this phone.');
    const parsed: ProfilePluginReference = { id: text(ref.id, section, 'a script ID'), pluginId, source: { kind: 'plugin', pluginId } };
    if (ref.order !== undefined) parsed.order = number(ref.order, section, 'script order');
    if (ref.hidden !== undefined) parsed.hidden = boolean(ref.hidden, section);
    return parsed;
  };
  for (const section of ['scripts'] as const) {
    if (v[section] === undefined) continue;
    const list = v[section];
    if (!Array.isArray(list)) fail(section, 'Invalid plugin selection.');
    const refs = list.map((raw) => reference(raw, section, section === 'scripts' ? ['script', 'action'] : undefined));
    if (new Set(refs.map((r) => r.pluginId)).size !== refs.length || new Set(refs.map((r) => r.id)).size !== refs.length) fail(section, 'Remove duplicate plugin references.');
    out[section] = refs;
  }
  if (v.disallowedPlugins !== undefined) {
    out.disallowedPlugins = strings(v.disallowedPlugins, 'scripts', 'a blocked plugin');
    if (out.disallowedPlugins.some((id) => !catalog.has(id))) fail('scripts', 'Choose blocked plugins installed on this phone.');
  }
  if (v.botExtensionAction !== undefined) out.botExtensionAction = reference(v.botExtensionAction, 'botExtension', ['botExtension', 'action']);
  if (v.appSettingsDefaults !== undefined) out.appSettingsDefaults = defaults(v.appSettingsDefaults);
  return out;
}
