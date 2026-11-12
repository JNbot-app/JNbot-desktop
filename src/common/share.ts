/**
 * Shares: contract shared by the desktop app, the mobile app and the
 * `cloud/share` Worker. Keep this file free of runtime imports so the Worker
 * can bundle it.
 *
 * A share is a private link or a public marketplace entry. Both work the same
 * way; public shares only get listed once the maintainer approved the exact
 * revision (signed with an official key, so the Worker cannot fake it).
 */
import type { PluginSignatureV2 } from './pluginSignatures';

export const SHARE_ORIGIN = 'https://share.jnbot.workers.dev';
export const SHARE_ENVELOPE_FORMAT = 'jnbot-share' as const;
export const SHARE_ENVELOPE_VERSION = 2 as const;
/** Gzipped envelope; D1 holds at most ~2 MB per value. */
export const MAX_SHARE_BYTES = 1024 * 1024;
/** Unpacked envelope cap, so a tiny gzip cannot expand into a huge one. */
export const MAX_UNPACKED_SHARE_BYTES = 8 * 1024 * 1024;
export const MAX_BANNER_BYTES = 256 * 1024;
export const MAX_BANNER_URL_LENGTH = 500;
export const MAX_LISTING_BYTES = 16 * 1024;
export const MAX_SHARE_TITLE_LENGTH = 100;
export const MAX_SHARE_DESCRIPTION_LENGTH = 2000;
export const MAX_DETAIL_TITLE_LENGTH = 200;
export const MAX_DETAIL_VALUE_LENGTH = 500;
export const MAX_SHARES_PER_OWNER = 50;
export const MAX_PENDING_PER_OWNER = 5;
/** Private (link) shares; public ones are bounded by review instead. */
export const MAX_LINK_SHARES_PER_OWNER = 10;
export const MAX_SHARE_ITEMS = 200;
export const MAX_SHARE_SERVERS = 20;
export const MAX_REVISION_LOOKUP = 200;
export const SHARE_UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000;
/** The marketplace catalog is refetched (with an ETag) at most this often. */
export const MARKET_REFRESH_INTERVAL = 10 * 60 * 1000;
/** Signed requests older/newer than this are rejected. */
export const SHARE_REQUEST_MAX_SKEW = 5 * 60 * 1000;

export const SHARE_KINDS = [
  'plugin',
  'bundle',
  'profile',
  'chain',
  'trigger',
] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** Kinds that install into one profile; they are tracked per profile. */
const PROFILE_SHARE_KINDS: readonly ShareKind[] = ['chain', 'trigger'];

export const isProfileShareKind = (kind: ShareKind) => PROFILE_SHARE_KINDS.includes(kind);

/** Key of an install in {@link ShareState.installed}: chains and triggers are installed per profile. */
export const shareInstallKey = (id: string, kind: ShareKind, profileKey?: string | null): string =>
  isProfileShareKind(kind) ? `${id}@${profileKey ?? ''}` : id;

export const SHARE_KIND_LABELS: Record<ShareKind, string> = {
  plugin: 'Plugin',
  bundle: 'Plugin bundle',
  profile: 'Profile',
  chain: 'Chain',
  trigger: 'Trigger',
};

/** Section name and what a kind is, for people new to JNbot. */
export const SHARE_KIND_INFO: Record<ShareKind, { plural: string; blurb: string }> = {
  plugin: {
    plural: 'Plugins',
    blurb: 'Scripts that give your bots new tasks.',
  },
  bundle: {
    plural: 'Bundles',
    blurb: 'Several plugins shared together as one install.',
  },
  profile: {
    plural: 'Profiles',
    blurb: 'Server setups with their plugins and settings ready to go.',
  },
  chain: {
    plural: 'Chains',
    blurb: 'Plugins that run one after another on your alts.',
  },
  trigger: {
    plural: 'Triggers',
    blurb: 'Rules that react to game events for you.',
  },
};

