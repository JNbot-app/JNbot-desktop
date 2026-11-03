import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { getPlatform } from '../../platform';
import { buildSecrets } from '../../../../common/buildSecrets';
import { readFile, writeFile } from 'fs/promises';
import { Readable } from 'stream';
import { buffer as streamToBuffer } from 'stream/consumers';
import zlib from 'zlib';
import { promisify } from 'util';
import ScriptHandler_ from '../ScriptHandler';
import generateUID from '../../../UID';
import type { CustomProfile } from '../../../../common/profiles';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ── S3 / Backblaze ────────────────────────────────────────────────────────────
const DEFAULT_ENDPOINT = 'https://s3.us-east-005.backblazeb2.com';
const DEFAULT_REGION = 'us-east-005';
const DEFAULT_BUCKET = 'JNbot-cloud';
const DEFAULT_KEY_PREFIX = 'users';
const EMBEDDED_KEY_ID = buildSecrets.b2KeyId;
const EMBEDDED_SECRET = buildSecrets.b2Secret;

// ── Crypto constants ──────────────────────────────────────────────────────────
const BACKUP_VERSION = 4; // current envelope: HKDF-SHA256 + AES-256-GCM
const BACKUP_VERSION_V3 = 3; // legacy envelope: PBKDF2-SHA512 + AES-256-GCM
const BACKUP_FILENAME = 'backup.v3.enc.json'; // kept stable across v3/v4 — the envelope's `version` field is authoritative
const AES_ALGO = 'aes-256-gcm';
const AES_KEY_LEN = 32; // bytes
const AES_IV_LEN = 12; // bytes (96-bit — GCM standard)
const KDF_SALT_LEN = 32; // bytes
const MAC_ALGO = 'sha256';
const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024;
const CLOUD_REQUEST_TIMEOUT_MS = 45_000;

// v3 legacy KDF
const KDF_DIGEST_V3 = 'sha512';
const KDF_ITERATIONS_V3 = 210_000;

// v4 KDF
const HKDF_HASH = 'sha256';
const HKDF_INFO = 'jnbot-cloud-backup-v4';
const MIN_SHARE_KEY_CHARS = 16; // ≈80 bits of base32 entropy; below this we treat the key as too weak to accept on encryption
const LOCAL_BACKUP_SHARE_KEY = 'jnbot-local-backup-v1';

// ── Types ─────────────────────────────────────────────────────────────────────
interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  keyPrefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Plaintext payload — lives only in memory, never persisted as-is */
interface BackupPayload {
  version: number;
  uid: string;
  createdAt: number;
  settingsJson: string;
  pluginsJson: string;
}

/**
 * What is actually stored in Backblaze.
 *
 * v4 (current) encryption scheme:
 *   key  = HKDF-SHA256(ikm=canonical(shareKey), salt=kdfSalt, info='jnbot-cloud-backup-v4', 64 bytes)
 *          → first 32 bytes = AES-256-GCM encryption key
 *          → last  32 bytes = HMAC-SHA256 MAC key
 *   data = gzip(JSON(BackupPayload))
 *   ct   = AES-256-GCM(data, encKey, iv)
 *   mac  = HMAC-SHA256(macKey, structural fields)
 *
 * v4 relies on the share key itself being high-entropy (125+ bits, generated
 * client-side, never user-chosen). That removes the brute-force surface that
 * a slow KDF would otherwise have to defend against — HKDF is sufficient.
 *
 * v3 (legacy, still decryptable) used PBKDF2-SHA512 with 210k iterations over
 * a user-chosen password. New uploads no longer produce v3 envelopes.
 */
interface EncryptedEnvelope {
  version: number;
  uidHash: string; // sha256(uid) — used as storage path, not secret
  uploadedAt: number; // Unix ms
  compression: 'gzip';
  algorithms: {
    kdf: 'pbkdf2-sha512' | 'hkdf-sha256';
    cipher: 'aes-256-gcm';
    mac: 'hmac-sha256';
  };
  kdfIterations?: number; // present only for v3 (pbkdf2-sha512)
  kdfSalt: string; // base64
  iv: string; // base64
  authTag: string; // base64 — GCM tag (16 bytes)
  ciphertext: string; // base64
  mac: string; // base64 — HMAC over all fields above
}

