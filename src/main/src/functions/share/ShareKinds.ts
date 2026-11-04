import { randomUUID } from 'node:crypto';
import {
  SERVER_ID_PATTERN,
  type ShareDetailSection,
  type ShareEnvelope,
  type ShareInstallInput,
  type ShareItemSummary,
  type ShareKind,
  type ShareListing,
  type ShareMeta,
  type SharePluginPreview,
} from '../../../../common/share';
import type { CustomProfile } from '../../../../common/profiles';
import {
  TRIGGER_ACTION_TYPES,
  TRIGGER_EVENTS,
  describeTrigger,
  type Trigger,
  type TriggerAction,
} from '../../../../common/triggers';
import type { Chain, ChainStep, MacroCode, MacroInfo } from '../../types';
import { chainNextLabel, normalizeChainStep, type ChainNext } from '../../../../common/chains';
import type Macros_ from '../Macros';
import type { PortablePlugin, PortablePluginPreview } from '../Macros';
import type ProfileTransfer from '../ProfileTransfer';
import type Settings_ from '../Settings';
import type { ProfileScript } from '../../../../common/profileScripts';
import generateUID from '../../../UID';
import { getPlatform } from '../../platform';
import { deobfuscateCodeFromBase64 } from '../scriptObfuscate';
import { pluginContentDigest, pluginSecurity, publisherFingerprint } from '../signing';

export interface ShareContext {
  settings: Settings_;
  macros: Macros_;
  profileTransfer: ProfileTransfer;
}

export type Envelope = ShareEnvelope<unknown, PortablePlugin>;

export interface BuiltShare {
  meta: Omit<ShareMeta, 'createdAt' | 'minAppVersion' | 'servers'>;
  payload: unknown;
  plugins: PortablePlugin[];
  /** Looks for the marketplace card. */
  listing?: Pick<ShareListing, 'color' | 'serverId'>;
  /** Banner source (https URL or data URI); uploaded as an image. */
  banner?: string;
}

interface ShareKindHandler {
  build(ref: string, ctx: ShareContext, profileKey?: string): Promise<BuiltShare>;
  /** Rows for the review panel; defaults to the envelope's plugins. */
  preview?(envelope: Envelope, ctx: ShareContext, profileKey?: string): SharePluginPreview[];
  /** What gets added besides the plugins, shown before installing. */
  describe?(envelope: Envelope): ShareDetailSection[];
  /**
   * Install and return the local reference (plugin id, folder, profile key, ...).
   * With `existingRef` the share updates that item in place.
   */
  install(
    envelope: Envelope,
    input: ShareInstallInput & { existingRef?: string },
    ctx: ShareContext,
  ): Promise<string>;
}

const codeText = (code: MacroCode): string =>
  typeof (code as { code?: unknown }).code === 'string'
    ? (code as { code: string }).code
    : JSON.stringify(code, null, 2);

const hexColor = (value: unknown) =>
  typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : undefined;

/** Banner and accent colour of a plugin, for its card. */
const pluginLooks = (info: MacroInfo) => ({
  banner: info.banner,
  listing: { color: hexColor(info.theme?.primaryColor) },
});

const pluginItem = (info: MacroInfo): ShareItemSummary => ({
  name: info.name.slice(0, 100),
  type: info.scriptType,
  ...(info.description ? { description: info.description.slice(0, 300) } : {}),
});

/** Profile-UI and bot-extension plugins only run on desktop. */
export const pluginOptions = () => ({ allowDesktopTypes: getPlatform().platform !== 'mobile' });

export function previewRow(preview: PortablePluginPreview): SharePluginPreview {
  const { package: item } = preview;
  return {
    ownerId: item.source.ownerId,
    pluginId: item.source.pluginId,
    revision: item.revision,
    name: item.bundle.info.name,
    description: item.bundle.info.description,
    scriptType: item.bundle.info.scriptType,
    state: preview.state,
    verification: preview.verification,
    publisherName: preview.publisherName,
    fingerprint: preview.fingerprint,
    reason: preview.reason,
    code: codeText(item.bundle.code),
  };
}

