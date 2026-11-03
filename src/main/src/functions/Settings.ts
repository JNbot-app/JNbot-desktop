import {
  ActiveProfileObj,
  Alt,
  AltWithData,
  AppSettings,
  Device,
  JNdata,
  Origin,
  PluginData,
  ScriptSettingsSection,
  ServerAltInfo,
  SettingsObj,
  SettingsPatch,
  SharedSettings,
  SharedSettingsUpdate,
  Stats,
} from '../types';
import { ipcMain, IpcMainEvent } from 'electron';
import path from 'path';
import clone from 'just-clone';
import Statistics from './Stats';
import StorageModule from './storage/Storage';
import crypto from 'crypto';
import zlib from 'zlib';
import fs from './storage/portableFs';
import { promisify } from 'util';
import EventEmitter from 'node:events';
import {
  MinecraftLauncherTypes,
  Themes,
} from '../../../common/CommonEnums';
import { STATIC_JNDATA } from '../../../common/jndata';
import { getServerMeta } from '../../../common/serverInfo';
import { migrateLegacySettings } from './storage/migrateSettings';
import Profiles_ from './Profiles';
import { CustomProfile, mergeProfilesIntoJNdata } from '../../../common/profiles';
import {
  isProfileSpecificSetting,
  mergeProfileAppSettings,
  splitAppSettings,
} from '../../../common/appSettingsSchema';
import { normalizeProxyConfig } from '../../../common/proxyConfig';
import { normalizePermissions } from '../../../common/clientPermissions';
import { removeMinecraftAuth } from './minecraft/MinecraftAccountService';
import { devicePath, portablePath, portableRoot } from './storage/portablePaths';
import { migrateLauncherOptions } from './storage/migrateLauncherOptions';
import { migrateLegacyTriggers } from '../../../common/triggers';

const gunzip = promisify(zlib.gunzip);
const algorithm = 'aes-128-cbc';
const password =
  '4c51eced0b4607612a58d1599219fe30dcec64fd43cde1062ccd6889b2b2dc60';


const ALT_PREMIUM_MIGRATION_VERSION = 3;
const SETTINGS_VERSION = 3;
const SHARED_VERSION = 3;

interface StoredAppSettings extends AppSettings {
  lastProfile?: string;
  profileOverrides?: Record<string, Partial<AppSettings>>;
}

interface LegacyProfileSettings extends SettingsObj {
  appSettings?: Partial<AppSettings>;
}

class Settings_ extends EventEmitter {
  public static get appData(): string {
    return portableRoot();
  }
  public static get legacySettingsPath(): string {
    return portablePath('settings.json');
  }
  public static get appSettingsPath(): string {
    return portablePath('appSettings');
  }
  public static get sharedPath(): string {
    return portablePath('shared.json');
  }
  public static get serverDir(): string {
    return portablePath('serverSettings');
  }

  appSettingsStorage: StorageModule<StoredAppSettings>;
  sharedStorage: StorageModule<SharedSettings>;
  launcherStorage: StorageModule<NonNullable<SharedSettings['launcherOptions']>>;
  /** Concurrently-open per-profile stores. */
  private readonly profileStorages = new Map<
    string,
    StorageModule<SettingsObj>
  >();
  private closed = false;
  /** User-defined server profiles (custom servers). */
  profiles: Profiles_;

  /** Static Minecraft versions merged with the installed profiles. */
  public JNdata!: JNdata;
  /** Startup fallback only; never changed by a client selecting a profile. */
  public bootstrapProfileKey: string;
  stats: Statistics;

  constructor() {
    super();

    // 1. Migrate legacy monolithic settings.json (no-op if already split).
    const hasMigrated = migrateLegacySettings({
      legacyPath: Settings_.legacySettingsPath,
      sharedPath: Settings_.sharedPath,
      serverDir: Settings_.serverDir,
      appSettingsPath: Settings_.appSettingsPath,
    });
    migrateLauncherOptions(
      Settings_.sharedPath,
      devicePath('launcherOptions.json'),
    );

    // 2. AppSettings (unchanged location). A new user has no profiles and
    // installs one from the marketplace (or creates one) in the intro.
    this.appSettingsStorage = new StorageModule<StoredAppSettings>(
      Settings_.appSettingsPath,
      generateAppSettings,
      {
        validate: isValidStoredAppSettings,
      },
    );

    if (hasMigrated) {
      // Persist directly — setAppSettings would broadcast, but global.broadcast
      // isn't wired up until main() runs (after this constructor).
      const appSettings = this.appSettingsStorage.get();
      appSettings.theme = Themes.BASALT;
      this.appSettingsStorage.set(appSettings);
    }

    // 3. Shared storage and device-only launcher options.
    this.sharedStorage = new StorageModule<SharedSettings>(
      Settings_.sharedPath,
      generateShared,
      {
        beforeSave: sharedBeforeSave,
        afterRead: sharedAfterRead,
        validate: isValidShared,
      },
    );
    this.launcherStorage = new StorageModule(
      devicePath('launcherOptions.json'),
      generateLauncherOptions,
    );

    // 4. Remember the bootstrap profile without opening its profile store.
    const storedAppSettings = this.appSettingsStorage.get();
    this.bootstrapProfileKey =
      storedAppSettings.lastProfile ??
      storedAppSettings.server ??
      '';

    this.moveLegacyProfileAppSettings(storedAppSettings);

    this.stats = new Statistics(this);
    this.stats.readStats();

    // 5. Custom profiles (must exist before first JNdata broadcast).
    this.profiles = new Profiles_(() => this.rebroadcastJNdata());

    this.events();

    this.JNdata = mergeProfilesIntoJNdata(STATIC_JNDATA, this.profiles.list);
    this.reconcileActiveServer();
  }