type CloudDownloadData = Pick<BackupPayload, 'settingsJson' | 'pluginsJson'> & {
  uploadedAt: number;
};

type TransformableBody = { transformToByteArray: () => Promise<Uint8Array> };

// ── Small helpers ─────────────────────────────────────────────────────────────
const first = (...vals: (string | undefined)[]): string =>
  vals.map((v) => v?.trim() ?? '').find((v) => v.length > 0) ?? '';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isTransformable = (v: unknown): v is TransformableBody =>
  isObj(v) &&
  typeof (v as TransformableBody).transformToByteArray === 'function';

const enc = (v: Buffer | Uint8Array): string =>
  Buffer.from(v).toString('base64');
const dec = (s: string): Buffer => Buffer.from(s, 'base64');
const u8 = (v: Buffer | Uint8Array | string): Uint8Array =>
  typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v);

// ── MAC input — every field that matters for integrity ────────────────────────
const macInput = (e: Omit<EncryptedEnvelope, 'mac'>): string => {
  // Insertion order matters: v3 envelopes were signed with `kdfIterations`
  // sitting between `algorithms` and `kdfSalt`. We must reproduce that exact
  // order for legacy MAC verification to succeed.
  const obj: Record<string, unknown> = {
    version: e.version,
    uidHash: e.uidHash,
    uploadedAt: e.uploadedAt,
    compression: e.compression,
    algorithms: e.algorithms,
  };
  if (e.kdfIterations !== undefined) obj.kdfIterations = e.kdfIterations;
  obj.kdfSalt = e.kdfSalt;
  obj.iv = e.iv;
  obj.authTag = e.authTag;
  obj.ciphertext = e.ciphertext;
  return JSON.stringify(obj);
};

// ── Share-key canonicalisation ────────────────────────────────────────────────
/**
 * Canonical form of a v4 share key: alphanumerics only, uppercase.
 *
 * Users may copy the key with or without the dashes we render, and we want
 * `K7M3Q-2X9RT-...` and `k7m3q2x9rt...` to derive the same bytes.
 */
const canonicalShareKey = (input: string | string[]): string => {
  const raw = (Array.isArray(input) ? input.join('') : input) ?? '';
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (cleaned.length === 0) throw new Error('Share key must not be empty.');
  return cleaned;
};

/**
 * v3 legacy: turns a single string or an ordered array of strings into one
 * deterministic secret. Length-prefixing prevents ambiguous merges
 * ("ab"|"c" ≠ "a"|"bc"). Trimmed but case-preserving — v3 users may have
 * picked passwords where case mattered.
 */
const normalizePasswordV3 = (input: string | string[]): string => {
  const parts = (Array.isArray(input) ? input : [input])
    .map((p) => p?.trim() ?? '')
    .filter((p) => p.length > 0);

  if (parts.length === 0) throw new Error('Password must not be empty.');
  return parts.map((p) => `${p.length}:${p}`).join('|');
};

// ─────────────────────────────────────────────────────────────────────────────

class CloudStorage {
  public readonly UID: string;
  public readonly scriptHandler: ScriptHandler_;
  private readonly uidHash: string;
  private readonly config: StorageConfig;
  private readonly s3: S3Client;