const profileScripts = (ctx: ShareContext, profileKey: string): ProfileScript[] =>
  ctx.settings.JNdata?.data?.[profileKey]?.scripts ?? [];

/** Package of a script that may only exist inside its profile. */
async function exportProfileScript(script: ProfileScript, ctx: ShareContext): Promise<PortablePlugin | null> {
  const exported = await ctx.settings.profiles.scripts?.bundleForExport(script);
  if (!exported) return null;
  const { bundle, signature } = exported;
  const code = deobfuscateCodeFromBase64(bundle.codeObf) as MacroCode;
  return {
    version: 1,
    source: { ownerId: generateUID(), pluginId: bundle.info.pluginId },
    revision: pluginContentDigest(bundle.info, code),
    exportedAt: Date.now(),
    bundle: { format: 'jnbot-plugin', version: 2, info: bundle.info, code, signature },
  };
}

/**
 * Plugins to bundle: scripts of `profileKey` too, so the share also works on
 * profiles that do not have them.
 */
async function exportPlugins(
  pluginIds: Iterable<string>,
  ctx: ShareContext,
  profileKey?: string,
): Promise<PortablePlugin[]> {
  const scripts = profileKey ? profileScripts(ctx, profileKey) : [];
  const plugins = await Promise.all(
    [...new Set(pluginIds)].map(async (pluginId) => {
      const script = scripts.find((item) => item.pluginId === pluginId);
      const exported = script && (await exportProfileScript(script, ctx));
      if (exported) return exported;
      return ctx.macros.findPlugin(pluginId) ? ctx.macros.exportPortablePlugin(pluginId, { sign: true }) : null;
    }),
  );
  return plugins.filter((item): item is PortablePlugin => !!item);
}

/** A different version of a plugin you imported from this same publisher. */
function isPluginUpdate({ source, revision, bundle }: PortablePlugin): boolean {
  const publicKey = bundle.signature?.publicKey;
  const provenance = pluginSecurity().getProvenance(source.pluginId);
  return (
    !!publicKey &&
    !!provenance?.importSource &&
    provenance.importSource.revision !== revision &&
    provenance.fingerprint === publisherFingerprint(publicKey)
  );
}

/**
 * Bundled plugins a chain or trigger installs: only what neither the profiles
 * nor the plugin library have. Plugin updates are offered, never assumed (see
 * {@link defaultPluginAction}); anything else you already have stays as it is.
 */
function wantedPlugins(envelope: Envelope, ctx: ShareContext, profileKeys: string[]): PortablePlugin[] {
  const inProfiles = new Set(profileKeys.flatMap((key) => profileScripts(ctx, key).map((script) => script.pluginId)));
  return envelope.plugins.filter(
    (item) =>
      !inProfiles.has(item.source.pluginId) && (!ctx.macros.findPlugin(item.source.pluginId) || isPluginUpdate(item)),
  );
}

/** Review rows for the plugins a chain or trigger would add to `profileKey`. */
const previewWanted = (envelope: Envelope, ctx: ShareContext, profileKey?: string): SharePluginPreview[] =>
  ctx.macros
    .previewPortablePlugins(
      wantedPlugins(envelope, ctx, profileKey ? [profileKey] : envelope.meta.servers),
      pluginOptions(),
    )
    .map(previewRow)
    .filter((row) => row.state !== 'identical')
    .map((row) => (row.state === 'conflict' ? { ...row, state: 'update' as const } : row));

/**
 * Install the given plugins (all bundled ones by default); maps shared plugin
 * ids to local ids. Plugins of `plugins` that were skipped are left out.
 */
async function installPlugins(
  envelope: Envelope,
  input: ShareInstallInput,
  ctx: ShareContext,
  plugins = envelope.plugins,
): Promise<Map<string, string>> {
  const ids = new Map(envelope.plugins.map((item) => [item.source.pluginId, item.source.pluginId]));
  if (!plugins.length) return ids;
  const result = await ctx.macros.importPortablePlugins(plugins, input.decisions, pluginOptions());
  if (result.failed.length) {
    throw new Error(result.failed.map((item) => item.error).join('\n'));
  }
  for (const item of result.installed) ids.set(item.sourcePluginId, item.installedPluginId);
  for (const item of result.skipped) if (!item.upToDate) ids.delete(item.pluginId);
  return ids;
}

