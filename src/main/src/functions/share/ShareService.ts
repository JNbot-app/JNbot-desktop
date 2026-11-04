import { createHash } from 'node:crypto';
import {
  MARKET_REFRESH_INTERVAL,
  MAX_DETAIL_TITLE_LENGTH,
  MAX_DETAIL_VALUE_LENGTH,
  MAX_REVISION_LOOKUP,
  MAX_SHARE_BYTES,
  MAX_SHARE_DESCRIPTION_LENGTH,
  MAX_SHARE_TITLE_LENGTH,
  SERVER_ID_PATTERN,
  SHARE_ENVELOPE_FORMAT,
  SHARE_ENVELOPE_VERSION,
  SHARE_UPDATE_CHECK_INTERVAL,
  approvalMessage,
  canInstallShare,
  isProfileShareKind,
  isShareKind,
  parseShareId,
  previewBlocked,
  shareBannerUrl,
  shareInstallKey,
  shareUpdateAvailable,
  type InstalledShare,
  type MarketEntry,
  type OwnedShare,
  type ShareCreateInput,
  type ShareDetailSection,
  type ShareInstallInput,
  type ShareKind,
  type ShareListing,
  type SharePreview,
  type SharePreviewInput,
  type SharePublisher,
  type ShareRecord,
  type ShareReviewInput,
  type ShareRevisionStatus,
  type ShareState,
  type ShareVisibility,
} from '../../../../common/share';
import packageJson from '../../../../../release/app/package.json';
import StorageModule from '../storage/Storage';
import { devicePath, portablePath } from '../storage/portablePaths';
import { canonicalJson, pluginSecurity, publisherFingerprint, type PluginVerification } from '../signing';
import { bannerLink, loadBanner, multipart, packContent, sha256Hex, shareOrigin, shareRequest, unpackContent } from './ShareApi';
import {
  SHARE_KIND_HANDLERS,
  pluginOptions,
  previewRow,
  type Envelope,
  type ShareContext,
} from './ShareKinds';

interface SharesFile {
  version: 2;
  owned: Record<string, OwnedShare>;
  installed: ShareState['installed'];
  lastUpdateCheck?: number;
  /** Local profiles already compared with the official ones, so startup does not ask again. */
  adoptChecked?: string[];
}

interface FetchedShare {
  id: string;
  revision: string;
  envelope: Envelope;
  verification: PluginVerification;
  listed: boolean;
}

interface MarketCache {
  etag: string;
  entries: MarketEntry[];
  /** Records of the entries, so installing from the catalog only downloads the content. */
  records: Map<string, ShareRecord>;
  fetchedAt: number;
}

/** Last catalog on disk, so a restart revalidates it (one row read) instead of downloading it again. */
interface MarketFile {
  origin?: string;
  etag?: string;
  records?: ShareRecord[];
}

const VOLATILE_KEYS = new Set(['signature', 'exportedAt', 'createdAt', 'signedAt']);
/** Owner status refreshes when the share pages open, but not more often than this. */
const FORCED_CHECK_INTERVAL = 60 * 1000;
/** The catalog is dropped when nobody looked at the marketplace for this long. */
const MARKET_IDLE_TIMEOUT = 30 * 60 * 1000;

function withoutVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatile);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE_KEYS.has(key))
      .map(([key, entry]) => [key, withoutVolatile(entry)]),
  );
}

/** Digest of what a share contains, ignoring signatures and timestamps. */
const contentDigest = (envelope: Omit<Envelope, 'signature'>) =>
  createHash('sha256').update(canonicalJson(withoutVolatile(envelope))).digest('hex');

/** Details as the listing carries them; the preview shows them in full. */
const listingDetails = (details: ShareDetailSection[]): ShareDetailSection[] =>
  details.map(({ title, rows }) => ({
    title: title.slice(0, MAX_DETAIL_TITLE_LENGTH),
    rows: rows.map((row) => ({ ...row, value: row.value.slice(0, MAX_DETAIL_VALUE_LENGTH) })),
  }));

const servers = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => SERVER_ID_PATTERN.test(String(id))))] : [];

