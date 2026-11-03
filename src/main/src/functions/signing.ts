import crypto from 'crypto';
import fs from './storage/portableFs';
import path from 'path';
import { app } from 'electron';
import { portablePath } from './storage/portablePaths';
import { portableFileChanged } from './storage/PortableWrites';
import type { MacroCode, MacroInfo } from '../types';
import type { PluginSignatureV2 } from '../../../common/pluginSignatures';

export type { PluginSignatureV2 } from '../../../common/pluginSignatures';

export const PLUGIN_BUNDLE_FORMAT = 'jnbot-plugin' as const;
export const PLUGIN_BUNDLE_VERSION = 2 as const;
export const MAX_PLUGIN_BUNDLE_BYTES = 5 * 1024 * 1024; // 5 mb
export const OFFICIAL_ED25519_PUBLIC_KEYS: readonly string[] = [
  'MCowBQYDK2VwAyEAHpiP3IOzZr3aDZi2-e5t8bwO6KrWuZUHyyqla6Y3XHA',
] as const;

const OFFICIAL_KEY_FILE = 'plugins.ed25519.private.pem';

export interface PluginBundleV2 {
  format: typeof PLUGIN_BUNDLE_FORMAT;
  version: typeof PLUGIN_BUNDLE_VERSION;
  info: MacroInfo;
  code: MacroCode;
  signature?: PluginSignatureV2;
}

export type PluginVerificationStatus =
  | 'trusted'
  | 'valid-untrusted'
  | 'unsigned'
  | 'invalid'
  | 'unsupported';

export interface PluginVerification {
  status: PluginVerificationStatus;
  info?: MacroInfo;
  code?: MacroCode;
  fingerprint?: string;
  publisherName?: string;
  signature?: PluginSignatureV2;
  reason?: string;
}

export interface PluginProvenance {
  status: 'local' | 'trusted' | 'accepted-once' | 'unsigned' | 'modified';
  fingerprint?: string;
  publisherName?: string;
  signature?: PluginSignatureV2;
  contentDigest: string;
  installedAt: number;
  importSource?: {
    ownerId: string;
    pluginId: string;
    revision: string;
    importedAt: number;
  };
  ai?: {
    sourceHash: string;
    clientId: string;
    networkAllowed: boolean;
    firstRunApprovedHash?: string;
  };
}

interface PublisherIdentityFile {
  version: 1;
  name?: string;
  publicKey: string;
  privateKey: string;
}

export interface TrustedPublisher {
  fingerprint: string;
  publicKey: string;
  localLabel: string;
  firstSeenName: string;
  trustedAt: number;
  builtIn: boolean;
}

function jsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, jsonValue(record[key])]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

/** Stable JSON for the JSON-compatible values used in plugin bundles. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(jsonValue(value));
}

function signaturePayload(
  info: MacroInfo,
  code: MacroCode,
  signature: Omit<PluginSignatureV2, 'value'>,
) {
  return {
    format: PLUGIN_BUNDLE_FORMAT,
    version: PLUGIN_BUNDLE_VERSION,
    info,
    code,
    signature,
  };
}

function sha256Base64Url(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

export function publisherFingerprint(publicKeyBase64Url: string): string {
  return sha256Base64Url(Buffer.from(publicKeyBase64Url, 'base64url'));
}

export function formatFingerprint(fingerprint: string): string {
  return fingerprint.match(/.{1,4}/g)?.join(' ') ?? fingerprint;
}

/** Strip local state that must neither leak into nor affect a signed package. */
export function exportablePluginInfo(info: MacroInfo): MacroInfo {
  const {
    trust: _trust,
    security: _security,
    downloads: _downloads,
    ...portable
  } = info;
  return {
    ...portable,
    public: false,
    editedAt: null,
  };
}

export function pluginContentDigest(info: MacroInfo, code: MacroCode): string {
  return sha256Base64Url(
    canonicalJson({ info: exportablePluginInfo(info), code }),
  );
}

interface RawPluginBundle {
  info: MacroInfo;
  code: MacroCode;
  format?: unknown;
  version?: unknown;
  signature?: unknown;
}

function isMacroPayload(value: {
  info?: unknown;
  code?: unknown;
}): value is RawPluginBundle {
  const { info, code } = value;
  return !!(
    info &&
    typeof info === 'object' &&
    typeof (info as MacroInfo).pluginId === 'string' &&
    (info as MacroInfo).pluginId.length <= 200 &&
    typeof (info as MacroInfo).name === 'string' &&
    (info as MacroInfo).name.length <= 500 &&
    code &&
    typeof code === 'object'
  );
}