function profileSettings(ctx: ShareContext, profileKey?: string) {
  if (!profileKey) throw new Error('A profile is required.');
  return ctx.settings.getProfileSettings(profileKey);
}

const NOTHING_INSTALLED = 'Nothing was installed.';

const isText = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length <= max;

/** Display name of a plugin bundled in the share, by its shared id. */
const pluginName = (envelope: Envelope, pluginId: string) =>
  envelope.plugins.find((item) => item.source.pluginId === pluginId)?.bundle.info.name ??
  `Missing plugin (${pluginId})`;

const plugin: ShareKindHandler = {
  async build(pluginId, ctx) {
    const plugins = await exportPlugins([pluginId], ctx);
    if (!plugins.length) throw new Error('Plugin not found.');
    const { info } = plugins[0].bundle;
    return {
      meta: { title: info.name, description: info.description ?? '', items: [pluginItem(info)] },
      payload: {},
      plugins,
      ...pluginLooks(info),
    };
  },
  async install(envelope, input, ctx) {
    if (envelope.plugins.length !== 1) throw new Error('Invalid plugin share.');
    const ids = await installPlugins(envelope, input, ctx);
    if (!ids.size) throw new Error(NOTHING_INSTALLED);
    return ids.get(envelope.plugins[0].source.pluginId)!;
  },
};

const bundle: ShareKindHandler = {
  async build(folder, ctx) {
    const pluginIds = Object.entries(ctx.settings.shared.pluginMetadata ?? {})
      .filter(([, metadata]) => metadata?.folder === folder)
      .map(([pluginId]) => pluginId);
    const plugins = await exportPlugins(pluginIds, ctx);
    if (!plugins.length) throw new Error('This folder has no plugins to share.');
    const cover = plugins.find((item) => item.bundle.info.banner)?.bundle.info ?? plugins[0].bundle.info;
    return {
      meta: {
        title: folder,
        description: '',
        items: plugins.map((item) => pluginItem(item.bundle.info)),
      },
      payload: {},
      plugins,
      ...pluginLooks(cover),
    };
  },
  describe(envelope) {
    return [
      {
        title: 'Bundle',
        rows: [
          { label: 'Folder', value: envelope.meta.title },
          { label: 'Plugins', value: String(envelope.plugins.length) },
        ],
      },
    ];
  },
  async install(envelope, input, ctx) {
    const folder = input.existingRef ?? envelope.meta.title.trim().slice(0, 100);
    const ids = await installPlugins(envelope, input, ctx);
    if (!ids.size) throw new Error(NOTHING_INSTALLED);
    const pluginMetadata = { ...ctx.settings.shared.pluginMetadata };
    for (const pluginId of ids.values()) {
      if (ctx.macros.findPlugin(pluginId)) pluginMetadata[pluginId] = { ...pluginMetadata[pluginId], folder };
    }
    ctx.settings.updateShared({ pluginMetadata }, true);
    return folder;
  },
};