  get shared(): SharedSettings {
    return {
      ...this.sharedStorage.get(),
      launcherOptions: this.launcherStorage.get(),
    };
  }

  /** Global app settings without the internal profile-override index. */
  private get storedAppSettings(): StoredAppSettings {
    return this.appSettingsStorage.get();
  }

  private get globalAppSettings(): AppSettings {
    return stripProfileOverrides(this.storedAppSettings);
  }

  get sharedAppSettings(): AppSettings {
    const { global } = splitAppSettings(this.globalAppSettings);
    const {
      server: _server,
      lastProfile: _lastProfile,
      ...settings
    } = global as AppSettings & {
      lastProfile?: string;
    };
    return settings as AppSettings;
  }

  private profileStorage(profileKey: string): StorageModule<SettingsObj> {
    const existing = this.profileStorages.get(profileKey);
    if (existing) return existing;
    const storage = openServerStorage(
      profileKey,
      getServerMeta(this.JNdata, profileKey).defaultGamemode,
    );
    this.migrateProfileAppSettings(profileKey, storage);
    this.profileStorages.set(profileKey, storage);
    return storage;
  }

  getProfileSettings(profileKey: string): SettingsObj {
    return this.profileStorage(profileKey).get();
  }

  /** Migrate only the profile that is being enabled. */
  activateProfile(profileKey: string): void {
    const storage = this.profileStorage(profileKey);
    const settings = storage.get();
    if (settings.version < ALT_PREMIUM_MIGRATION_VERSION) {
      const premiumByUsername = getLegacyPremiumByUsername(this.shared.alts);
      migrateLegacyPremiumInSettings(settings, premiumByUsername);
      settings.version = SETTINGS_VERSION;
      storage.set(settings);
    }

    const shared = this.sharedStorage.get();
    if (!shared.version || shared.version < SHARED_VERSION ) {
      shared.alts = shared.alts.map(stripAltToIdentity);
      shared.version = SHARED_VERSION;
      this.sharedStorage.set(shared);
    }
  }

  getProfileAppSettings(profileKey: string): AppSettings {
    this.profileStorage(profileKey);
    return mergeProfileAppSettings(
      this.globalAppSettings,
      this.JNdata?.data?.[profileKey]?.appSettingsDefaults,
      this.storedAppSettings.profileOverrides?.[profileKey],
    );
  }

  updateProfileSettings(
    profileKey: string,
    patches: SettingsPatch | SettingsPatch[],
  ): SettingsObj {
    const storage = this.profileStorage(profileKey);
    const settings = storage.get();
    for (const patch of Array.isArray(patches) ? patches : [patches]) {
      applySettingsPatch(settings, patch);
    }
    storage.set(settings);
    this.emit(`profile:settings:${profileKey}`, settings);
    return settings;
  }

  replaceProfileSettings(
    profileKey: string,
    value: SettingsObj,
  ): SettingsObj {
    const storage = this.profileStorage(profileKey);
    storage.set(clone(value));
    const settings = storage.get();
    this.emit(`profile:settings:${profileKey}`, settings);
    return settings;
  }

  replaceProfileAppSettings(
    profileKey: string,
    values: Partial<AppSettings>,
  ): AppSettings {
    const stored = this.appSettingsStorage.get();
    stored.profileOverrides ??= {};
    stored.profileOverrides[profileKey] = clone(values);
    this.appSettingsStorage.set(stored);
    const effective = this.getProfileAppSettings(profileKey);
    this.emit(`profile:appSettings:${profileKey}`, effective);
    return effective;
  }

  setAppSetting(profileKey: string, key: string, value: unknown): AppSettings {
    if (key === 'proxy') value = normalizeProxyConfig(value);
    if (isProfileSpecificSetting(key))
      return this.setProfileAppSetting(profileKey, key, value);
    return this.setSharedAppSetting(key, value);
  }

  updateAppSettings(
    profileKey: string,
    patches: Array<{ key: string; value: unknown }>,
  ): AppSettings {
    if (!Array.isArray(patches) || patches.length === 0)
      throw new TypeError('At least one app setting is required');

    this.profileStorage(profileKey);
    const stored = clone(this.storedAppSettings);
    stored.profileOverrides ??= {};
    stored.profileOverrides[profileKey] ??= {};
    let sharedChanged = false;
    patches.forEach((patch) => {
      const key = String(patch?.key ?? '').trim();
      if (!key) throw new TypeError('Invalid app setting key');
      const value =
        key === 'proxy' ? normalizeProxyConfig(patch.value) : patch.value;
      if (isProfileSpecificSetting(key))
        stored.profileOverrides![profileKey][key] = value;
      else {
        stored[key] = value;
        sharedChanged = true;
      }
    });
    this.appSettingsStorage.set(stored);
    const effective = this.getProfileAppSettings(profileKey);
    this.emit(`profile:appSettings:${profileKey}`, effective);
    if (sharedChanged) this.emit('sharedAppSettings', this.sharedAppSettings);
    return effective;
  }