function isSignatureV2(value: unknown): value is PluginSignatureV2 {
  if (!value || typeof value !== 'object') return false;
  const v = value as PluginSignatureV2;
  return (
    v.algorithm === 'ed25519' &&
    typeof v.publicKey === 'string' &&
    v.publicKey.length < 500 &&
    typeof v.publisherName === 'string' &&
    v.publisherName.trim().length > 0 &&
    v.publisherName.length <= 100 &&
    typeof v.signedAt === 'string' &&
    !Number.isNaN(Date.parse(v.signedAt)) &&
    typeof v.value === 'string' &&
    v.value.length < 500
  );
}

export class PluginSecurityStore {
  readonly directory: string;

  private readonly identityPath: string;

  private readonly trustPath: string;

  private readonly provenancePath: string;

  private readonly officialPublicKeys: readonly string[];

  /** Where a maintainer install keeps the official private key (never in the app bundle). */
  private readonly officialKeyPaths: readonly string[];

  private officialKey?: { publicKey: string; privateKey: string } | null;

  constructor(
    directory?: string,
    officialPublicKeys?: readonly string[],
    officialKeyPaths?: readonly string[],
  ) {
    this.directory =
      directory ?? path.join(app.getPath('userData'), 'plugin-security');
    this.officialPublicKeys =
      officialPublicKeys ?? OFFICIAL_ED25519_PUBLIC_KEYS;
    this.officialKeyPaths =
      officialKeyPaths ?? (directory ? [] : [path.join(app.getPath('userData'), 'keys', OFFICIAL_KEY_FILE)]);
    this.identityPath = path.join(this.directory, 'publisher-identity.json');
    this.trustPath = path.join(this.directory, 'trusted-publishers.json');
    this.provenancePath = directory
      ? path.join(directory, 'provenance.json')
      : portablePath('plugin-security', 'provenance.json');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(this.provenancePath), { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.directory, 0o700);
    } catch {
      // Windows relies on the user's AppData ACLs.
    }
  }

  private static readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private static writeJson(file: string, value: unknown): void {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, file);
    portableFileChanged(file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows relies on the user's AppData ACLs.
    }
  }

  /** The official key pair when this install holds it (maintainer machine). */
  private readOfficialKey(): { publicKey: string; privateKey: string } | null {
    if (this.officialKey !== undefined) return this.officialKey;
    this.officialKey = null;
    for (const file of this.officialKeyPaths) {
      try {
        const privateKey = fs.readFileSync(file, 'utf8');
        const publicKey = crypto
          .createPublicKey(privateKey)
          .export({ type: 'spki', format: 'der' })
          .toString('base64url');
        if (this.officialPublicKeys.includes(publicKey)) {
          this.officialKey = { publicKey, privateKey };
          break;
        }
      } catch {
        // Not a maintainer install.
      }
    }
    return this.officialKey;
  }

  /** Holds an official key, so it publishes as JNbot and can review marketplace submissions. */
  isReviewer(): boolean {
    return !!this.readOfficialKey();
  }

  private readIdentity(): PublisherIdentityFile | null {
    const stored = PluginSecurityStore.readJson<PublisherIdentityFile | null>(
      this.identityPath,
      null,
    );
    const official = this.readOfficialKey();
    // Maintainer installs sign everything with the official key.
    const identity = official
      ? { version: 1 as const, name: stored?.name ?? 'JNbot', ...official }
      : stored;
    if (!identity) return null;
    try {
      const derived = crypto
        .createPublicKey(identity.privateKey)
        .export({ type: 'spki', format: 'der' })
        .toString('base64url');
      if (identity.version !== 1 || derived !== identity.publicKey) {
        throw new Error('Publisher key mismatch');
      }
      return identity;
    } catch {
      throw new Error(
        'The publisher signing identity is invalid. Plugin export was cancelled.',
      );
    }
  }

  private createIdentity(name: string): PublisherIdentityFile {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const created: PublisherIdentityFile = {
      version: 1,
      name,
      publicKey: publicKey
        .export({ type: 'spki', format: 'der' })
        .toString('base64url'),
      privateKey: privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    };
    PluginSecurityStore.writeJson(this.identityPath, created);
    return created;
  }

  getIdentitySummary(): {
    configured: boolean;
    name?: string;
    fingerprint?: string;
  } {
    const identity = this.readIdentity();
    if (!identity) return { configured: false };
    return {
      configured: !!identity.name,
      name: identity.name,
      fingerprint: publisherFingerprint(identity.publicKey),
    };
  }

  setPublisherName(
    name: string,
  ): ReturnType<PluginSecurityStore['getIdentitySummary']> {
    const trimmed = name.trim();
    const hasControlCharacter = [...trimmed].some(
      (character) => character.charCodeAt(0) < 32,
    );
    if (!trimmed || trimmed.length > 100 || hasControlCharacter) {
      throw new Error('Publisher name must be between 1 and 100 characters.');
    }
    // The stored file, never the official key, so the name change cannot copy it.
    const identity =
      PluginSecurityStore.readJson<PublisherIdentityFile | null>(this.identityPath, null) ??
      this.createIdentity(trimmed);
    if (identity.name !== trimmed) {
      PluginSecurityStore.writeJson(this.identityPath, {
        ...identity,
        name: trimmed,
      });
    }
    return this.getIdentitySummary();
  }

  private namedIdentity(): PublisherIdentityFile & { name: string } {
    const identity = this.readIdentity();
    if (!identity?.name) throw new Error('PUBLISHER_NAME_REQUIRED');
    return identity as PublisherIdentityFile & { name: string };
  }

  /** Sign `payload(unsignedSignature)` with this installation's publisher key. */
  private signWith(
    payload: (signature: Omit<PluginSignatureV2, 'value'>) => unknown,
  ): PluginSignatureV2 {
    const identity = this.namedIdentity();
    const unsigned: Omit<PluginSignatureV2, 'value'> = {
      algorithm: 'ed25519',
      publicKey: identity.publicKey,
      publisherName: identity.name,
      signedAt: new Date().toISOString(),
    };
    const bytes = Buffer.from(canonicalJson(payload(unsigned)));
    return {
      ...unsigned,
      value: crypto.sign(null, bytes, identity.privateKey).toString('base64url'),
    };
  }

  sign(info: MacroInfo, code: MacroCode): PluginBundleV2 {
    const portableInfo = exportablePluginInfo(info);
    return {
      format: PLUGIN_BUNDLE_FORMAT,
      version: PLUGIN_BUNDLE_VERSION,
      info: portableInfo,
      code,
      signature: this.signWith((unsigned) =>
        signaturePayload(portableInfo, code, unsigned),
      ),
    };
  }

  /** Sign any JSON object; the signature covers `{...value, signature}` minus its value. */
  signValue(value: object): PluginSignatureV2 {
    return this.signWith((signature) => ({ ...value, signature }));
  }

  /** Verify a {@link signValue} signature. */
  verifyValue(value: object, signature: unknown): PluginVerification {
    if (!isSignatureV2(signature)) {
      return { status: 'invalid', reason: 'Signature block is malformed' };
    }
    try {
      const key = crypto.createPublicKey({
        key: Buffer.from(signature.publicKey, 'base64url'),
        type: 'spki',
        format: 'der',
      });
      const { value: signatureValue, ...unsigned } = signature;
      const valid =
        key.asymmetricKeyType === 'ed25519' &&
        crypto.verify(
          null,
          Buffer.from(canonicalJson({ ...value, signature: unsigned })),
          key,
          Buffer.from(signatureValue, 'base64url'),
        );
      if (!valid) return { status: 'invalid', reason: 'Contents do not match the signature' };
      const fingerprint = publisherFingerprint(signature.publicKey);
      return {
        status: this.isPublisherTrusted(fingerprint, signature.publicKey)
          ? 'trusted'
          : 'valid-untrusted',
        fingerprint,
        publisherName: signature.publisherName,
        signature,
      };
    } catch {
      return { status: 'invalid', reason: 'Public key or signature is invalid' };
    }
  }

  /** Sign a raw message (share-service requests) with the publisher key. */
  signMessage(message: string): { publicKey: string; signature: string } {
    const identity = this.namedIdentity();
    return {
      publicKey: identity.publicKey,
      signature: crypto
        .sign(null, Buffer.from(message), identity.privateKey)
        .toString('base64url'),
    };
  }

  isOwnPublicKey(publicKey: string): boolean {
    return this.readIdentity()?.publicKey === publicKey;
  }

  isOfficialPublicKey(publicKey: string): boolean {
    return this.officialPublicKeys.includes(publicKey);
  }

  /** Verify a raw-message signature made by an official key. */
  verifyOfficialMessage(message: string, signature: string): boolean {
    return this.officialPublicKeys.some((publicKey) => {
      try {
        const key = crypto.createPublicKey({
          key: Buffer.from(publicKey, 'base64url'),
          type: 'spki',
          format: 'der',
        });
        return crypto.verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64url'));
      } catch {
        return false;
      }
    });
  }

  /**
   * Keep the original publisher signature when it still verifies against the
   * exact portable content. Any changed, unsigned, or stale content is signed
   * by this installation instead.
   */
  bundleForExport(
    info: MacroInfo,
    code: MacroCode,
    options: { allowUnsigned?: boolean } = {},
  ): PluginBundleV2 {
    const portableInfo = exportablePluginInfo(info);
    const provenance = this.getProvenance(info.pluginId);
    if (
      provenance?.signature &&
      provenance.contentDigest === pluginContentDigest(portableInfo, code)
    ) {
      const verification = this.verify({
        format: PLUGIN_BUNDLE_FORMAT,
        version: PLUGIN_BUNDLE_VERSION,
        info: portableInfo,
        code,
        signature: provenance.signature,
      });
      if (
        verification.status === 'trusted' ||
        verification.status === 'valid-untrusted'
      ) {
        return {
          format: PLUGIN_BUNDLE_FORMAT,
          version: PLUGIN_BUNDLE_VERSION,
          info: portableInfo,
          code,
          signature: verification.signature!,
        };
      }
    }
    try {
      return this.sign(portableInfo, code);
    } catch (error) {
      if (
        options.allowUnsigned &&
        error instanceof Error &&
        error.message === 'PUBLISHER_NAME_REQUIRED'
      ) {
        return {
          format: PLUGIN_BUNDLE_FORMAT,
          version: PLUGIN_BUNDLE_VERSION,
          info: portableInfo,
          code,
        };
      }
      throw error;
    }
  }

  verify(raw: unknown): PluginVerification {
    if (!raw || typeof raw !== 'object') {
      return { status: 'unsupported', reason: 'Invalid plugin package' };
    }
    const bundle = raw as Record<string, unknown>;
    if (!isMacroPayload(bundle)) {
      return {
        status: 'unsupported',
        reason: 'Plugin info or code is invalid',
      };
    }
    const { info, code } = bundle;

    if (
      bundle.format === PLUGIN_BUNDLE_FORMAT &&
      bundle.version === PLUGIN_BUNDLE_VERSION
    ) {
      if (!isSignatureV2(bundle.signature)) {
        return {
          status: 'invalid',
          info,
          code,
          reason: 'Signature block is malformed',
        };
      }
      const { signature } = bundle;
      try {
        const keyDer = Buffer.from(signature.publicKey, 'base64url');
        const key = crypto.createPublicKey({
          key: keyDer,
          type: 'spki',
          format: 'der',
        });
        if (key.asymmetricKeyType !== 'ed25519')
          throw new Error('Not an Ed25519 key');
        const { value, ...unsigned } = signature;
        const bytes = Buffer.from(
          canonicalJson(signaturePayload(info, code, unsigned)),
        );
        const valid = crypto.verify(
          null,
          bytes,
          key,
          Buffer.from(value, 'base64url'),
        );
        if (!valid) {
          return {
            status: 'invalid',
            info,
            code,
            reason: 'Plugin contents do not match the signature',
          };
        }
        const fingerprint = publisherFingerprint(signature.publicKey);
        return {
          status: this.isPublisherTrusted(fingerprint, signature.publicKey)
            ? 'trusted'
            : 'valid-untrusted',
          info,
          code,
          fingerprint,
          publisherName: signature.publisherName,
          signature,
        };
      } catch {
        return {
          status: 'invalid',
          info,
          code,
          reason: 'Public key or signature is invalid',
        };
      }
    }

    if (bundle.format !== undefined || bundle.version !== undefined) {
      return {
        status: 'unsupported',
        info,
        code,
        reason: 'Unsupported plugin package version',
      };
    }
    if (bundle.signature !== undefined) {
      return {
        status: 'unsupported',
        info,
        code,
        reason: 'Unsupported plugin signature format',
      };
    }
    return { status: 'unsigned', info, code };
  }

  trustPublisher(verification: PluginVerification): void {
    if (
      verification.status !== 'valid-untrusted' ||
      !verification.fingerprint ||
      !verification.publisherName ||
      !verification.signature
    ) {
      throw new Error('A valid publisher signature is required');
    }
    const trusted = PluginSecurityStore.readJson<
      Record<string, Omit<TrustedPublisher, 'builtIn'>>
    >(this.trustPath, {});
    trusted[verification.fingerprint] = {
      fingerprint: verification.fingerprint,
      publicKey: verification.signature.publicKey,
      localLabel: verification.publisherName,
      firstSeenName: verification.publisherName,
      trustedAt: Date.now(),
    };
    PluginSecurityStore.writeJson(this.trustPath, trusted);
  }

  listTrustedPublishers(): TrustedPublisher[] {
    const builtIn = this.officialPublicKeys.map(
      (publicKey) =>
        ({
          fingerprint: publisherFingerprint(publicKey),
          publicKey,
          localLabel: 'JNbot Official',
          firstSeenName: 'JNbot Official',
          trustedAt: 0,
          builtIn: true,
        }) satisfies TrustedPublisher,
    );
    const userAdded = Object.values(
      PluginSecurityStore.readJson<
        Record<string, Omit<TrustedPublisher, 'builtIn'>>
      >(this.trustPath, {}),
    ).map((publisher) => ({ ...publisher, builtIn: false }));
    return [...builtIn, ...userAdded].sort((a, b) =>
      a.localLabel.localeCompare(b.localLabel),
    );
  }

  removeTrustedPublisher(fingerprint: string): void {
    if (
      this.officialPublicKeys.some(
        (publicKey) => publisherFingerprint(publicKey) === fingerprint,
      )
    )
      return;
    const trusted = PluginSecurityStore.readJson<
      Record<string, Omit<TrustedPublisher, 'builtIn'>>
    >(this.trustPath, {});
    if (!trusted[fingerprint]) return;
    delete trusted[fingerprint];
    PluginSecurityStore.writeJson(this.trustPath, trusted);
  }

  isPublisherTrusted(fingerprint: string, publicKey: string): boolean {
    if (this.officialPublicKeys.includes(publicKey)) return true;
    const own = PluginSecurityStore.readJson<PublisherIdentityFile | null>(
      this.identityPath,
      null,
    );
    if (own?.publicKey === publicKey) return true;
    const publisher = PluginSecurityStore.readJson<
      Record<string, Omit<TrustedPublisher, 'builtIn'>>
    >(this.trustPath, {})[fingerprint];
    return !!publisher && publisher.publicKey === publicKey;
  }

  getProvenance(pluginId: string): PluginProvenance | undefined {
    const provenance = PluginSecurityStore.readJson<Record<string, PluginProvenance>>(
      this.provenancePath,
      {},
    )[pluginId];
    if (
      provenance?.status === 'trusted' &&
      (!provenance.fingerprint ||
        !provenance.signature ||
        !this.isPublisherTrusted(
          provenance.fingerprint,
          provenance.signature.publicKey,
        ))
    ) {
      return { ...provenance, status: 'accepted-once' };
    }
    return provenance;
  }

  setProvenance(pluginId: string, provenance: PluginProvenance): void {
    const all = PluginSecurityStore.readJson<Record<string, PluginProvenance>>(
      this.provenancePath,
      {},
    );
    all[pluginId] = provenance;
    PluginSecurityStore.writeJson(this.provenancePath, all);
  }

  markModified(pluginId: string, info: MacroInfo, code: MacroCode): void {
    const current = this.getProvenance(pluginId);
    if (!current || current.status === 'local') return;
    const contentDigest = pluginContentDigest(info, code);
    if (contentDigest === current.contentDigest) return;
    this.setProvenance(pluginId, {
      ...current,
      status: 'modified',
      signature: undefined,
      contentDigest,
    });
  }

  deleteProvenance(pluginId: string): void {
    const all = PluginSecurityStore.readJson<Record<string, PluginProvenance>>(
      this.provenancePath,
      {},
    );
    if (!all[pluginId]) return;
    delete all[pluginId];
    PluginSecurityStore.writeJson(this.provenancePath, all);
  }
}

let singleton: PluginSecurityStore | undefined;
export function pluginSecurity(): PluginSecurityStore {
  singleton ??= new PluginSecurityStore();
  return singleton;
}