const profile: ShareKindHandler = {
  async build(profileKey, ctx) {
    // Publish the library plugins you edit, not stale imported snapshots of them.
    ctx.settings.profiles.linkLibraryScripts(profileKey);
    // An installed copy's share link is local state, not part of the profile.
    const { share: _share, ...portable } = await ctx.profileTransfer.portableProfile(profileKey);
    return {
      meta: {
        title: portable.data.name,
        description: '',
        items: (portable.scriptBundles ?? []).map(({ info }) => pluginItem(info)),
      },
      payload: portable,
      plugins: [],
      banner: portable.data.icon ?? undefined,
      listing: {
        color: hexColor(portable.data.color),
        // Official profiles install under their server id, which other shares target.
        ...(pluginSecurity().isReviewer() && SERVER_ID_PATTERN.test(portable.id) ? { serverId: portable.id } : {}),
      },
    };
  },
  describe(envelope) {
    const data = (envelope.payload as CustomProfile)?.data;
    if (!data) return [];
    const gamemodes = Array.isArray(data.gamemodes) ? data.gamemodes.map(String) : [];
    return [
      {
        title: 'Profile',
        rows: [
          { label: 'Name', value: String(data.name) },
          { label: 'Server', value: `${data.defaultIp || 'no IP set'}:${data.defaultPort}` },
          ...(gamemodes.length ? [{ label: 'Gamemodes', value: gamemodes.join(', ') }] : []),
          { label: 'Not included', value: 'Your settings, alts and plugin options stay your own' },
        ],
      },
    ];
  },
  preview(envelope, ctx) {
    const portable = envelope.payload as CustomProfile;
    return ctx.settings.profiles.bundleVerifications(portable).map(({ script, info, verification }) => ({
      ownerId: 'profile',
      pluginId: script.id,
      revision: '',
      name: info.name,
      description: info.description,
      scriptType: info.scriptType,
      state: verification.status === 'invalid' || verification.status === 'unsupported' ? 'invalid' : 'new',
      verification: verification.status === 'unsupported' ? 'invalid' : verification.status,
      publisherName: verification.publisherName,
      fingerprint: verification.fingerprint,
      reason: verification.reason,
      code: verification.code ? codeText(verification.code) : '',
    }));
  },
  async install(envelope, input, ctx) {
    const portable = envelope.payload as CustomProfile;
    if (!portable?.data || typeof portable.data !== 'object' || !isText(portable.data.name)) {
      throw new Error('Invalid profile share.');
    }
    const official = pluginSecurity().isOfficialPublicKey(envelope.signature.publicKey);
    // An official profile installs under its own id and replaces a local
    // profile with that id, so old local copies turn into the installed one and
    // keep their settings. Others cannot claim a profile you already have.
    const taken = official ? undefined : ctx.settings.profiles.get(portable.id);
    const claimable = SERVER_ID_PATTERN.test(portable.id) && (!taken || taken.share?.id === input.id);
    const id = input.existingRef ?? (claimable ? portable.id : `shared-${input.id}`);
    const materialized = await ctx.settings.profiles.materializeSyncedProfile({
      ...structuredClone(portable),
      id,
      predefined: false,
      sourceProfileId: undefined,
      remoteSource: undefined,
      share: { id: input.id, official },
      data: { ...structuredClone(portable.data), id },
    });
    ctx.settings.profiles.upsert(materialized);
    return id;
  },
};

type SharedChain = {
  name: string;
  description?: string;
  gamemode?: string | null;
  steps: ChainStep[];
};

const isNext = (value: unknown) => value === undefined || isText(value, 60);

/** Steps exactly as they run: overrides and outcomes travel with the share. */
const isSharedStep = (step: any): step is ChainStep =>
  isText(step?.name) &&
  isText(step?.scriptId) &&
  isText(String(step?.id), 60) &&
  (step.options === undefined || (typeof step.options === 'object' && !Array.isArray(step.options))) &&
  isNext(step.onSuccess) &&
  isNext(step.onFail);