/** Approved by an official key for exactly this revision, listing and content. */
const isReviewed = (record: ShareRecord) =>
  !!record.approval &&
  pluginSecurity().verifyOfficialMessage(
    approvalMessage(record.id, record.revision, sha256Hex(record.listing), record.contentSha256),
    record.approval,
  );

/** Hosted banner, else the image URL the listing links. */
const bannerOf = (record: ShareRecord, listing: ShareListing): { bannerUrl?: string } => {
  const bannerUrl = record.hasBanner ? shareBannerUrl(record.id, record.revision, shareOrigin()) : listing.bannerUrl;
  return bannerUrl ? { bannerUrl } : {};
};

function publisherOf(publicKey: string, name: string): SharePublisher {
  const security = pluginSecurity();
  const fingerprint = publisherFingerprint(publicKey);
  return {
    name,
    fingerprint,
    trusted: security.isPublisherTrusted(fingerprint, publicKey),
    own: security.isOwnPublicKey(publicKey),
    official: security.isOfficialPublicKey(publicKey),
  };
}

/**
 * Creates, updates, lists and installs shares (private links and marketplace
 * entries). Requests stay few: the catalog is cached with an ETag, and
 * update checks are batched and run at most once a day (or when the
 * marketplace catalog is fetched, which carries the approved revisions).
 */
export default class ShareService {
  private readonly store = new StorageModule<SharesFile>(
    portablePath('shares.json'),
    () => ({ version: 2, owned: {}, installed: {} }),
    { validate: (file) => file?.version === 2 && !!file.owned && !!file.installed },
  );

  /** Last previewed share, so installing does not download it again. */
  private fetched?: FetchedShare;

  private checking?: Promise<void>;

  private updating?: Promise<void>;

  /** Profiles whose share was checked for updates since startup. */
  private loadedProfiles = new Set<string>();

  private market?: MarketCache;

  private readonly marketStore = new StorageModule<MarketFile>(devicePath('share-market.json'), () => ({}));

  private marketTimer?: NodeJS.Timeout;

  /** Review queue records, so a reviewer can preview the pending revision. */
  private reviewRecords = new Map<string, ShareRecord>();

  constructor(
    private readonly ctx: ShareContext,
    private readonly publish: (state: ShareState) => void,
  ) {}

  private get file(): SharesFile {
    return this.store.get();
  }

  private persist(): ShareState {
    this.store.save();
    const state = this.state();
    this.publish(state);
    return state;
  }

  private get appVersion(): string {
    // Not `app.getVersion()`: in dev that returns the Electron version.
    return packageJson.version.split('-')[0];
  }

  /** Whether the local plugin / folder / profile / chain / trigger behind a share still exists. */
  private itemExists(kind: ShareKind, ref: string, profileKey?: string): boolean {
    switch (kind) {
      case 'plugin':
        return !!this.ctx.macros.findPlugin(ref);
      case 'profile':
        return !!this.ctx.settings.getProfile(ref);
      case 'bundle':
        return Object.values(this.ctx.settings.shared.pluginMetadata ?? {}).some(
          (metadata) => metadata?.folder === ref,
        );
      default: {
        if (!profileKey || !this.ctx.settings.getProfile(profileKey)) return false;
        const settings = this.ctx.settings.getProfileSettings(profileKey);
        return kind === 'chain'
          ? !!settings.scripts?.chains?.[ref]
          : (settings.triggers ?? []).some((item: { id: string }) => item.id === ref);
      }
    }
  }

  private installExists = (share: InstalledShare) => this.itemExists(share.kind, share.localRef, share.profileKey);

  /** Installs of share `id` (a chain or trigger can be installed in several profiles). */
  private installsOf(id: string): InstalledShare[] {
    return Object.values(this.file.installed).filter((share) => share.id === id);
  }

  /** Owned and installed shares; installs whose local copy is gone are dropped. */
  state(): ShareState {
    const { installed } = this.file;
    const stale = Object.keys(installed).filter((key) => !this.installExists(installed[key]));
    for (const key of stale) delete installed[key];
    if (stale.length) this.store.save();
    return {
      owned: this.file.owned,
      installed,
      appVersion: this.appVersion,
      reviewer: pluginSecurity().isReviewer(),
    };
  }