  setProfileAppSetting(
    profileKey: string,
    key: string,
    value: unknown,
  ): AppSettings {
    this.profileStorage(profileKey);
    const stored = this.appSettingsStorage.get();
    stored.profileOverrides ??= {};
    stored.profileOverrides[profileKey] ??= {};
    stored.profileOverrides[profileKey][key] = value;
    this.appSettingsStorage.set(stored);
    const effective = this.getProfileAppSettings(profileKey);
    this.emit(`profile:appSettings:${profileKey}`, effective);
    return effective;
  }

  setSharedAppSetting(key: string, value: unknown): AppSettings {
    const stored = this.appSettingsStorage.get();
    stored[key] = value;
    this.appSettingsStorage.set(stored);
    const next = this.sharedAppSettings;
    this.emit('sharedAppSettings', next);
    return next;
  }

  /** Persist the startup default without changing any client's live profile. */
  setDefaultProfile(profileKey: string): boolean {
    if (
      !this.getInstalledServerIds().includes(profileKey)
    )
      return false;
    this.appSettingsStorage.set({
      ...this.storedAppSettings,
      server: profileKey as AppSettings['server'],
      lastProfile: profileKey,
    });
    return true;
  }

  /**
   * Select the profile used by legacy/bootstrap consumers such as the CLI.
   * Renderer clients use explicit profile runtimes and never call this.
   */
  selectBootstrapProfile(profileKey: string): boolean {
    if (
      !this.getInstalledServerIds().includes(
        profileKey,
      ) ||
      !this.getProfile(profileKey)
    )
      return false;

    this.bootstrapProfileKey = profileKey;
    this.activateProfile(profileKey);
    this.appSettingsStorage.set({
      ...this.storedAppSettings,
      server: profileKey as AppSettings['server'],
      lastProfile: profileKey,
    });
    return true;
  }

  getAvailableProfiles(): ActiveProfileObj[] {
    return this.getInstalledServerIds()
      .map((profileKey) => this.getProfile(profileKey))
      .filter((profile): profile is ActiveProfileObj => profile !== null);
  }

  getProfile(profileKey: string): ActiveProfileObj | null {
    if (!this.JNdata?.data?.[profileKey] || !this.JNdata.servers?.[profileKey])
      return null;
    return {
      gamemodes: this.JNdata.servers[profileKey],
      data: this.JNdata.data[profileKey],
      server: profileKey,
    };
  }

  /** Shared app settings only. Profile settings require an explicit profile. */
  get appSettings(): AppSettings {
    return this.sharedAppSettings;
  }

  events() {
    ipcMain.on(
      'shared-update',
      (origin: IpcMainEvent | Origin, update: unknown) => {
        this.updateShared(update, false, origin as Origin);
      },
    );
    ipcMain.on('shared', (e) => e.reply('shared', this.shared));
    ipcMain.on('JNdata', (e) => e.reply('JNdata', this.JNdata));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    console.info('Quick save...');
    const storages: Array<[string, { close(): void }]> = [
      ['shared settings', this.sharedStorage],
      ['launcher options', this.launcherStorage],
      ['app settings', this.appSettingsStorage],
      ['statistics', this.stats.statsStorage],
      ['profiles', this.profiles],
      ...[...this.profileStorages].map(
        ([profile, storage]): [string, StorageModule<SettingsObj>] => [
          `profile ${profile}`,
          storage,
        ],
      ),
    ];
    storages.forEach(([name, storage]) => {
      try {
        storage.close();
      } catch (err) {
        console.error(`Failed to close ${name}:`, err);
      }
    });
    this.profileStorages.clear();
  }

  updateShared(
    update: unknown,
    updateClient: boolean = false,
    origin: Origin = { sockets: false, socket: null },
  ) {
    if (!isValidSharedSettingsUpdate(update)) {
      return console.error('Invalid shared settings update: ', update);
    }

    let shared = {...this.shared}
    if (update.alts) {
      shared.alts = update.alts;
    }
    if (update.pluginMetadata) {
      shared.pluginMetadata = update.pluginMetadata;
    }
    if (update.launcherOptions) shared.launcherOptions = update.launcherOptions;
    this.replaceShared(shared, updateClient, origin);
  }

  private replaceShared(
    shared: unknown,
    updateClient: boolean = false,
    origin: Origin = { sockets: false, socket: null },
  ) {
    if (!isValidShared(shared)) {
      return console.error('Invalid shared settings: ', shared);
    }

    const normalizedShared: SharedSettings = {
      ...shared,
      alts: shared.alts.map(stripAltToIdentity),
    };
    if (
      normalizedShared.launcherOptions &&
      normalizedShared.launcherOptions !== this.launcherStorage.get()
    ) {
      this.launcherStorage.set(normalizedShared.launcherOptions);
    }
    delete normalizedShared.launcherOptions;

    // When an alt is fully removed from the shared identity list, also delete
    // its Minecraft auth tokens so a deleted premium alt leaves nothing behind.
    // replaceShared is the single authoritative write point for the alt list, so
    // this covers every deletion path (profile/drawer/multi-server edit).
    const nextUsernames = new Set(normalizedShared.alts.map((a) => a.username));
    for (const prev of this.shared.alts ?? []) {
      if (!nextUsernames.has(prev.username)) {
        removeMinecraftAuth(prev.username).catch(() => undefined);
      }
    }

    this.sharedStorage.set(normalizedShared);

    if (origin?.sockets) {
      origin.socket?.broadcast('shared', this.shared);
      global.send('shared', this.shared);
    } else {
      global.broadcast('shared', this.shared);
    }
    this.emit('shared', this.shared);
    if (updateClient) this.sendShared();
  }