const detailRows = (details: readonly ShareDetailSection[]) => details.flatMap((section) => section.rows);

/** Steps of a chain listing: `{ name, text }` from its "Step n" rows. */
export const chainSteps = (details: readonly ShareDetailSection[]) =>
  detailRows(details)
    .filter((row) => /^Step \d+$/.test(row.label))
    .map((row) => {
      const split = row.value.indexOf(': ');
      return split < 0
        ? { name: row.value, text: '' }
        : { name: row.value.slice(0, split), text: row.value.slice(split + 2) };
    });

/** Value of the first detail row with this label. */
export const detailValue = (details: readonly ShareDetailSection[], label: string) =>
  detailRows(details).find((row) => row.label === label)?.value;

const plural = (count: number, word: string) => (count ? `${count} ${word}${count === 1 ? '' : 's'}` : '');

/** One short line of what is inside, for cards: "3 plugins", "When: Chat message", ... */
export function shareSummary(listing: Pick<ShareListing, 'kind' | 'items' | 'details'>): string {
  switch (listing.kind) {
    case 'plugin':
      return listing.items[0]?.type ?? '';
    case 'bundle':
      return plural(listing.items.length, 'plugin');
    case 'profile':
      return plural(listing.items.length, 'script');
    case 'chain':
      return plural(chainSteps(listing.details).length, 'step');
    case 'trigger': {
      const when = detailValue(listing.details, 'When')?.split(' — ')[0];
      return listing.details.length > 1 ? plural(listing.details.length, 'rule') : when ? `When: ${when}` : '';
    }
  }
}

/** `link`: anyone with the link. `public`: listed on the marketplace after review. */
export type ShareVisibility = 'link' | 'public';
/** Review state of the latest revision of a public share. */
export type ShareStatus = 'none' | 'pending' | 'live' | 'rejected';
export type ShareReviewDecision = 'approve' | 'reject' | 'dismiss-reports';

export const BANNER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export interface ShareItemSummary {
  name: string;
  /** Plugin script type, trigger event, ... */
  type?: string;
  description?: string;
}

/** A labelled block of what a share does, e.g. a trigger's event and actions. */
export interface ShareDetailSection {
  title: string;
  rows: Array<{ label: string; value: string }>;
  /** Code that runs when it is used (e.g. a chain's setup code), to review before installing. */
  code?: string;
}

export interface ShareMeta {
  title: string;
  description: string;
  createdAt: string;
  /** What the landing page and the review panel list as contents. */
  items: ShareItemSummary[];
  /** Fields removed before sharing (webhooks, alts, ...), shown to the receiver. */
  stripped?: string[];
  /** App version it was published from; older apps cannot install it. */
  minAppVersion: string;
  /** Official server ids it is meant for; empty means every profile. */
  servers: string[];
}

export interface ShareEnvelope<Payload = unknown, Plugin = unknown> {
  format: typeof SHARE_ENVELOPE_FORMAT;
  version: typeof SHARE_ENVELOPE_VERSION;
  kind: ShareKind;
  meta: ShareMeta;
  payload: Payload;
  /** Signed plugin packages the payload needs (`PortablePluginPackage`). */
  plugins: Plugin[];
  signature: PluginSignatureV2;
}

/**
 * Uncompressed preview stored next to the gzipped envelope, so lists and
 * landing pages never download the content. Display only: the app checks it
 * against the signed envelope before installing.
 */
export interface ShareListing {
  kind: ShareKind;
  title: string;
  description: string;
  items: ShareItemSummary[];
  stripped?: string[];
  details: ShareDetailSection[];
  minAppVersion: string;
  servers: string[];
  publisherName: string;
  /** Accent colour (hex) for the banner fallback. */
  color?: string;
  /** Banner image URL, linked when the banner is not hosted with the share. */
  bannerUrl?: string;
  /** Server id an official profile share installs as. */
  serverId?: string;
}