  /** Signed envelope (gzipped), listing and banner for the item behind a share. */
  private async build(input: Pick<OwnedShare, 'kind' | 'ref' | 'profileKey' | 'servers'>) {
    const handler = SHARE_KIND_HANDLERS[input.kind];
    const built = await handler.build(input.ref, this.ctx, input.profileKey);
    const unsigned: Omit<Envelope, 'signature'> = {
      format: SHARE_ENVELOPE_FORMAT,
      version: SHARE_ENVELOPE_VERSION,
      kind: input.kind,
      meta: {
        ...built.meta,
        title: built.meta.title.slice(0, MAX_SHARE_TITLE_LENGTH),
        description: built.meta.description.slice(0, MAX_SHARE_DESCRIPTION_LENGTH),
        createdAt: new Date().toISOString(),
        minAppVersion: this.appVersion,
        servers: input.servers,
      },
      payload: built.payload,
      plugins: built.plugins,
    };
    const envelope: Envelope = { ...unsigned, signature: pluginSecurity().signValue(unsigned) };
    const content = packContent(JSON.stringify(envelope));
    if (content.byteLength > MAX_SHARE_BYTES) {
      throw new Error('This is too large to share (max 1 MB compressed).');
    }
    const { meta } = unsigned;
    const listing: ShareListing = {
      kind: input.kind,
      title: meta.title,
      description: meta.description,
      items: meta.items,
      ...(meta.stripped?.length ? { stripped: meta.stripped } : {}),
      details: listingDetails(handler.describe?.(envelope) ?? []),
      minAppVersion: meta.minAppVersion,
      servers: meta.servers,
      publisherName: envelope.signature.publisherName,
      bannerUrl: bannerLink(built.banner),
      ...built.listing,
    };
    return {
      listing: JSON.stringify(listing),
      content,
      banner: loadBanner(built.banner),
      title: meta.title,
      digest: contentDigest(unsigned),
    };
  }

  private async upload(
    path: string,
    built: Awaited<ReturnType<ShareService['build']>>,
    visibility: ShareVisibility,
  ): Promise<{ id: string; revision: string }> {
    const { body, contentType } = await multipart({
      listing: built.listing,
      visibility,
      content: built.content,
      banner: built.banner,
    });
    return (await shareRequest('PUT', path, { body, contentType, signed: true })).json() as Promise<{
      id: string;
      revision: string;
    }>;
  }

  async create(input: ShareCreateInput): Promise<OwnedShare> {
    if (!isShareKind(input?.kind) || typeof input.ref !== 'string') throw new Error('Invalid share.');
    // One share per item: sharing it again returns the existing one.
    const existing = Object.values(this.file.owned).find(
      (share) => share.kind === input.kind && share.ref === input.ref && share.profileKey === input.profileKey,
    );
    if (existing) return existing;
    const visibility: ShareVisibility = input.visibility === 'public' ? 'public' : 'link';
    const target = { kind: input.kind, ref: input.ref, profileKey: input.profileKey, servers: servers(input.servers) };
    const built = await this.build(target);
    const { id, revision } = await this.upload('/api/s', built, visibility);
    const owned: OwnedShare = {
      id,
      ...target,
      title: built.title,
      revision,
      digest: built.digest,
      updatedAt: Date.now(),
      visibility,
      status: visibility === 'public' ? 'pending' : 'none',
    };
    this.file.owned[id] = owned;
    this.persist();
    return owned;
  }

  /**
   * Whether the local item differs from what the share serves; 'deleted' when
   * the item is gone (the share can then only be deleted).
   */
  async hasChanges(id: string): Promise<boolean | 'deleted'> {
    const owned = this.ownedShare(id);
    if (!this.itemExists(owned.kind, owned.ref, owned.profileKey)) return 'deleted';
    return (await this.build(owned)).digest !== owned.digest;
  }