  setPluginData(pluginData: PluginData) {
    this.updateProfileSettings(this.bootstrapProfileKey, {
      path: ['pluginData'],
      value: pluginData,
    });
  }

  /**
   * Rebuild the merged JNdata after the profile list changes and push it, with
   * the profiles, to every client. Profiles also change in main (share
   * installs, updates), so no client may be assumed to be up to date already;
   * the echo to the client that made the change is harmless.
   */
  rebroadcastJNdata() {
    this.JNdata = mergeProfilesIntoJNdata(STATIC_JNDATA, this.profiles.list);
    global.send('JNdata', this.JNdata);
    global.send('profiles', this.profiles.list);
    this.emit('JNdata', this.JNdata);
    this.stats.calculateAccountWorth();
  }

  sendJNdata() {
    global.send('JNdata', this.JNdata);
  }

  sendShared() {
    global.send('shared', this.shared);
  }

  sendAppSettings() {
    global.appSettings = this.sharedAppSettings;
    // This is a startup suggestion only. It lets a fresh client establish its
    // first scoped subscription; changing it in one client never writes or
    // changes another client's selected profile.
    global.send('appSettings', {
      ...this.sharedAppSettings,
      server: this.bootstrapProfileKey,
    });
  }

  removeDevice(deviceId: string) {
    const shared = this.shared;
    shared.devices ??= [];
    shared.devices = shared.devices.filter((d) => d.id !== deviceId);
    this.replaceShared(shared);
  }

  /** Supports importing legacy CLI configuration files. */
  public async decryptContent(encryptedBuffer: Buffer): Promise<string | null> {
    const key = crypto.scryptSync(password, 'salt', 16);
    try {
      const iv = encryptedBuffer.subarray(0, 16);
      const encryptedText = encryptedBuffer.subarray(16);
      // @ts-ignore
      const decipher: any = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted: any = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      const decompressed = await gunzip(decrypted);
      return decompressed.toString('utf8');
    } catch (error) {
      console.error('Error during decompression or decryption:', error);
      return null;
    }
  }

  updateDevice(deviceId: string, device: Device) {
    const shared = this.shared;
    shared.devices ??= [];
    const index = shared.devices.findIndex((d) => d.id === deviceId);
    if (index !== -1) {
      shared.devices[index] = device;
    } else {
      shared.devices.push(device);
    }
    this.replaceShared(shared);
  }

  /**
   * Look up an alt's stored password for an arbitrary server (active or
   * not). Reads from disk when the server isn't the active one — used by
   * the Minecraft launcher bridge so it can autologin a player even when
   * the user is currently viewing a different profile.
   */
  public getAltPassword(
    username: string,
    serverId: string,
  ): string | undefined {
    return this.getProfileSettings(serverId).altData?.[username]?.password;
  }

  /**
   * Active-profile alts: cross-server identities that have an altData entry
   * on the current server. Alts configured only on other profiles are
   * filtered out — workers and stats only care about this server's alts.
   */
  public getAltsWithData(): AltWithData[] {
    this.activateProfile(this.bootstrapProfileKey);
    const altData =
      this.getProfileSettings(this.bootstrapProfileKey).altData ?? {};
    return (this.shared.alts ?? [])
      .filter((alt) => altData[alt.username])
      .map((alt) => ({ ...alt, data: altData[alt.username]! }));
  }

  /**
   * Same as `getAltsWithData` but for an arbitrary profile. Reads from disk
   * when the requested profile isn't the active one — used by the import-alts
   * UI so the user can copy alts (including passwords) across profiles.
   */
  public getAltsWithDataForProfile(serverId: string): AltWithData[] {
    const altData = this.getProfileSettings(serverId).altData ?? {};
    return (this.shared.alts ?? [])
      .filter((a) => altData[a.username])
      .map((a) => ({ ...a, data: altData[a.username]! }));
  }

  public setAltsForProfile(
    profileKey: string,
    alts: AltWithData[],
    rename?: { from: string; to: string },
  ): void {
    if (!Array.isArray(alts)) throw new TypeError('Alts must be an array');
    if (profileKey === this.bootstrapProfileKey) this.activateProfile(profileKey);
    const sharedAlts: Alt[] = [];
    const existingSharedAlts = this.shared.alts ?? [];
    const seen = new Set<string>();
    for (const alt of alts) {
      const existing = existingSharedAlts.find(
        (candidate) =>
          candidate.username.toLowerCase() === alt.username.toLowerCase() ||
          candidate.username.toLowerCase() === rename?.from.toLowerCase(),
      );
      const identity = stripAltToIdentity(alt);
      identity.UID ??= existing?.UID;
      sharedAlts.push(identity);
      seen.add(alt.username.toLowerCase());
    }
    for (const alt of this.shared.alts ?? []) {
      if (
        !seen.has(alt.username.toLowerCase()) &&
        alt.username.toLowerCase() !== rename?.from.toLowerCase()
      )
        sharedAlts.push(alt);
    }
    const altData: Record<string, ServerAltInfo> = {};
    for (const alt of alts) {
      if (!alt.data) continue;
      alt.data.premium ??= getLegacyPremium(alt) ?? false;
      altData[alt.username] = alt.data;
    }
    this.updateShared({ alts: sharedAlts }, true);
    const renameKey = rename?.from.toLowerCase();
    const settings = this.getProfileSettings(profileKey);
    const altTags = renameKey
      ? (settings.altTags ?? []).map((tag) => ({
          ...tag,
          alts: tag.alts.map((username) =>
            username.toLowerCase() === renameKey && rename ? rename.to : username,
          ),
        }))
      : settings.altTags;
    this.updateProfileSettings(profileKey, [
      { path: ['altData'], value: altData },
      { path: ['altTags'], value: altTags },
    ]);
    if (rename) this.renameAltAcrossProfiles(profileKey, rename);
  }