const chain: ShareKindHandler = {
  async build(chainId, ctx, profileKey) {
    const scripts = profileSettings(ctx, profileKey).scripts ?? {};
    const source = scripts.chains?.[chainId] as Chain | undefined;
    if (!source) throw new Error('Chain not found.');
    const options = scripts[chainId] ?? {};
    const name = String(options.name ?? source.name ?? 'Chain').slice(0, 100);
    const description = String(options.description ?? '').slice(0, 300);
    const stripped =
      options.altRange || options.withTags?.length || options.ignoreAlts?.length
        ? ['Alt range, tags and ignored alts']
        : [];
    return {
      meta: {
        title: name,
        description,
        items: source.chains.map((step) => ({ name: step.name.slice(0, 100), type: 'action' })),
        stripped,
      },
      payload: {
        name,
        description,
        gamemode: options.gamemode ?? null,
        steps: source.chains.map(normalizeChainStep),
      } satisfies SharedChain,
      plugins: await exportPlugins(source.chains.map((step) => step.scriptId), ctx, profileKey),
    };
  },
  preview: previewWanted,
  describe(envelope) {
    const payload = envelope.payload as Partial<SharedChain> | undefined;
    const steps = Array.isArray(payload?.steps) ? payload.steps : [];
    const outcome = (label: string, next?: ChainNext) =>
      next && next !== 'next' ? ` · ${label}: ${chainNextLabel(next, steps).toLowerCase()}` : '';
    return [
      {
        title: String(payload?.name ?? 'Chain'),
        rows: [
          ...(payload?.gamemode ? [{ label: 'Gamemode', value: String(payload.gamemode) }] : []),
          ...steps.map((step, index) => ({
            label: `Step ${index + 1}`,
            value: `${step.name}: runs ${pluginName(envelope, step.scriptId)}${outcome(
              'if it works',
              step.onSuccess,
            )}${outcome('if it fails', step.onFail)}`,
          })),
          { label: 'Runs on', value: 'Your alts — set the alt range in the chain settings' },
        ],
      },
    ];
  },
  async install(envelope, input, ctx) {
    const payload = envelope.payload as Partial<SharedChain> | undefined;
    const steps: unknown[] = Array.isArray(payload?.steps) ? payload.steps : [];
    if (
      !isText(payload?.name, 100) ||
      (payload.description !== undefined && !isText(payload.description, 300)) ||
      steps.length > 200 ||
      !steps.every(isSharedStep)
    ) {
      throw new Error('Invalid chain share.');
    }
    const scripts = profileSettings(ctx, input.profileKey).scripts ?? {};
    const ids = await installPlugins(envelope, input, ctx, wantedPlugins(envelope, ctx, [input.profileKey!]));
    const id = input.existingRef ?? randomUUID();
    const chainSteps = (steps as ChainStep[]).map((step) => ({
      ...normalizeChainStep(step),
      scriptId: ids.get(step.scriptId) ?? step.scriptId,
    }));
    ctx.settings.updateProfileSettings(input.profileKey!, [
      { path: ['scripts', 'chains', id], value: { id, name: payload.name, chains: chainSteps } },
      {
        path: ['scripts', id],
        // An update keeps your own options (alt range, tags, gamemode).
        value: {
          ...(isText(payload.gamemode) ? { gamemode: payload.gamemode } : {}),
          ...(input.existingRef ? scripts[id] : {}),
          name: payload.name,
          ...(payload.description ? { description: payload.description } : {}),
        },
      },
    ]);
    return id;
  },
};

/**
 * Rebuilds an action from known fields only. Webhooks and file paths are
 * secrets / machine specific, so they are never shared.
 */
function sanitizeAction(action: TriggerAction): TriggerAction {
  switch (action.type) {
    case 'discord':
      return { type: 'discord', webhook: '' };
    case 'log':
      return { type: 'log', directory: '' };
    case 'chat':
      return { type: 'chat', message: String(action.message ?? '').slice(0, 256) };
    case 'scriptAction':
      return { type: 'scriptAction', id: String(action.id ?? '') };
    default:
      return { type: 'notification' };
  }
}

function actionText(action: TriggerAction, envelope: Envelope): string {
  const name = TRIGGER_ACTION_TYPES[action.type].name;
  switch (action.type) {
    case 'chat':
      return `${name}: "${action.message}"`;
    case 'scriptAction':
      return `${name}: ${pluginName(envelope, action.id)}`;
    case 'discord':
      return `${name} (add your own webhook)`;
    case 'log':
      return `${name} (choose your own folder)`;
    default:
      return name;
  }
}