  /**
   * Publish the current local item, optionally switching visibility or target
   * servers. Public shares keep their approved version live until the new one
   * is reviewed.
   */
  async update(id: string, change: { visibility?: ShareVisibility; servers?: string[] } = {}): Promise<OwnedShare> {
    const owned = this.ownedShare(id);
    const visibility = change.visibility ?? owned.visibility;
    const next = { ...owned, servers: change.servers ? servers(change.servers) : owned.servers };
    const built = await this.build(next);
    const { revision } = await this.upload(`/api/s/${id}`, built, visibility);
    this.file.owned[id] = {
      ...next,
      title: built.title,
      revision,
      digest: built.digest,
      updatedAt: Date.now(),
      visibility,
      status: visibility === 'public' ? 'pending' : 'none',
      note: null,
      pending: visibility === 'public' && (owned.status === 'live' || !!owned.pending),
    };
    this.persist();
    return this.file.owned[id];
  }

  /** Marketplace on/off. Going public uploads the current version for review. */
  async setVisibility(id: string, visibility: ShareVisibility, serverIds?: string[]): Promise<OwnedShare> {
    const owned = this.ownedShare(id);
    if (visibility === 'public') return this.update(id, { visibility, servers: serverIds });
    if (owned.visibility === 'link') return owned;
    await shareRequest('POST', `/api/s/${id}/unlist`, { signed: true });
    this.file.owned[id] = { ...owned, visibility: 'link', status: 'none', note: null, pending: false };
    this.dropMarket();
    this.persist();
    return this.file.owned[id];
  }

  async remove(id: string): Promise<ShareState> {
    const owned = this.ownedShare(id);
    try {
      await shareRequest('DELETE', `/api/s/${id}`, { signed: true });
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
    if (owned.visibility === 'public') this.dropMarket();
    delete this.file.owned[id];
    return this.persist();
  }

  private ownedShare(id: string): OwnedShare {
    const owned = this.file.owned[id];
    if (!owned) throw new Error('Share not found.');
    return owned;
  }

  async report(id: string, reason: string): Promise<void> {
    await shareRequest('POST', `/api/s/${id}/report`, {
      body: JSON.stringify({ reason: String(reason ?? '').slice(0, 300) }),
      signed: true,
    });
  }

  private async fetchRecord(id: string, revision?: string): Promise<ShareRecord> {
    const known = revision ? this.reviewRecords.get(id) : this.market?.records.get(id);
    if (known && (!revision || known.revision === revision)) return known;
    return (await shareRequest('GET', `/api/s/${id}`)).json() as Promise<ShareRecord>;
  }

  /** Downloads, verifies and unpacks the envelope a record points at. */
  private async fetchEnvelope(record: ShareRecord): Promise<{ envelope: Envelope; verification: PluginVerification }> {
    const response = await shareRequest('GET', `/api/s/${record.id}/content/${record.revision}`);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.byteLength > MAX_SHARE_BYTES || sha256Hex(content) !== record.contentSha256) {
      throw new Error('This share could not be verified. It will not be installed.');
    }
    const envelope = JSON.parse(unpackContent(content)) as Envelope;
    if (
      envelope?.format !== SHARE_ENVELOPE_FORMAT ||
      envelope.version !== SHARE_ENVELOPE_VERSION ||
      !isShareKind(envelope.kind) ||
      !Array.isArray(envelope.plugins) ||
      !envelope.meta
    ) {
      throw new Error('This share uses a format this JNbot version does not support.');
    }
    const { signature, ...unsigned } = envelope;
    const verification = pluginSecurity().verifyValue(unsigned, signature);
    const listing = JSON.parse(record.listing) as ShareListing;
    const consistent =
      envelope.kind === record.kind &&
      signature?.publicKey === record.ownerKey &&
      listing.kind === envelope.kind &&
      listing.minAppVersion === envelope.meta.minAppVersion &&
      canonicalJson(listing.servers) === canonicalJson(envelope.meta.servers ?? []);
    if (verification.status === 'invalid' || !consistent) {
      throw new Error('This share was modified after it was signed. It will not be installed.');
    }
    return { envelope, verification };
  }

  async preview(input: SharePreviewInput | string): Promise<SharePreview> {
    const { preview, fetched } = await this.load(input);
    this.fetched = fetched;
    return preview;
  }