  private renameAltAcrossProfiles(
    activeProfileKey: string,
    rename: { from: string; to: string },
  ): void {
    const profileKeys = new Set(this.profileStorages.keys());
    if (fs.existsSync(Settings_.serverDir)) {
      for (const file of fs.readdirSync(Settings_.serverDir)) {
        if (file.endsWith('.json'))
          profileKeys.add(file.slice(0, -'.json'.length));
      }
    }

    const fromKey = rename.from.toLowerCase();
    for (const profileKey of profileKeys) {
      if (profileKey === activeProfileKey) continue;
      const settings = this.getProfileSettings(profileKey);
      const storedUsername = Object.keys(settings.altData ?? {}).find(
        (username) => username.toLowerCase() === fromKey,
      );
      const altData = { ...(settings.altData ?? {}) };
      if (storedUsername) {
        const data = altData[storedUsername];
        delete altData[storedUsername];
        altData[rename.to] = data;
      }

      let tagsChanged = false;
      const altTags = (settings.altTags ?? []).map((tag) => ({
        ...tag,
        alts: tag.alts.map((username) => {
          if (username.toLowerCase() !== fromKey) return username;
          tagsChanged = true;
          return rename.to;
        }),
      }));
      if (storedUsername || tagsChanged) {
        this.updateProfileSettings(profileKey, [
          { path: ['altData'], value: altData },
          { path: ['altTags'], value: altTags },
        ]);
      }
    }
  }

  /**
   * Servers installed from the old JNdata server list that have no profile
   * yet. They come back as official profile shares under the same id, so their
   * settings, alts and stats keep working (see ShareService.adoptOfficialProfiles).
   */
  get legacyServers(): string[] {
    const ids = (this.storedAppSettings as { installedServers?: unknown }).installedServers;
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string' && !this.profiles.get(id))
      : [];
  }

  /** Keep only the legacy servers still waiting for their official profile. */
  setLegacyServers(ids: string[]): void {
    const { installedServers: _done, ...rest } = this.storedAppSettings as StoredAppSettings & {
      installedServers?: string[];
    };
    this.appSettingsStorage.set(ids.length ? { ...rest, installedServers: ids } : rest);
  }

  /**
   * Server ids the user can use: every installed profile (official ones come
   * from the marketplace). Mirrors the renderer's `selectInstalledServerIds`.
   */
  private getInstalledServerIds(): string[] {
    return this.JNdata.serverList ?? [];
  }

  /**
   * Make sure the active server points at something installed. If it doesn't
   * (e.g. it was uninstalled in a previous session) switch to the first
   * installed server. When nothing is installed we leave the now-invalid id in
   * place — the renderer's InvalidServerGate takes over and forces the user to
   * install or create a profile. Runs at boot, before main() wires broadcast,
   * so it persists directly rather than going through setAppSettings.
   */
  private reconcileActiveServer() {
    const appSettings = this.storedAppSettings;
    const installed = this.getInstalledServerIds();
    const lastProfile =
      (appSettings as AppSettings & { lastProfile?: string }).lastProfile ??
      this.bootstrapProfileKey;
    // A legacy server keeps its place while its official profile is installed.
    if (installed.length === 0 || installed.includes(lastProfile) || this.legacyServers.includes(lastProfile)) {
      return;
    }

    const fallback = installed[0];
    if (fallback !== this.bootstrapProfileKey) {
      this.bootstrapProfileKey = fallback;
    }
    this.appSettingsStorage.set({
      ...appSettings,
      server: fallback as AppSettings['server'],
      lastProfile: fallback,
    });
  }

  /**
   * Snapshot every server's settings file (including those not currently
   * loaded) plus shared + appSettings + stats. Used for cloud backup/export.
   */
  toJSON(): string {
    const perServer: Record<string, SettingsObj> = {};
    if (fs.existsSync(Settings_.serverDir)) {
      for (const file of fs.readdirSync(Settings_.serverDir)) {
        if (!file.endsWith('.json')) continue;
        const id = file.slice(0, -'.json'.length);
        try {
          const raw = fs.readFileSync(
            path.join(Settings_.serverDir, file),
            'utf8',
          );
          perServer[id] = JSON.parse(raw);
        } catch (e) {
          console.warn(`Failed to read server file ${file}`, e);
        }
      }
    }
    // Ensure all open in-memory copies win over disk, with passwords properly encoded.
    for (const [id, storage] of this.profileStorages.entries()) {
      perServer[id] = serverBeforeSave(storage.get());
    }
    if (
      this.bootstrapProfileKey &&
      !this.profileStorages.has(this.bootstrapProfileKey)
    ) {
      perServer[this.bootstrapProfileKey] = serverBeforeSave(
        this.getProfileSettings(this.bootstrapProfileKey),
      );
    }

    return JSON.stringify({
      shared: this.shared,
      // App settings, including profile-specific overrides, have one owner.
      appSettings: this.storedAppSettings,
      perServer,
      stats: this.stats.stats,
      profiles: this.profiles.list,
    });
  }