/** A share as the Worker serves it (one row + the revision it serves). */
export interface ShareRecord {
  id: string;
  kind: ShareKind;
  ownerKey: string;
  ownerName: string;
  visibility: ShareVisibility;
  status: ShareStatus;
  note: string | null;
  revision: string;
  /** Raw listing JSON; approvals sign its exact bytes. */
  listing: string;
  contentSha256: string;
  /** Official key signature over {@link approvalMessage}; null when not reviewed. */
  approval: string | null;
  hasBanner: boolean;
  size: number;
  createdAt: number;
  updatedAt: number;
  /** Review queue only. */
  reports?: number;
  reportReasons?: string[];
}

/** Batched status of a share, for update checks and the owner's list. */
export interface ShareRevisionStatus {
  /** Revision a download gets (approved one for listed shares). */
  revision: string;
  minAppVersion: string;
  status: ShareStatus;
  visibility: ShareVisibility;
  note: string | null;
  /** A newer revision waits for review. */
  pending: boolean;
  /** Shown on the marketplace (an approved revision is live). */
  listed: boolean;
}

export interface SharePublisher {
  name: string;
  fingerprint: string;
  /** Official, own key, or accepted earlier by the user. */
  trusted: boolean;
  own: boolean;
  official: boolean;
}

/** A marketplace card, verified and parsed by the desktop backend. */
export interface MarketEntry {
  id: string;
  kind: ShareKind;
  revision: string;
  listing: ShareListing;
  publisher: SharePublisher;
  bannerUrl?: string;
  canInstall: boolean;
  createdAt: number;
  updatedAt: number;
  /** Review queue only. */
  status?: ShareStatus;
  reports?: number;
  reportReasons?: string[];
}

/** One plugin (or profile script) inside a share, as shown before installing. */
export interface SharePluginPreview {
  ownerId: string;
  pluginId: string;
  revision: string;
  name: string;
  description?: string;
  scriptType?: string;
  /** `update`: a chain or trigger carries a newer version of a plugin from the same publisher. */
  state: 'new' | 'identical' | 'conflict' | 'update' | 'unsupported' | 'invalid';
  verification: 'trusted' | 'valid-untrusted' | 'unsigned' | 'invalid';
  publisherName?: string;
  fingerprint?: string;
  reason?: string;
  /** Source shown by "View code". */
  code: string;
}

export interface SharePreview {
  id: string;
  kind: ShareKind;
  revision: string;
  meta: ShareMeta;
  publisher: SharePublisher;
  plugins: SharePluginPreview[];
  /** Exactly what gets added besides the plugins (trigger rules, chain steps, ...). */
  details: ShareDetailSection[];
  visibility: ShareVisibility;
  status: ShareStatus;
  /** This revision was approved by the JNbot team. */
  reviewed: boolean;
  bannerUrl?: string;
  color?: string;
  /** False when this app is older than `meta.minAppVersion`. */
  canInstall: boolean;
  /** Previewing a pending revision from the review queue. */
  reviewing?: boolean;
  /** Set when this share was installed before (update flow). */
  installed?: { revision: string; localRef: string };
  /** The share is now signed by a different key than the installed copy. */
  ownerChanged?: boolean;
}

export interface SharePreviewInput {
  link: string;
  /** Reviewers preview a specific (pending) revision. */
  revision?: string;
  /** Profile a chain or trigger would be installed into. */
  profileKey?: string;
}

export type SharePluginAction = 'replace' | 'skip';

/** What happens to a plugin unless the user chooses: only plugin updates stay opt-in. */
export const defaultPluginAction = (plugin: Pick<SharePluginPreview, 'state'>): SharePluginAction =>
  plugin.state === 'update' ? 'skip' : 'replace';

export interface ShareInstallInput {
  id: string;
  decisions: Array<{
    ownerId: string;
    pluginId: string;
    revision: string;
    action: SharePluginAction;
    acceptUnverified: boolean;
  }>;
  trustPublisher?: boolean;
  /** Target profile for chains and triggers. */
  profileKey?: string;
}