  /** Downloads a share and describes it; background updates use this without touching `fetched`. */
  private async load(input: SharePreviewInput | string): Promise<{ preview: SharePreview; fetched: FetchedShare }> {
    const { link, revision: reviewRevision, profileKey } = typeof input === 'string' ? { link: input } : input;
    const id = parseShareId(String(link ?? ''));
    if (!id) throw new Error('This is not a valid JNbot share link.');
    let record = await this.fetchRecord(id, reviewRevision);
    const { envelope, verification } = await this.fetchEnvelope(record).catch(async (error) => {
      // The cached catalog can point at a revision that was replaced since.
      if ((error as { status?: number }).status !== 404 || record !== this.market?.records.get(id)) throw error;
      this.dropMarket();
      record = await this.fetchRecord(id);
      return this.fetchEnvelope(record);
    });
    const reviewed = isReviewed(record);
    const fetched = { id, revision: record.revision, envelope, verification, listed: record.visibility === 'public' && reviewed };

    const installed = this.file.installed[shareInstallKey(id, envelope.kind, profileKey)];
    const handler = SHARE_KIND_HANDLERS[envelope.kind];
    const { signature } = envelope;
    const listing = JSON.parse(record.listing) as ShareListing;
    const preview: SharePreview = {
      id,
      kind: envelope.kind,
      revision: record.revision,
      meta: envelope.meta,
      publisher: { ...publisherOf(signature.publicKey, signature.publisherName), fingerprint: verification.fingerprint! },
      plugins: handler.preview
        ? handler.preview(envelope, this.ctx, profileKey)
        : this.ctx.macros.previewPortablePlugins(envelope.plugins, pluginOptions()).map(previewRow),
      details: handler.describe?.(envelope) ?? [],
      visibility: record.visibility,
      status: record.status,
      reviewed,
      ...bannerOf(record, listing),
      ...(listing.color ? { color: listing.color } : {}),
      canInstall: canInstallShare(envelope.meta.minAppVersion, this.appVersion),
      ...(reviewRevision ? { reviewing: true } : {}),
      ...(installed
        ? {
            installed: { revision: installed.revision, localRef: installed.localRef },
            ownerChanged: installed.ownerKey !== signature.publicKey,
          }
        : {}),
    };
    return { preview, fetched };
  }

  async install(
    input: ShareInstallInput,
    authorize: (kind: ShareKind) => void = () => {},
  ): Promise<{ localRef: string; state: ShareState }> {
    const fetched =
      this.fetched?.id === input?.id
        ? this.fetched
        : (await this.load({ link: input?.id, profileKey: input?.profileKey })).fetched;
    return this.installFetched(fetched, input, authorize);
  }

  private async installFetched(
    fetched: FetchedShare,
    input: ShareInstallInput,
    authorize: (kind: ShareKind) => void = () => {},
  ): Promise<{ localRef: string; state: ShareState }> {
    const { id, revision, envelope, verification, listed } = fetched;
    const { kind } = envelope;
    authorize(kind);
    const { publicKey, publisherName } = envelope.signature;
    if (pluginSecurity().isOwnPublicKey(publicKey)) {
      throw new Error('You published this, so you already have it.');
    }
    const { minAppVersion, servers: targets } = envelope.meta;
    if (!canInstallShare(minAppVersion, this.appVersion)) {
      throw new Error(`This needs JNbot ${minAppVersion} or newer. Update JNbot to install it.`);
    }
    const profileKey = isProfileShareKind(kind) ? input.profileKey : undefined;
    if (isProfileShareKind(kind) && targets.length && !targets.includes(profileKey ?? '')) {
      throw new Error(`This is made for ${targets.join(', ')}. Switch to that profile to install it.`);
    }
    const key = shareInstallKey(id, kind, profileKey);
    const current = this.file.installed[key];
    const installed = current && this.installExists(current) ? current : undefined;
    // Installing the revision you already have changes nothing (no duplicates).
    if (installed?.revision === revision) return { localRef: installed.localRef, state: this.state() };
    if (installed && installed.ownerKey !== publicKey) {
      throw new Error('This share is now signed by a different publisher, so it cannot update your copy.');
    }
    if (input.trustPublisher && verification.status === 'valid-untrusted') {
      pluginSecurity().trustPublisher(verification);
    }
    const localRef = await SHARE_KIND_HANDLERS[kind].install(
      envelope,
      {
        ...input,
        profileKey,
        decisions: Array.isArray(input.decisions) ? input.decisions : [],
        existingRef: installed?.localRef,
      },
      this.ctx,
    );
    if (this.fetched === fetched) this.fetched = undefined;
    if (!installed) {
      shareRequest('POST', `/api/s/${id}/install`).catch(() => {});
    }
    // One install per local item: a share that replaced it takes it over.
    // Bundles only add to their folder, so several can share one.
    for (const [otherKey, other] of Object.entries(this.file.installed)) {
      if (kind !== 'bundle' && other.kind === kind && other.localRef === localRef && other.profileKey === profileKey) {
        delete this.file.installed[otherKey];
      }
    }
    this.file.installed[key] = {
      id,
      kind,
      localRef,
      ...(profileKey ? { profileKey } : {}),
      revision,
      ownerKey: publicKey,
      ownerName: publisherName,
      latestRevision: revision,
      latestMinAppVersion: minAppVersion,
      listed,
    };
    return { localRef, state: this.persist() };
  }