  fromJSON(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString) as {
        shared?: SharedSettings;
        appSettings?: AppSettings;
        perServer?: Record<string, SettingsObj>;
        stats?: Stats;
        profiles?: CustomProfile[];
        // Legacy export (pre-split): single `settings` blob.
        settings?: any;
      };

      if (data.settings && !data.perServer && !data.shared) {
        // Legacy v1 export — synthesize shared + perServer from it.
        const legacy = data.settings;
        const shared: SharedSettings = {
          alts: legacy.alts ?? [],
          devices: legacy.devices ?? [],
          pluginMetadata: {},
          launcherOptions: legacy.launcherOptions,
          version: SHARED_VERSION,
        };
        const perServer: Record<string, SettingsObj> = {};
        // v1 kept per-server alt data inside each alt, so servers without scripts still count.
        const list = [
          ...new Set([
            ...Object.keys(legacy.scripts ?? {}),
            ...Object.keys(legacy.altTags ?? {}),
            ...(Array.isArray(legacy.alts) ? legacy.alts : []).flatMap(
              (alt: Record<string, unknown>) =>
                Object.keys(alt ?? {}).filter((key) => isRecord(alt[key])),
            ),
          ]),
        ];
        const current = data.appSettings?.server ?? list[0] ?? 'jartexnetwork';
        for (const id of list) {
          perServer[id] = {
            scripts: legacy.scripts?.[id] ?? {},
            altTags: legacy.altTags?.[id] ?? [],
            reminders: id === current ? legacy.reminders ?? [] : [],
            triggers: id === current ? migrateLegacyTriggers(legacy.triggers) : [],
            altData: buildLegacyAltData(legacy.alts, id),
            version: SETTINGS_VERSION,
            pluginData: {},
          };
        }
        data.shared = shared;
        data.perServer = perServer;
      }

      if (data.shared) {
        if (data.perServer) {
          const activeSettings = data.perServer[this.bootstrapProfileKey];
          if (
            activeSettings &&
            activeSettings.version < ALT_PREMIUM_MIGRATION_VERSION
          ) {
            migrateLegacyPremiumInSettings(
              activeSettings,
              getLegacyPremiumByUsername(data.shared.alts),
            );
            activeSettings.version = SETTINGS_VERSION;
          }
        }
        data.shared = {
          ...data.shared,
          alts: data.shared.alts.map(stripAltToIdentity),
          version: SHARED_VERSION,
        };
      }

      if (data.shared) this.replaceShared(data.shared, true);
      if (data.perServer) {
        for (const [id, perServerSettings] of Object.entries(data.perServer)) {
          const { appSettings, ...settings } =
            perServerSettings as LegacyProfileSettings;
          writeServerFile(id, settings);
          if (appSettings) this.setProfileAppSettings(id, appSettings);
        }
        // Reload all open profile stores, then notify only the corresponding
        // profile subscriptions.
        for (const storage of this.profileStorages.values()) storage.close();
        this.profileStorages.clear();
        for (const id of Object.keys(data.perServer)) {
          this.emit(`profile:settings:${id}`, this.getProfileSettings(id));
          this.emit(
            `profile:appSettings:${id}`,
            this.getProfileAppSettings(id),
          );
        }
      }
      if (data.appSettings) {
        const { profileOverrides, ...flatAppSettings } =
          data.appSettings as StoredAppSettings;
        const { global: globalSettings, profile } = splitAppSettings(
          flatAppSettings,
        );
        for (const [key, value] of Object.entries(globalSettings)) {
          if (key !== 'server' && key !== 'lastProfile')
            this.setSharedAppSetting(key, value);
        }
        for (const [profileKey, settings] of Object.entries(
          profileOverrides ?? {},
        )) {
          this.setProfileAppSettings(profileKey, settings);
        }
        for (const [key, value] of Object.entries(profile)) {
          this.setProfileAppSetting(this.bootstrapProfileKey, key, value);
        }
      }
      if (data.stats) this.stats.setStats(data.stats, true);
      if (Array.isArray(data.profiles)) {
        this.profiles.setAll(data.profiles);
      }
      return true;
    } catch (error) {
      console.info('Error parsing JSON:', error);
      return false;
    }
  }

  /**
   * Older builds kept profile-specific values in the global app-settings
   * file. Move that one legacy slice to the selected profile, then leave the
   * global store with shared values and profile-selection metadata only.
   */
  private moveLegacyProfileAppSettings(stored: StoredAppSettings): void {
    const { profileOverrides, ...flatSettings } = stored;
    const { global, profile } = splitAppSettings(flatSettings);
    if (Object.keys(profile).length === 0) return;

    this.setProfileAppSettings(this.bootstrapProfileKey, profile);
    this.appSettingsStorage.set({
      ...global,
      profileOverrides:
        this.storedAppSettings.profileOverrides ?? profileOverrides,
    });
  }

  private setProfileAppSettings(
    profileKey: string,
    values: Partial<AppSettings>,
  ): void {
    const stored = this.appSettingsStorage.get();
    stored.profileOverrides ??= {};
    stored.profileOverrides[profileKey] = {
      ...stored.profileOverrides[profileKey],
      ...values,
    };
    this.appSettingsStorage.set(stored);
  }

  private migrateProfileAppSettings(
    profileKey: string,
    storage: StorageModule<SettingsObj>,
  ): void {
    const stored = storage.get() as LegacyProfileSettings;
    if (!stored.appSettings) return;

    this.setProfileAppSettings(profileKey, stored.appSettings);
    const { appSettings: _legacyAppSettings, ...settings } = stored;
    storage.set(settings);
  }

}