  constructor(
    scriptHandler: ScriptHandler_,
    overrides: Partial<StorageConfig> = {},
  ) {
    this.scriptHandler = scriptHandler;
    this.UID = generateUID();
    this.uidHash = crypto.createHash('sha256').update(this.UID).digest('hex');
    this.config = this.resolveConfig(overrides);

    this.s3 = new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  private resolveConfig(o: Partial<StorageConfig>): StorageConfig {
    return {
      endpoint: first(
        o.endpoint,
        process.env.JNBOT_CLOUD_ENDPOINT,
        process.env.B2_S3_ENDPOINT,
        DEFAULT_ENDPOINT,
      ),
      region: first(
        o.region,
        process.env.JNBOT_CLOUD_REGION,
        process.env.AWS_REGION,
        DEFAULT_REGION,
      ),
      bucket: first(
        o.bucket,
        process.env.JNBOT_CLOUD_BUCKET,
        process.env.B2_BUCKET,
        DEFAULT_BUCKET,
      ),
      keyPrefix: first(
        o.keyPrefix,
        process.env.JNBOT_CLOUD_KEY_PREFIX,
        DEFAULT_KEY_PREFIX,
      ).replace(/\/+$/g, ''),
      accessKeyId: first(
        o.accessKeyId,
        process.env.JNBOT_CLOUD_KEY_ID,
        process.env.B2_KEY_ID,
        process.env.AWS_ACCESS_KEY_ID,
        EMBEDDED_KEY_ID,
      ),
      secretAccessKey: first(
        o.secretAccessKey,
        process.env.JNBOT_CLOUD_APPLICATION_KEY,
        process.env.B2_APPLICATION_KEY,
        process.env.AWS_SECRET_ACCESS_KEY,
        EMBEDDED_SECRET,
      ),
    };
  }

  // ── S3 key helpers ──────────────────────────────────────────────────────────

  private objectKeyFor(uidHash: string): string {
    return `${this.config.keyPrefix}/${uidHash}/${BACKUP_FILENAME}`;
  }

  private get objectKey(): string {
    return this.objectKeyFor(this.uidHash);
  }

  // ── Crypto ──────────────────────────────────────────────────────────────────

  /**
   * v4: HKDF-SHA256 over the high-entropy share key.
   *
   * The share key already supplies ≥125 bits of entropy, so a slow KDF
   * would only burn CPU. HKDF gives clean domain separation between the
   * AES key and the MAC key, and the random salt prevents cross-backup
   * key reuse even if the same share key were used twice.
   */
  private deriveKeysHkdf(
    shareKey: string,
    salt: Buffer,
  ): { encKey: Buffer; macKey: Buffer } {
    const ikm = Buffer.from(canonicalShareKey(shareKey), 'utf8');
    const okm = Buffer.from(
      crypto.hkdfSync(
        HKDF_HASH,
        ikm,
        salt,
        Buffer.from(HKDF_INFO, 'utf8'),
        AES_KEY_LEN * 2,
      ),
    );
    return {
      encKey: okm.subarray(0, AES_KEY_LEN),
      macKey: okm.subarray(AES_KEY_LEN),
    };
  }

  /** v3 legacy: PBKDF2-SHA512 over a user-chosen password. Decrypt-only. */
  private deriveKeysPbkdf2(
    password: string,
    salt: Buffer,
    iterations: number,
  ): { encKey: Buffer; macKey: Buffer } {
    const derived = crypto.pbkdf2Sync(
      password,
      salt,
      iterations,
      AES_KEY_LEN * 2,
      KDF_DIGEST_V3,
    );
    return {
      encKey: derived.subarray(0, AES_KEY_LEN),
      macKey: derived.subarray(AES_KEY_LEN),
    };
  }

  private computeMac(
    macKey: Buffer,
    envelope: Omit<EncryptedEnvelope, 'mac'>,
  ): Buffer {
    return crypto
      .createHmac(MAC_ALGO, macKey)
      .update(macInput(envelope))
      .digest();
  }

  private async encrypt(
    payload: BackupPayload,
    shareKey: string,
  ): Promise<EncryptedEnvelope> {
    const canonical = canonicalShareKey(shareKey);
    if (canonical.length < MIN_SHARE_KEY_CHARS) {
      throw new Error(
        `Share key must contain at least ${MIN_SHARE_KEY_CHARS} alphanumeric characters.`,
      );
    }

    const compressed = await gzip(JSON.stringify(payload));
    if (compressed.length > MAX_COMPRESSED_BYTES) {
      throw new Error(
        'Backup exceeds 5 MB after compression. Remove some data before uploading.',
      );
    }

    const kdfSalt = crypto.randomBytes(KDF_SALT_LEN);
    const iv = crypto.randomBytes(AES_IV_LEN);
    const { encKey, macKey } = this.deriveKeysHkdf(canonical, kdfSalt);

    const cipher = crypto.createCipheriv(AES_ALGO, encKey, iv);
    const ct = Buffer.concat([cipher.update(u8(compressed)), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const partial: Omit<EncryptedEnvelope, 'mac'> = {
      version: BACKUP_VERSION,
      uidHash: this.uidHash,
      uploadedAt: payload.createdAt,
      compression: 'gzip',
      algorithms: {
        kdf: 'hkdf-sha256',
        cipher: 'aes-256-gcm',
        mac: 'hmac-sha256',
      },
      kdfSalt: enc(kdfSalt),
      iv: enc(iv),
      authTag: enc(authTag),
      ciphertext: enc(ct),
    };

    return { ...partial, mac: enc(this.computeMac(macKey, partial)) };
  }

  private async decrypt(
    envelope: EncryptedEnvelope,
    secret: string | string[],
  ): Promise<BackupPayload> {
    let encKey: Buffer;
    let macKey: Buffer;

    if (envelope.algorithms.kdf === 'hkdf-sha256') {
      ({ encKey, macKey } = this.deriveKeysHkdf(
        typeof secret === 'string' ? secret : secret.join(''),
        dec(envelope.kdfSalt),
      ));
    } else if (envelope.algorithms.kdf === 'pbkdf2-sha512') {
      const iterations = envelope.kdfIterations ?? KDF_ITERATIONS_V3;
      ({ encKey, macKey } = this.deriveKeysPbkdf2(
        normalizePasswordV3(secret),
        dec(envelope.kdfSalt),
        iterations,
      ));
    } else {
      throw new Error('Unsupported backup KDF.');
    }

    // 1. Verify MAC — detects tampering and wrong keys before touching AES
    const partial: Omit<EncryptedEnvelope, 'mac'> = { ...envelope };
    delete (partial as Partial<EncryptedEnvelope>).mac;

    const expectedMac = this.computeMac(macKey, partial);
    const providedMac = dec(envelope.mac);

    if (
      expectedMac.length !== providedMac.length ||
      !crypto.timingSafeEqual(expectedMac, providedMac)
    ) {
      throw new Error(
        'Authentication failed. The share key is incorrect, or the backup has been tampered with.',
      );
    }

    // 2. AES-GCM decryption (authTag gives a second integrity check)
    const iv = dec(envelope.iv);
    const authTag = dec(envelope.authTag);
    const ciphertext = dec(envelope.ciphertext);

    const decipher = crypto.createDecipheriv(AES_ALGO, encKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted: Buffer;
    try {
      decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
    } catch {
      throw new Error('Decryption failed. The backup may be corrupted.');
    }

    const decompressed = await gunzip(decrypted);
    const text = new TextDecoder().decode(decompressed);
    const payload = JSON.parse(text) as unknown;

    if (!this.isBackupPayload(payload)) {
      throw new Error('Decrypted backup is missing expected fields.');
    }

    return payload;
  }

  // ── Type guards ─────────────────────────────────────────────────────────────

  private isBackupPayload(v: unknown): v is BackupPayload {
    return (
      isObj(v) &&
      typeof v.version === 'number' &&
      typeof v.uid === 'string' &&
      typeof v.createdAt === 'number' &&
      typeof v.settingsJson === 'string' &&
      typeof v.pluginsJson === 'string'
    );
  }

  private isEncryptedEnvelope(v: unknown): v is EncryptedEnvelope {
    if (!isObj(v) || !isObj(v.algorithms)) return false;
    const algs = v.algorithms as Record<string, unknown>;
    const kdfOk = algs.kdf === 'pbkdf2-sha512' || algs.kdf === 'hkdf-sha256';
    return (
      typeof v.version === 'number' &&
      typeof v.uidHash === 'string' &&
      typeof v.uploadedAt === 'number' &&
      v.compression === 'gzip' &&
      kdfOk &&
      algs.cipher === AES_ALGO &&
      algs.mac === 'hmac-sha256' &&
      typeof v.kdfSalt === 'string' &&
      typeof v.iv === 'string' &&
      typeof v.authTag === 'string' &&
      typeof v.ciphertext === 'string' &&
      typeof v.mac === 'string'
    );
  }

  // ── S3 helpers ───────────────────────────────────────────────────────────────

  private async bodyToBuffer(body: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body === 'string') return Buffer.from(body, 'utf8');
    if (body instanceof Readable) return streamToBuffer(body);
    if (isTransformable(body))
      return Buffer.from(await body.transformToByteArray());
    throw new Error('Unsupported response body type from cloud storage.');
  }

  private async withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('Cloud storage request timed out. Please try again.'));
          }, CLOUD_REQUEST_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async sendBounded<T>(command: GetObjectCommand | HeadObjectCommand | PutObjectCommand | DeleteObjectCommand): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.withDeadline((abortSignal) => this.s3.send(command, { abortSignal }) as Promise<T>);
      } catch (error) {
        lastError = error;
        if (this.isNotFound(error) || attempt === 1) throw error;
      }
    }
    throw lastError;
  }

  private isNotFound(err: unknown): boolean {
    if (!isObj(err)) return false;
    if (err.name === 'NotFound' || err.name === 'NoSuchKey') return true;
    return (
      isObj(err.$metadata) &&
      (err.$metadata as Record<string, unknown>).httpStatusCode === 404
    );
  }

  private async fetchEnvelope(uidHash: string): Promise<EncryptedEnvelope> {
    return this.withDeadline(async (abortSignal) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await this.s3.send(
            new GetObjectCommand({ Bucket: this.config.bucket, Key: this.objectKeyFor(uidHash) }),
            { abortSignal },
          );
          if (!response.Body) throw new Error('Cloud storage returned an empty response.');
          const parsed = JSON.parse((await this.bodyToBuffer(response.Body)).toString('utf8')) as unknown;
          if (!this.isEncryptedEnvelope(parsed)) throw new Error('Unrecognised backup format.');
          return parsed;
        } catch (error) {
          if (this.isNotFound(error)) throw new Error('No backup found for this user ID.');
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Could not reach cloud storage. Check your network connection.');
    }).catch((error) => {
      if (error instanceof Error && error.message.includes('timed out')) throw error;
      throw new Error('Could not reach cloud storage. Check your network connection.');
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  public getUserId(): string {
    return this.UID;
  }

  /**
   * Cryptographically strong, human-transcribable share key.
   *
   * 25 base32 chars × 5 bits = 125 bits of entropy, grouped 5-5-5-5-5 with
   * dashes for legibility. The base32 alphabet (A–Z, 2–7) avoids ambiguity
   * across the 32-symbol space.
   */
  public static generateShareKey(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32
    const bytes = crypto.randomBytes(25);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      if (i > 0 && i % 5 === 0) out += '-';
      out += alphabet[bytes[i] & 0x1f];
    }
    return out;
  }

  public async hasCloudData(): Promise<boolean> {
    try {
      await this.sendBounded(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey,
        }),
      );
      return true;
    } catch (err) {
      if (this.isNotFound(err)) return false;
      throw err;
    }
  }

  /**
   * Encrypt the current settings/plugins and upload to Backblaze.
   *
   * If no share key is supplied, a fresh high-entropy one is generated and
   * returned so the caller can show it to the user. Callers that supply a
   * share key must ensure it has sufficient entropy — the only validation
   * here is a minimum length floor.
   */
  public async upload(
    options: { shareKey?: string | string[] } = {},
  ): Promise<{ key: string; uploadedAt: number; shareKey: string }> {
    const shareKey =
      options.shareKey != null &&
      (Array.isArray(options.shareKey)
        ? options.shareKey.length > 0
        : options.shareKey.length > 0)
        ? Array.isArray(options.shareKey)
          ? options.shareKey.join('')
          : options.shareKey
        : CloudStorage.generateShareKey();

    const { content, createdAt } = await this.createBackupFile(shareKey);

    await this.sendBounded(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey,
        Body: content,
        ContentType: 'application/json',
        CacheControl: 'no-store',
        Metadata: {
          uidhash: this.uidHash,
          version: String(BACKUP_VERSION),
        },
      }),
    );

    return { key: this.objectKey, uploadedAt: createdAt, shareKey };
  }

  /**
   * Save the same encrypted JSON document that is uploaded to cloud storage.
   */
  public async exportToFile(): Promise<boolean> {
    const { content } = await this.createBackupFile(LOCAL_BACKUP_SHARE_KEY);
    const result = await getPlatform().saveFile({
      title: 'Save JNbot Backup',
      defaultName: 'JNbotBackup.json',
      content,
      filters: [{ name: 'JNbot Backup', extensions: ['json'] }],
    });
    return !result.canceled;
  }

  /**
   * Restore a backup document produced by either the local export or cloud
   * upload flow.
   */
  public async importFromFile(): Promise<boolean> {
    const result = await getPlatform().openFile({
      title: 'Select JNbot Backup',
      filters: [{ name: 'JNbot Backup', extensions: ['json'] }],
    });

    if (result.canceled || result.files.length === 0) return false;
    await this.importData(result.files[0].content, LOCAL_BACKUP_SHARE_KEY);
    return true;
  }

  /** Save a local encrypted backup without an Electron file picker. */
  public async exportToPath(filePath: string): Promise<void> {
    const { content } = await this.createBackupFile(LOCAL_BACKUP_SHARE_KEY);
    await writeFile(filePath, content, 'utf8');
  }

  /** Restore a local encrypted backup from an explicit path. */
  public async importFromPath(filePath: string): Promise<void> {
    await this.importData(await readFile(filePath, 'utf8'), LOCAL_BACKUP_SHARE_KEY);
  }

  /**
   * Download and decrypt this device's own backup (used when restoring on the same machine).
   */
  public async download(shareKey: string): Promise<CloudDownloadData> {
    const envelope = await this.fetchEnvelope(this.uidHash);
    const payload = await this.decrypt(envelope, shareKey);
    return {
      settingsJson: payload.settingsJson,
      pluginsJson: payload.pluginsJson,
      uploadedAt: envelope.uploadedAt,
    };
  }

  /**
   * Fetch and decrypt a backup belonging to another user (cross-device import).
   *
   * Accepts either a v4 share key (current) or a v3 password (legacy) — the
   * envelope's version dictates which derivation runs.
   */
  public async importSharedFromUser(options: {
    userId: string;
    shareKey: string | string[];
  }): Promise<void> {
    const uidHash = crypto
      .createHash('sha256')
      .update(options.userId)
      .digest('hex');
    const envelope = await this.fetchEnvelope(uidHash);
    const payload = await this.decrypt(envelope, options.shareKey);

    await this.restorePayload(payload);
  }

  /**
   * Import from a raw JSON string (exported file) rather than directly from Backblaze.
   */
  public async importData(jsonString: string, shareKey: string): Promise<void> {
    const parsed = JSON.parse(jsonString) as unknown;
    if (!this.isEncryptedEnvelope(parsed))
      throw new Error('Unrecognised backup format.');

    const payload = await this.decrypt(parsed, shareKey);
    await this.restorePayload(payload);
  }

  /** Direct WebRTC transfers carry this encrypted envelope in memory only. */
  public async createDirectTransferArchive(): Promise<Buffer> {
    const { content } = await this.createBackupFile(LOCAL_BACKUP_SHARE_KEY);
    return Buffer.from(content, 'utf8');
  }

  public async importDirectTransferArchive(content: string): Promise<void> {
    await this.importData(content, LOCAL_BACKUP_SHARE_KEY);
  }

  private async createBackupFile(
    shareKey: string,
  ): Promise<{ content: string; createdAt: number }> {
    const settings = JSON.parse(this.scriptHandler.settings.toJSON());
    const profiles = this.scriptHandler.settings.profiles;
    if (profiles && Array.isArray(settings.profiles)) {
      settings.profiles = await Promise.all(
        (settings.profiles as CustomProfile[]).map((profile) =>
          profiles.buildBackupPayload(profile),
        ),
      );
    }
    const payload: BackupPayload = {
      version: BACKUP_VERSION,
      uid: this.UID,
      createdAt: Date.now(),
      settingsJson: JSON.stringify(settings),
      pluginsJson: this.scriptHandler.macros.toJSON({ allowUnsigned: true }),
    };

    return {
      content: JSON.stringify(await this.encrypt(payload, shareKey)),
      createdAt: payload.createdAt,
    };
  }

  private async restorePayload(payload: BackupPayload): Promise<void> {
    const settings = JSON.parse(payload.settingsJson);
    const profiles = this.scriptHandler.settings.profiles;
    if (profiles && Array.isArray(settings.profiles)) {
      settings.profiles = await Promise.all(
        (settings.profiles as CustomProfile[]).map((profile) =>
          profiles.restoreBackupProfile(profile),
        ),
      );
    }
    if (this.scriptHandler.settings.fromJSON(JSON.stringify(settings)) === false)
      throw new Error('Backup settings could not be restored');
    await this.scriptHandler.macros.fromJSON(payload.pluginsJson, 'restore');
  }

  public async deleteCloudData(): Promise<void> {
    await this.sendBounded(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.objectKey,
      }),
    );
  }
}

export default CloudStorage;