  /**
   * One batched request for installed and owned shares: update info for
   * installs, review status for the owner. Daily unless forced (when a share
   * page opens), and forced checks are throttled too.
   */
  async checkUpdates(force = false): Promise<ShareState> {
    const installs = Object.values(this.state().installed).map((share) => share.id);
    const ids = [...new Set([...installs, ...Object.keys(this.file.owned)])];
    const since = Date.now() - (this.file.lastUpdateCheck ?? 0);
    const due = since > (force ? FORCED_CHECK_INTERVAL : SHARE_UPDATE_CHECK_INTERVAL);
    if (!ids.length || !due) return this.state();
    this.checking ??= (async () => {
      await this.refresh(ids);
      this.file.lastUpdateCheck = Date.now();
      this.persist();
      await this.autoUpdate();
    })().finally(() => {
      this.checking = undefined;
    });
    await this.checking;
    return this.state();
  }

  /**
   * Update check for the profile behind `profileKey`, the first time it loads
   * after startup. Only marketplace installs update; private links keep the
   * Update button.
   */
  async checkProfile(profileKey: string): Promise<void> {
    if (this.loadedProfiles.has(profileKey)) return;
    this.loadedProfiles.add(profileKey);
    const share = Object.values(this.file.installed).find(
      (item) => item.kind === 'profile' && item.localRef === profileKey,
    );
    if (!share) return;
    // Skip when the startup check just covered it, or the catalog lists it.
    await this.checking;
    if (Date.now() - (this.file.lastUpdateCheck ?? 0) < FORCED_CHECK_INTERVAL) return;
    if (share.listed && (await this.marketplace()).some((entry) => entry.id === share.id)) return;
    await this.checkShare(share.id);
    await this.autoUpdate();
  }

  /** Update check for one install right now, e.g. after its publisher posted a fix. */
  async checkShare(id: string): Promise<ShareState> {
    if (!this.installsOf(id).length) throw new Error('This share is not installed.');
    await this.refresh([id]);
    return this.persist();
  }

  /** Latest revision, listing and review status of these shares, in batched requests. */
  private async refresh(ids: string[]) {
    for (let index = 0; index < ids.length; index += MAX_REVISION_LOOKUP) {
      const body = JSON.stringify({ ids: ids.slice(index, index + MAX_REVISION_LOOKUP) });
      const statuses = (await (await shareRequest('POST', '/api/revisions', { body })).json()) as Record<
        string,
        ShareRevisionStatus | null
      >;
      for (const [id, status] of Object.entries(statuses)) this.applyStatus(id, status);
    }
  }