// ─── helpers ──────────────────────────────────────────────────────────────

const PROFILE_SETTING_ROOTS = new Set([
  'scripts',
  'pluginData',
  'reminders',
  'triggers',
  'altTags',
  'altData',
  'version',
]);

function applySettingsPatch(settings: SettingsObj, patch: SettingsPatch): void {
  if (
    !patch?.path?.length ||
    !PROFILE_SETTING_ROOTS.has(String(patch.path[0]))
  ) {
    throw new TypeError('Invalid profile settings path');
  }

  const parent = patch.path.slice(0, -1).reduce<Record<string, any>>(
    (value, key) => {
      value[key] ??= {};
      return value[key];
    },
    settings as unknown as Record<string, any>,
  );
  const key = patch.path[patch.path.length - 1];
  if (patch.remove) delete parent[key];
  else parent[key] = patch.value;
}

function openServerStorage(
  serverId: string,
  defaultGamemode: string,
): StorageModule<SettingsObj> {
  return new StorageModule<SettingsObj>(
    path.join(Settings_.serverDir, `${serverId}.json`),
    () => generateServerSettings(defaultGamemode),
    {
      validate: isValidSettings,
      afterRead: serverAfterRead,
      beforeSave: serverBeforeSave,
    },
  );
}

function serverBeforeSave(settings: SettingsObj): SettingsObj {
  const next = clone(settings);
  next.version ??= SETTINGS_VERSION;
  const altData: { [u: string]: ServerAltInfo } = next.altData ?? {};
  for (const username of Object.keys(altData)) {
    const info = altData[username];
    altData[username] = encodeAltDataPassword(info);
  }
  next.altData = altData;
  return next;
}