const trigger: ShareKindHandler = {
  async build(triggerId, ctx, profileKey) {
    const source = (profileSettings(ctx, profileKey).triggers ?? []).find(
      (item: Trigger) => item.id === triggerId,
    ) as Trigger | undefined;
    if (!source) throw new Error('Trigger not found.');
    const stripped = [
      ...(source.actions.some((action) => action.type === 'discord') ? ['Discord webhook'] : []),
      ...(source.actions.some((action) => action.type === 'log') ? ['Log directory'] : []),
      ...(source.alts?.length || source.tags?.length ? ['Selected alts and tags'] : []),
    ];
    const { id: _id, alts: _alts, tags: _tags, ...rest } = source;
    const name = describeTrigger(source).slice(0, 100);
    return {
      meta: {
        title: name,
        description: '',
        items: [
          {
            name,
            type: TRIGGER_EVENTS[source.event]?.name ?? source.event,
            description: `Then: ${source.actions.map((action) => TRIGGER_ACTION_TYPES[action.type]?.name ?? action.type).join(', ')}`.slice(0, 300),
          },
        ],
        stripped,
      },
      payload: { triggers: [{ ...rest, actions: source.actions.map(sanitizeAction) }] },
      plugins: await exportPlugins(
        source.actions.flatMap((action) => (action.type === 'scriptAction' ? [action.id] : [])),
        ctx,
        profileKey,
      ),
    };
  },
  preview: previewWanted,
  describe(envelope) {
    const incoming = (envelope.payload as { triggers?: Trigger[] })?.triggers;
    return (Array.isArray(incoming) ? incoming : []).map((item) => {
      const event = TRIGGER_EVENTS[item.event];
      const actions = (Array.isArray(item.actions) ? item.actions : []).map(sanitizeAction);
      return {
        title: describeTrigger(item),
        rows: [
          { label: 'When', value: event ? `${event.name} — ${event.description}` : String(item.event) },
          ...(item.filter && event?.filter ? [{ label: event.filter.label, value: String(item.filter) }] : []),
          ...(item.cooldown ? [{ label: 'Cooldown', value: `${item.cooldown}s per bot` }] : []),
          ...actions.map((action, index) => ({
            label: actions.length > 1 ? `Action ${index + 1}` : 'Action',
            value: actionText(action, envelope),
          })),
          { label: 'Runs on', value: 'All bots — on as soon as it is installed' },
        ],
      };
    });
  },
  async install(envelope, input, ctx) {
    const incoming = (envelope.payload as { triggers?: unknown })?.triggers;
    const item = Array.isArray(incoming) && incoming.length === 1 ? (incoming[0] as Trigger) : undefined;
    if (!item || !Object.hasOwn(TRIGGER_EVENTS, item.event) || !Array.isArray(item.actions) || item.actions.length > 20) {
      throw new Error('Invalid trigger share.');
    }
    const current: Trigger[] = profileSettings(ctx, input.profileKey).triggers ?? [];
    const previous = current.find((existing) => existing.id === input.existingRef);
    const ids = await installPlugins(envelope, input, ctx, wantedPlugins(envelope, ctx, [input.profileKey!]));
    // An update keeps your own state, alts, tags, webhooks and log folders.
    const next: Trigger = {
      id: previous?.id ?? randomUUID(),
      event: item.event,
      enabled: previous?.enabled ?? true,
      actions: item.actions.map((raw, index) => {
        const action = sanitizeAction(raw);
        if (action.type === 'scriptAction') return { ...action, id: ids.get(action.id) ?? action.id };
        const kept = previous?.actions[index];
        return (action.type === 'discord' || action.type === 'log') && kept?.type === action.type ? kept : action;
      }),
      ...(isText(item.filter, 1000) ? { filter: item.filter } : {}),
      ...(Number.isFinite(item.cooldown) ? { cooldown: item.cooldown } : {}),
      ...(isText(item.name, 100) ? { name: item.name } : {}),
      ...(previous?.alts ? { alts: previous.alts } : {}),
      ...(previous?.tags ? { tags: previous.tags } : {}),
    };
    ctx.settings.updateProfileSettings(input.profileKey!, {
      path: ['triggers'],
      value: previous ? current.map((existing) => (existing === previous ? next : existing)) : [...current, next],
    });
    return next.id;
  },
};

export const SHARE_KIND_HANDLERS: Record<ShareKind, ShareKindHandler> = {
  plugin,
  bundle,
  profile,
  chain,
  trigger,
};