  private applyStatus(id: string, status: ShareRevisionStatus | null) {
    for (const installed of this.installsOf(id)) {
      installed.latestRevision = status?.revision ?? null;
      installed.listed = !!status?.listed;
      if (status) installed.latestMinAppVersion = status.minAppVersion;
    }
    const owned = this.file.owned[id];
    if (!owned) return;
    if (!status) {
      // Deleted on the server (e.g. taken down): forget it.
      delete this.file.owned[id];
      return;
    }
    Object.assign(owned, {
      visibility: status.visibility,
      status: status.status,
      note: status.note,
      pending: status.pending,
    });
  }

  /**
   * Installs updates of marketplace items, whose revisions an official key
   * approved. Private links, updates that would replace a plugin that did not
   * come from this publisher, and chains or triggers with a plugin update (which
   * is your call) keep the Update button.
   */
  private autoUpdate(): Promise<void> {
    this.updating ??= this.installUpdates().finally(() => {
      this.updating = undefined;
    });
    return this.updating;
  }

  private async installUpdates() {
    if (this.ctx.settings.sharedAppSettings.autoUpdateShares === false) return;
    const due = Object.values(this.file.installed).filter(
      (share) => share.listed && shareUpdateAvailable(share, this.appVersion),
    );
    for (const share of due) {
      try {
        const { preview, fetched } = await this.load({ link: share.id, profileKey: share.profileKey });
        const safe = preview.plugins.every(
          (plugin) =>
            plugin.state !== 'unsupported' &&
            plugin.state !== 'update' &&
            plugin.verification !== 'invalid' &&
            (plugin.state !== 'conflict' ||
              pluginSecurity().getProvenance(plugin.pluginId)?.importSource?.ownerId === plugin.ownerId),
        );
        if (!preview.reviewed || previewBlocked(preview) || !safe) continue;
        await this.installFetched(fetched, {
          id: share.id,
          profileKey: share.profileKey,
          decisions: preview.plugins.map(({ ownerId, pluginId, revision }) => ({
            ownerId,
            pluginId,
            revision,
            action: 'replace',
            acceptUnverified: true,
          })),
        });
      } catch (error) {
        console.warn(`Auto-update of share ${share.id} failed`, error);
      }
    }
  }

  /**
   * The catalog lists the approved revision of every public share, so it
   * doubles as an update check for the installs it lists.
   */
  private applyMarket(entries: MarketEntry[]) {
    let changed = false;
    for (const entry of entries) {
      for (const installed of this.installsOf(entry.id)) {
        if (installed.listed && installed.latestRevision === entry.revision) continue;
        Object.assign(installed, {
          latestRevision: entry.revision,
          latestMinAppVersion: entry.listing.minAppVersion,
          listed: true,
        });
        changed = true;
      }
    }
    if (!changed) return;
    this.persist();
    this.autoUpdate().catch(() => {});
  }

  private dropMarket() {
    this.market = undefined;
  }

  /** Catalog of the records with a valid official approval. */
  private toMarket(etag: string, records: ShareRecord[], fetchedAt: number): MarketCache {
    const reviewed = records.filter(isReviewed);
    return {
      etag,
      entries: reviewed.map((record) => this.toEntry(record)),
      records: new Map(reviewed.map((record) => [record.id, record])),
      fetchedAt,
    };
  }

  /** The catalog an earlier run saved; always revalidated before use. */
  private storedMarket(): MarketCache | undefined {
    const { origin, etag, records } = this.marketStore.get();
    if (!etag || !Array.isArray(records) || origin !== shareOrigin()) return undefined;
    return this.toMarket(etag, records, 0);
  }