export interface ShareCreateInput {
  kind: ShareKind;
  /** Plugin id, folder name, profile key, chain id or trigger id. */
  ref: string;
  /** Profile that owns the chain / trigger. */
  profileKey?: string;
  visibility?: ShareVisibility;
  servers?: string[];
}

export interface ShareVisibilityInput {
  id: string;
  visibility: ShareVisibility;
  servers?: string[];
}

export interface ShareReviewInput {
  id: string;
  revision: string;
  decision: ShareReviewDecision;
  note?: string;
}

export interface OwnedShare {
  id: string;
  kind: ShareKind;
  ref: string;
  profileKey?: string;
  title: string;
  revision: string;
  /** Content digest of the published version, to detect unpublished edits. */
  digest: string;
  updatedAt: number;
  visibility: ShareVisibility;
  servers: string[];
  status: ShareStatus;
  note?: string | null;
  /** An update waits for review while the approved version stays live. */
  pending?: boolean;
}

export interface InstalledShare {
  id: string;
  kind: ShareKind;
  localRef: string;
  /** Profile a chain or trigger was installed into. */
  profileKey?: string;
  revision: string;
  ownerKey: string;
  ownerName: string;
  /** From the last update check; null means the share was deleted. */
  latestRevision?: string | null;
  latestMinAppVersion?: string;
  /** Listed on the marketplace (approved by an official key), so updates install automatically. */
  listed?: boolean;
}

export interface ShareState {
  owned: Record<string, OwnedShare>;
  /** By {@link shareInstallKey}. */
  installed: Record<string, InstalledShare>;
  appVersion: string;
  /** This install holds an official key and can review submissions. */
  reviewer: boolean;
}

export const SHARE_ID_PATTERN = /^[A-Za-z0-9]{10}$/;
export const SHARE_REVISION_PATTERN = /^[a-f0-9]{16}$/;
export const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
export const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

export function isShareKind(value: unknown): value is ShareKind {
  return SHARE_KINDS.includes(value as ShareKind);
}