function writeServerFile(serverId: string, settings: SettingsObj) {
  if (!fs.existsSync(Settings_.serverDir)) {
    fs.mkdirSync(Settings_.serverDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(Settings_.serverDir, `${serverId}.json`),
    JSON.stringify(serverBeforeSave(settings)),
    'utf8',
  );
}

function generateServerSettings(defaultGamemode: string): SettingsObj {
  const scripts: ScriptSettingsSection = defaultGamemode
    ? { gamemode: defaultGamemode.toLowerCase() }
    : {};
  return {
    scripts,
    reminders: [],
    triggers: [],
    altTags: [],
    altData: {},
    version: SETTINGS_VERSION,
    pluginData: {},
  };
}

function serverAfterRead(settings: SettingsObj): SettingsObj {
  const hasPremiumMigration =
    (settings.version ?? 0) >= ALT_PREMIUM_MIGRATION_VERSION;
  settings.scripts ??= {};
  settings.reminders ??= [];
  settings.triggers = migrateLegacyTriggers(settings.triggers);
  settings.altTags ??= [];
  settings.altData ??= {};
  settings.pluginData ??= {};
  settings.version ??= 0;
  for (const [u, info] of Object.entries(settings.altData)) {
    const decoded = decodeAltDataPassword(info);
    if (hasPremiumMigration) decoded.premium ??= false;
    settings.altData[u] = decoded;
  }
  return settings;
}

function isValidSettings(settings: SettingsObj): boolean {
  return (
    !!settings &&
    typeof settings === 'object' &&
    typeof settings.scripts === 'object'
  );
}

function generateShared(): SharedSettings {
  return {
    alts: [],
    devices: [],
    pluginMetadata: {},
    version: SHARED_VERSION,
  };
}

function generateLauncherOptions(): NonNullable<SharedSettings['launcherOptions']> {
  return {
    username: '',
    version: '1.21.11',
    launcherFlags: MinecraftLauncherTypes.JNBOT_CLIENT,
    minMemoryMB: 512,
    maxMemoryMB: 2048,
    window: { fullscreen: false },
    gamemode: 'SkyblockDream',
  };
}

function generateAppSettings(): AppSettings {
  return {
    server: '',
    allowPrereleaseUpdates: false,
    sidebarCollapsed: false,
  };
}

function isValidStoredAppSettings(
  settings: StoredAppSettings,
): settings is StoredAppSettings {
  return typeof settings === 'object' && settings !== null;
}

function stripProfileOverrides(settings: StoredAppSettings): AppSettings {
  const { profileOverrides: _profileOverrides, ...global } = settings;
  return global;
}

function sharedBeforeSave(__shared: SharedSettings): SharedSettings {
  // Strip per-server slots that may have leaked in (defensive — pre-split
  // shared.json sometimes carried them; we never want to write them out).
  const shared = clone(__shared);
  delete shared.launcherOptions;
  shared.devices = (shared.devices ?? []).map(stripLegacyDevice);
  shared.version = SHARED_VERSION;
  return shared;
}

function sharedAfterRead(shared: SharedSettings): SharedSettings {
  shared.alts ??= [];
  shared.devices ??= [];
  shared.pluginMetadata ??= {};
  shared.version ??= 0;
  // Keep the legacy field in memory until the active profile migration can
  // copy it into that profile. sharedBeforeSave strips it again.
  shared.alts = shared.alts.map((alt) => {
    const identity = stripAltToIdentity(alt);
    const premium = getLegacyPremium(alt);
    return premium === undefined ? identity : { ...identity, premium };
  });
  shared.devices = shared.devices.map(stripLegacyDevice);
  return shared;
}

function isValidShared(shared: unknown): shared is SharedSettings {
  return (
    !!shared &&
    typeof shared === 'object' &&
    Array.isArray((shared as SharedSettings).alts) &&
    Array.isArray((shared as SharedSettings).devices)
  );
}

function isValidSharedSettingsUpdate(
  value: unknown,
): value is SharedSettingsUpdate {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  const hasAlts = Object.hasOwn(update, 'alts');
  const hasPluginMetadata = Object.hasOwn(update, 'pluginMetadata');
  const hasLauncherOptions = Object.hasOwn(update, 'launcherOptions');

  if (!hasAlts && !hasPluginMetadata && !hasLauncherOptions) return false;
  if (hasAlts && !Array.isArray(update.alts)) return false;
  if (
    hasPluginMetadata &&
    (!update.pluginMetadata || typeof update.pluginMetadata !== 'object')
  )
    return false;
  if (
    hasLauncherOptions &&
    update.launcherOptions !== undefined &&
    (!update.launcherOptions || typeof update.launcherOptions !== 'object')
  )
    return false;
  return true;
}

/** Drop profile-specific fields from a shared identity. */
function stripAltToIdentity(alt: Alt): Alt {
  return {
    username: alt.username,
    UID: alt.UID,
  };
}

function getLegacyPremium(alt: Alt): boolean | undefined {
  const premium = Reflect.get(alt, 'premium');
  return typeof premium === 'boolean' ? premium : undefined;
}

function getLegacyPremiumByUsername(alts: Alt[]): Record<string, boolean> {
  const premiumByUsername: Record<string, boolean> = {}
  for (const alt of alts) {
    const premium = getLegacyPremium(alt);
    if (premium !== undefined) {
      premiumByUsername[alt.username.toLowerCase()] =  premium;
    }
  }
  return premiumByUsername;
}

function buildLegacyAltData(
  legacyAlts: unknown,
  profileKey: string,
): Record<string, ServerAltInfo> {
  if (!Array.isArray(legacyAlts)) return {};

  const altData: Record<string, ServerAltInfo> = {};
  for (const value of legacyAlts) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const alt = value as Record<string, unknown>;
    const username = typeof alt.username === 'string' ? alt.username : '';
    const profileData = alt[profileKey];
    if (!username || !profileData || typeof profileData !== 'object') continue;
    const data = profileData as Record<string, unknown>;
    altData[username] = {
      premium: alt.premium === true,
      password: typeof data.password === 'string' ? data.password : undefined,
      gkits: isRecord(data.gkits) ? data.gkits as ServerAltInfo['gkits'] : {},
      ranks: isRecord(data.ranks) ? data.ranks as ServerAltInfo['ranks'] : {},
    };
  }
  return altData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function migrateLegacyPremiumInSettings(
  settings: SettingsObj,
  premiumByUsername: Record<string, boolean>,
): void {
  for (const [username, info] of Object.entries(settings.altData ?? {})) {
    const premium = premiumByUsername[username.toLowerCase()];
    if (premium === undefined || info.premium !== undefined) continue;
    info.premium = premium;
  }
}

function stripLegacyDevice(device: Device & { trusted?: boolean }): Device {
  return {
    name: device.name,
    id: device.id,
    token: device.token,
    // Links without stored permissions get the Standard preset.
    permissions: normalizePermissions(device.permissions),
  };
}

function isEncodedPassword(str: string): boolean {
  if (!str || typeof str !== 'string' || str.length % 4 !== 0) return false;
  const hex = Buffer.from(str, 'base64').toString('ascii');
  return hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-f]+$/.test(hex);
}

function encodeAltDataPassword(info: ServerAltInfo): ServerAltInfo {
  if (!info?.password || isEncodedPassword(info.password)) return info;
  return { ...info, password: encode(info.password) };
}

function decodeAltDataPassword(info: ServerAltInfo): ServerAltInfo {
  if (!info?.password || !isEncodedPassword(info.password)) return info;
  return { ...info, password: decode(info.password) };
}

function decode(str: string): string {
  return Buffer.from(
    Buffer.from(str, 'base64').toString('ascii'),
    'hex',
  ).toString('ascii');
}

function encode(str: string): string {
  return Buffer.from(Buffer.from(str).toString('hex')).toString('base64');
}

export default Settings_;
export { SETTINGS_VERSION, SHARED_VERSION };