  private toEntry(record: ShareRecord): MarketEntry {
    const listing = JSON.parse(record.listing) as ShareListing;
    return {
      id: record.id,
      kind: record.kind,
      revision: record.revision,
      listing,
      publisher: publisherOf(record.ownerKey, record.ownerName),
      ...bannerOf(record, listing),
      canInstall: canInstallShare(listing.minAppVersion, this.appVersion),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * The marketplace catalog: one request, revalidated with an ETag at most
   * every few minutes (also after a restart, from the copy on disk), dropped
   * from memory when nobody looks at it. Entries
   * without a valid official approval are left out.
   */
  async marketplace(force = false): Promise<MarketEntry[]> {
    clearTimeout(this.marketTimer);
    this.marketTimer = setTimeout(() => this.dropMarket(), MARKET_IDLE_TIMEOUT);
    this.marketTimer.unref?.();
    const cached = this.market ?? this.storedMarket();
    if (cached && !force && Date.now() - cached.fetchedAt < MARKET_REFRESH_INTERVAL) return cached.entries;
    const response = await shareRequest('GET', '/api/market', {
      headers: cached ? { 'if-none-match': cached.etag } : {},
    });
    if (response.status === 304 && cached) {
      cached.fetchedAt = Date.now();
      this.market = cached;
      this.applyMarket(cached.entries);
      return cached.entries;
    }
    const { entries } = (await response.json()) as { entries: ShareRecord[] };
    const etag = response.headers.get('etag') ?? '';
    this.marketStore.storage = { origin: shareOrigin(), etag, records: entries };
    this.marketStore.save();
    this.market = this.toMarket(etag, entries, Date.now());
    this.applyMarket(this.market.entries);
    return this.market.entries;
  }

  /**
   * Links local copies of official profiles to their marketplace share:
   * servers from the old JNdata list (no profile yet) and local profiles
   * without a share link that use an official profile's server id. Installing
   * replaces them under the same id, so settings, alts and stats keep working.
   * Profiles you published yourself stay your editable source. Legacy servers
   * without an (installable) official share yet are retried on the next start;
   * local profiles are compared once, so later starts make no request.
   */
  async adoptOfficialProfiles(): Promise<void> {
    const published = new Set(
      Object.values(this.file.owned).flatMap((share) => (share.kind === 'profile' ? [share.ref] : [])),
    );
    const checked = new Set(this.file.adoptChecked);
    const legacy = this.ctx.settings.legacyServers;
    const local = this.ctx.settings.profiles.list
      .filter((p) => !p.share && !published.has(p.id) && !checked.has(p.id))
      .map((p) => p.id);
    const pending = new Set([...legacy, ...local]);
    if (!pending.size) return;
    const failed = new Set<string>();
    for (const entry of await this.marketplace()) {
      const serverId = entry.listing.serverId;
      if (entry.kind !== 'profile' || !entry.publisher.official || !serverId || !pending.has(serverId)) continue;
      if (!entry.canInstall) continue;
      try {
        await this.install({ id: entry.id, decisions: [] });
        pending.delete(serverId);
      } catch (error) {
        failed.add(serverId);
        console.warn(`Could not link profile ${serverId} to the marketplace`, error);
      }
    }
    this.ctx.settings.setLegacyServers(legacy.filter((id) => pending.has(id)));
    this.file.adoptChecked = [...checked, ...local.filter((id) => !failed.has(id))];
    this.store.save();
  }

  private assertReviewer() {
    if (!pluginSecurity().isReviewer()) throw new Error('Only JNbot reviewers can do this.');
  }

  /** Pending submissions and reported shares (reviewers only). */
  async reviewQueue(): Promise<MarketEntry[]> {
    this.assertReviewer();
    const { entries } = (await (await shareRequest('GET', '/api/review', { signed: true })).json()) as {
      entries: ShareRecord[];
    };
    this.reviewRecords = new Map(entries.map((record) => [record.id, record]));
    return entries.map((record) => ({
      ...this.toEntry(record),
      status: record.status,
      reports: record.reports,
      reportReasons: record.reportReasons,
    }));
  }

  /** Approve (signing the exact revision), reject with a note, or dismiss reports. */
  async review(input: ShareReviewInput): Promise<MarketEntry[]> {
    this.assertReviewer();
    const record = this.reviewRecords.get(input?.id);
    if (!record || record.revision !== input.revision) throw new Error('Reload the review queue and try again.');
    const approval =
      input.decision === 'approve'
        ? pluginSecurity().signMessage(
            approvalMessage(record.id, record.revision, sha256Hex(record.listing), record.contentSha256),
          ).signature
        : undefined;
    await shareRequest('POST', `/api/s/${record.id}/review`, {
      body: JSON.stringify({ revision: record.revision, decision: input.decision, note: input.note, approval }),
      signed: true,
    });
    this.dropMarket();
    return this.reviewQueue();
  }
}