/** Numeric `major.minor.patch` compare; anything after `-` is ignored. */
export function compareAppVersion(a: string, b: string): number {
  const parts = (value: string) => value.split('-')[0].split('.').map((part) => Number(part) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

export const canInstallShare = (minAppVersion: string | undefined, appVersion: string): boolean =>
  !minAppVersion || compareAppVersion(appVersion, minAppVersion) >= 0;

export const shareUpdateAvailable = (share: InstalledShare, appVersion: string): boolean =>
  !!share.latestRevision &&
  share.latestRevision !== share.revision &&
  canInstallShare(share.latestMinAppVersion, appVersion);

export type ShareInstallState = 'none' | 'installed' | 'update' | 'own';

/** Whether a share is yours, installed here, and whether `revision` would update it. */
export const shareInstallState = (
  install: InstalledShare | undefined,
  revision: string,
  minAppVersion: string,
  appVersion: string,
  own: boolean,
): ShareInstallState =>
  own
    ? 'own'
    : !install
    ? 'none'
    : shareUpdateAvailable({ ...install, latestRevision: revision, latestMinAppVersion: minAppVersion }, appVersion)
      ? 'update'
      : 'installed';

/** What the detail view shows; built from a catalog entry (no download) or a preview. */
export interface ShareOverview
  extends Pick<ShareListing, 'kind' | 'title' | 'description' | 'items' | 'details' | 'servers' | 'stripped' | 'minAppVersion' | 'color'> {
  id: string;
  revision: string;
  publisher: SharePublisher;
  bannerUrl?: string;
  canInstall: boolean;
}

export const entryOverview = ({ id, revision, listing, publisher, bannerUrl, canInstall }: MarketEntry): ShareOverview => ({
  ...listing,
  id,
  revision,
  publisher,
  bannerUrl,
  canInstall,
});

export const previewOverview = (preview: SharePreview): ShareOverview => ({
  ...preview.meta,
  kind: preview.kind,
  details: preview.details,
  color: preview.color,
  id: preview.id,
  revision: preview.revision,
  publisher: preview.publisher,
  bannerUrl: preview.bannerUrl,
  canInstall: preview.canInstall,
});

/** A preview that cannot be installed as is. */
export const previewBlocked = (preview: SharePreview): boolean =>
  !preview.canInstall ||
  !!preview.ownerChanged ||
  (preview.kind === 'profile' && preview.plugins.some((plugin) => plugin.state === 'invalid'));

/** Installing needs a look first: new publisher, unsigned code, plugins you already have or plugin updates. */
export const previewNeedsCheck = (preview: SharePreview): boolean =>
  previewBlocked(preview) ||
  (!preview.publisher.trusted && preview.plugins.length > 0) ||
  preview.plugins.some(
    (plugin) =>
      plugin.state === 'conflict' ||
      plugin.state === 'update' ||
      plugin.state === 'unsupported' ||
      plugin.verification === 'unsigned' ||
      plugin.verification === 'invalid',
  );

export type ShareStatusTone = 'default' | 'processing' | 'success' | 'warning' | 'error';

/** Label and tone of a share's visibility and review state, for the owner. */
export function shareStatusLabel(
  share: Pick<OwnedShare, 'visibility' | 'status' | 'pending'>,
): { tone: ShareStatusTone; label: string } {
  if (share.visibility === 'link') return { tone: 'default', label: 'Private link' };
  switch (share.status) {
    case 'live':
      return { tone: 'success', label: 'On marketplace' };
    case 'rejected':
      return share.pending ? { tone: 'warning', label: 'Update rejected' } : { tone: 'error', label: 'Rejected' };
    default:
      return { tone: 'processing', label: share.pending ? 'Update in review' : 'Pending review' };
  }
}

/** Whether a share meant for `servers` shows up while `serverId` is active. */
export const shareMatchesServer = (servers: readonly string[], serverId: string | null | undefined): boolean =>
  !servers.length || (!!serverId && servers.includes(serverId));

/** PNG, JPEG, WebP or GIF by magic bytes; never SVG. */
export function sniffImageType(bytes: Uint8Array): (typeof BANNER_TYPES)[number] | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

export function shareUrl(id: string, origin = SHARE_ORIGIN): string {
  return `${origin}/s/${id}`;
}

export function shareBannerUrl(id: string, revision: string, origin = SHARE_ORIGIN): string {
  return `${origin}/api/s/${id}/banner/${revision}`;
}

export function shareDeepLink(id: string): string {
  return `jnbot://share/${id}`;
}

/** Share id from a web link, a `jnbot://share/<id>` link or a bare id. */
export function parseShareId(value: string): string | null {
  const trimmed = value.trim();
  const id =
    /^jnbot:\/\/share\/([A-Za-z0-9]+)\/?$/.exec(trimmed)?.[1] ??
    /^https?:\/\/[^/]+\/s\/([A-Za-z0-9]+)\/?$/.exec(trimmed)?.[1] ??
    trimmed;
  return SHARE_ID_PATTERN.test(id) ? id : null;
}

/** The message a publisher key signs to create, update or delete a share. */
export function shareRequestMessage(
  method: string,
  path: string,
  timestamp: number,
  nonce: string,
  bodySha256Hex: string,
): string {
  return [method.toUpperCase(), path, timestamp, nonce, bodySha256Hex].join(
    '\n',
  );
}

/** The message an official key signs to approve one exact revision. */
export function approvalMessage(
  id: string,
  revision: string,
  listingSha256Hex: string,
  contentSha256Hex: string,
): string {
  return ['jnbot-approval', id, revision, listingSha256Hex, contentSha256Hex].join('\n');
}
