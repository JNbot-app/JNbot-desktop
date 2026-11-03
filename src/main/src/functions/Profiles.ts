import path from 'path';
import { ipcMain } from 'electron';
import { getPlatform } from '../platform';
import fs from './storage/portableFs';
import { promisify } from 'util';
import StorageModule from './storage/Storage';
import {
  CustomProfile,
  ProfilesFile,
  PROFILES_VERSION,
} from '../../../common/profiles';
import { handle } from './ipcHandle';
import type ProfileScripts_ from './ProfileScripts';
import type {
  ProfileScript,
  ProfileScriptBundle,
} from '../../../common/profileScripts';
import { deobfuscateCodeFromBase64 } from './ProfileScripts';
import { formatFingerprint, PluginVerification, pluginSecurity } from './signing';
import showDialog from './actions/dialog';
import { portablePath } from './storage/portablePaths';
import { portableFileChanged } from './storage/PortableWrites';
import { portableProfile, portableScriptPath } from './profileScriptPaths';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

/**
 * Owns the on-disk list of user-defined server profiles (profiles.json).
 * Built-in (read-only) servers are NOT stored here — they live in the JNdata
 * payload fetched from GitHub.
 *
 * The merging into JNdata is done by Settings — this class just persists
 * and exposes CRUD over IPC.
 */
class Profiles_ {
  static get profilesPath(): string { return portablePath('profiles.json'); }

  storage: StorageModule<ProfilesFile>;
  onChange?: (profiles: CustomProfile[]) => void;
  /**
   * Set by main during boot once Macros is initialised. We import the
   * resolver lazily here so this module can still be required by
   * code that doesn't have Macros wired up yet (CLI, tests).
   */
  scripts?: ProfileScripts_;

  constructor(onChange?: (profiles: CustomProfile[]) => void) {
    this.onChange = onChange;
    this.storage = new StorageModule<ProfilesFile>(
      Profiles_.profilesPath,
      () => ({ version: PROFILES_VERSION, profiles: [] }),
      {
        validate: (f) =>
          !!f && typeof f === 'object' && Array.isArray(f.profiles),
        afterRead: (f) => {
          f.version ??= PROFILES_VERSION;
          f.profiles = (f.profiles ?? []).filter(
            (p) => p && typeof p === 'object' && p.id,
          ).map(portableProfile);
          return f;
        },
      },
    );

    this.events();
  }

  get list(): CustomProfile[] {
    return this.storage.get().profiles;
  }

  get(id: string): CustomProfile | undefined {
    return this.list.find((p) => p.id === id);
  }

  setAll(profiles: CustomProfile[]) {
    const sanitized = profiles
      .filter((p) => p && p.id)
      .map((p) => portableProfile({ ...p, predefined: false as const }));
    this.storage.set({ version: PROFILES_VERSION, profiles: sanitized });
    this.onChange?.(sanitized);
  }

  upsert(profile: CustomProfile) {
    if (!profile?.id) return;
    const next = this.list.filter((p) => p.id !== profile.id);
    next.push({ ...profile, predefined: false, updatedAt: Date.now() });
    this.setAll(next);
  }

  remove(id: string) {
    this.setAll(this.list.filter((p) => p.id !== id));
  }

  /**
   * Point bundled script snapshots of a local (not installed) profile at the
   * library plugin with the same id, so the profile runs and shares the copy
   * you edit instead of the snapshot an earlier import left behind.
   */
  linkLibraryScripts(id: string) {
    const profile = this.get(id);
    const macros = this.scripts?.macros;
    if (!profile || profile.share || !macros) return;
    let linked = false;
    const link = <T extends ProfileScript>(script: T): T => {
      if (script.source.kind !== 'bundled' || !macros.findPlugin(script.pluginId)) return script;
      linked = true;
      // The snapshot's checksum and signature do not apply to the library copy.
      const { checksum: _checksum, signature: _signature, ...rest } = script;
      return { ...rest, source: { kind: 'plugin', pluginId: script.pluginId } } as T;
    };
    const next: CustomProfile = {
      ...profile,
      scripts: profile.scripts?.map(link),
      profileUiAction: profile.profileUiAction && link(profile.profileUiAction),
      botExtensionAction: profile.botExtensionAction && link(profile.botExtensionAction),
    };
    if (linked) this.upsert(next);
  }

  /**
   * Push the custom-profile list to one socket (on connect) or every client.
   * Called from `sendDetails` so profiles sync the same way as settings/JNdata
   * — proactively on every (re)connect, with no request round-trip needed.
   */
  send() {
    global.send('profiles', this.list);
  }

  events() {
    ipcMain.on('profiles', (e) => e.reply('profiles', this.list));

    ipcMain.on(
      'profiles-update',
      (_origin: unknown, profiles: CustomProfile[]) => {
        if (!Array.isArray(profiles)) return;
        // Share links only change through share installs; clients can remove
        // official profiles but not edit them or mark their own profiles shared.
        const current = new Map(this.list.map((p) => [p.id, p]));
        const next = profiles.map((p) => {
          const existing = current.get(p?.id);
          return existing?.share?.official ? existing : { ...p, share: existing?.share };
        });
        this.setAll(next);
      },
    );

    handle('profile-export', async (_e, id: string) => {
      const profile = this.get(id);
      if (!profile) return { ok: false, error: 'Profile not found' };
      try {
        const payload = await this.buildExportPayload(profile);
        const result = await getPlatform().saveFile({
          title: 'Export Profile',
          defaultName: profile.id + '.jnprofile.json',
          content: JSON.stringify(payload, null, 2),
          filters: [{ name: 'JNbot Profile', extensions: ['json'] }],
        });
        if (result.canceled) return { ok: false, canceled: true };
        return { ok: true };
      } catch (err: any) {
        if (err?.message === 'PUBLISHER_NAME_REQUIRED') {
          return {
            ok: false,
            publisherNameRequired: true,
            fingerprint: pluginSecurity().getIdentitySummary().fingerprint,
          };
        }
        return { ok: false, error: err?.message ?? 'Failed' };
      }
    });

    handle('profile-import', async () => {
      try {
        const result = await getPlatform().openFile({
          title: 'Import Profile',
          filters: [{ name: 'JNbot Profile', extensions: ['json'] }],
        });
        if (result.canceled || !result.files.length) return { ok: false, canceled: true };
        const profile = await this.importFromContent(result.files[0].content, { promptForUnverified: true });
        if (!profile) return { ok: false, canceled: true };
        return { ok: true, profile };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? 'Failed' };
      }
    });
  }

  /** Export a portable profile without relying on an Electron save dialog. */
  async exportToPath(
    id: string,
    filePath: string,
    preparedPayload?: CustomProfile,
  ): Promise<void> {
    const profile = this.get(id);
    if (!profile) throw new Error('Profile not found');
    const payload = preparedPayload ?? await this.buildExportPayload(profile);
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  /**
   * Import a portable profile from a known path. CLI callers must opt in to
   * unverified bundles; desktop callers retain the existing confirmation UI.
   */
  async importFromContent(
    content: string,
    options: { allowUnverified?: boolean; promptForUnverified?: boolean } = {},
  ): Promise<CustomProfile | null> {
    const parsed = JSON.parse(content);
    if (!parsed?.id || !parsed?.data) throw new Error('Invalid profile file');
    const candidate = parsed as CustomProfile;
    if (!(await this.confirmBundleTrust(
      candidate,
      options.allowUnverified,
      options.promptForUnverified ?? true,
    )))
      return null;
    return this.materializeImportedBundles(candidate);
  }

  async importFromPath(
    filePath: string,
    options: { allowUnverified?: boolean; promptForUnverified?: boolean } = {},
  ): Promise<CustomProfile | null> {
    const content = await readFile(filePath, 'utf8');
    return this.importFromContent(content, options);
  }

  /** Root for per-profile bundled scripts written during import. */
  static profileScriptsRoot(profileId: string): string {
    return portablePath('profileScripts', profileId);
  }

  /**
   * Persist any inlined `scriptBundles` to disk and rewrite the matching
   * `scripts[i].source` (and `profileUiAction.source` when bundled) to
   * point at the new `bundled` paths. Stripping `scriptBundles` from the
   * returned profile keeps the runtime profiles.json file lean — bundles
   * only live on disk under the per-profile root.
   */
  private async materializeImportedBundles(
    profile: CustomProfile,
  ): Promise<CustomProfile> {
    const bundles = profile.scriptBundles ?? [];
    if (!bundles.length) {
      const { scriptBundles: _omit, ...rest } = profile;
      return portableProfile(rest as CustomProfile);
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(profile.id))
      throw new Error('Invalid profile id for bundled scripts');
    const root = Profiles_.profileScriptsRoot(profile.id);
    fs.mkdirSync(path.dirname(root), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(root), '.stage-'));

    const byScriptId = new Map(bundles.map((b) => [b.scriptId, b]));
    const writeBundle = (id: string, bundle: ProfileScriptBundle) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(id))
        throw new Error('Invalid bundled script id');
      const infoFile = `${id}.info.json`;
      const codeFile = `${id}.code.jnc`;
      fs.writeFileSync(path.join(staging, infoFile), JSON.stringify(bundle.info));
      // Bundle carries already-obfuscated bytes (base64); write them raw.
      fs.writeFileSync(
        path.join(staging, codeFile),
        //@ts-ignore
        Buffer.from(bundle.codeObf, 'base64'),
      );
      return {
        infoPath: portableScriptPath(path.join(root, infoFile)),
        codePath: portableScriptPath(path.join(root, codeFile)),
      };
    };

    const rebind = <T extends { id: string; source: any }>(s: T): T => {
      const bundle = byScriptId.get(s.id);
      if (!bundle) return s;
      const paths = writeBundle(s.id, bundle);
      return { ...s, source: { kind: 'bundled' as const, ...paths } };
    };

    try {
      const scripts = (profile.scripts ?? []).map(rebind);
      const profileUiAction = profile.profileUiAction
        ? rebind(profile.profileUiAction) : undefined;
      const botExtensionAction = profile.botExtensionAction
        ? rebind(profile.botExtensionAction) : undefined;
      const { scriptBundles: _omit, ...rest } = profile;
      const portable = portableProfile({
        ...(rest as CustomProfile), scripts,
        ...(profileUiAction ? { profileUiAction } : null),
        ...(botExtensionAction ? { botExtensionAction } : null),
      });
      const previous = fs.existsSync(root) ? `${staging}-previous` : null;
      const oldFiles = previous ? fs.readdirSync(root) : [];
      if (previous) fs.renameSync(root, previous);
      try {
        fs.renameSync(staging, root);
      } catch (error) {
        if (previous) fs.renameSync(previous, root);
        throw error;
      }
      if (previous) fs.rmSync(previous, { recursive: true, force: true });
      for (const file of new Set([...oldFiles, ...fs.readdirSync(root)])) {
        portableFileChanged(path.join(root, file));
      }
      return portable;
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Validate and materialize a package received from an already-paired host. */
  async materializeSyncedProfile(
    profile: CustomProfile,
  ): Promise<CustomProfile> {
    if (!(await this.confirmBundleTrust(profile, true, false)))
      throw new Error('The synced profile contains an invalid script signature.');
    return this.materializeImportedBundles(profile);
  }

  /**
   * Count bundled scripts in an incoming profile whose signature does not
   * verify against the maintainer key. `plugin`-kind references are
   * ignored — those resolve to the user's local library, which is gated
   * by the plugin-import flow ([[Macros_.resolveImportTrust]]).
   */
  /** Verify every inlined script bundle of an incoming profile. */
  bundleVerifications(profile: CustomProfile): Array<{
    script: ProfileScript;
    info: ProfileScriptBundle['info'];
    verification: PluginVerification;
  }> {
    const byScriptId = new Map((profile.scriptBundles ?? []).map((b) => [b.scriptId, b]));
    const candidates: ProfileScript[] = [
      ...(profile.scripts ?? []),
      ...(profile.profileUiAction ? [profile.profileUiAction] : []),
      ...(profile.botExtensionAction ? [profile.botExtensionAction] : []),
    ];
    return candidates.flatMap((script) => {
      const bundle = byScriptId.get(script.id);
      if (!bundle) return [];
      const verification = pluginSecurity().verify({
        ...(script.signature ? { format: 'jnbot-plugin', version: 2 } : {}),
        info: bundle.info,
        code: deobfuscateCodeFromBase64(bundle.codeObf),
        signature: script.signature,
      });
      return [{ script, info: bundle.info, verification }];
    });
  }

  private inspectBundleTrust(profile: CustomProfile): {
    unverified: number;
    invalid: number;
    unknownSigned: number;
    unknownPublishers: PluginVerification[];
  } {
    let unverified = 0;
    let invalid = 0;
    let unknownSigned = 0;
    const unknownPublishers = new Map<string, PluginVerification>();
    for (const { verification } of this.bundleVerifications(profile)) {
      if (verification.status !== 'trusted') unverified++;
      if (
        verification.status === 'invalid' ||
        verification.status === 'unsupported'
      ) invalid++;
      if (verification.status === 'valid-untrusted' && verification.fingerprint) {
        unknownSigned++;
        unknownPublishers.set(verification.fingerprint, verification);
      }
    }
    return { unverified, invalid, unknownSigned, unknownPublishers: [...unknownPublishers.values()] };
  }

  /**
   * One-shot trust gate at profile-import time. Returns `false` only when
   * the user cancels — anything else (signed bundle, or user accepts the
   * warning) lets the import proceed.
   */
  private async confirmBundleTrust(
    profile: CustomProfile,
    allowUnverified = false,
    promptForUnverified = true,
  ): Promise<boolean> {
    const { unverified, invalid, unknownSigned, unknownPublishers } = this.inspectBundleTrust(profile);
    if (invalid > 0) return false;
    if (allowUnverified) return true;
    if (unknownPublishers.length && !promptForUnverified) return false;
    for (const publisher of unknownPublishers) {
      const response = await showDialog({
        title: 'Unknown profile-script publisher',
        body:
          `${publisher.publisherName} signed one or more scripts in this profile. ` +
          `Publisher fingerprint: ${formatFingerprint(publisher.fingerprint ?? '')}.`,
        buttons: [
          { label: 'Trust publisher and import', type: 'primary' },
          { label: 'Import this profile once', type: 'warning' },
          { label: 'Cancel', type: 'secondary' },
        ],
      });
      if (response === 'Trust publisher and import') pluginSecurity().trustPublisher(publisher);
      else if (response !== 'Import this profile once') return false;
    }
    const remainingUnverified = unverified - unknownSigned;
    if (remainingUnverified === 0) return true;
    if (!promptForUnverified) return false;

    const s = remainingUnverified === 1 ? '' : 's';
    const response = await showDialog({
      title: 'Unverified profile scripts',
      body:
        `This profile contains ${remainingUnverified} script${s} that ${
          remainingUnverified === 1 ? 'is' : 'are'
        } not signed by a trusted publisher. Imported scripts can run ` +
        `arbitrary code on your machine. Only import profiles from ` +
        `sources you trust.`,
      buttons: [
        { label: 'Import anyway', type: 'warning' },
        { label: 'Cancel', type: 'secondary' },
      ],
    });
    return !!response && response !== 'Cancel';
  }

  close() {
    this.storage.close?.();
  }

  /**
   * Inline every script's `info` + `code` (and the profile-UI action,
   * when set) into the profile so the receiver can rebuild it without
   * network or the original plugin store. Returns the profile unchanged
   * when the resolver isn't available.
   */
  async buildExportPayload(
    profile: CustomProfile,
  ): Promise<CustomProfile> {
    const resolver = this.scripts;
    if (!resolver) return profile;
    const bundles: ProfileScriptBundle[] = [];
    const failures: string[] = [];

    // Bundle each resolved script. Keep a valid existing signature; otherwise
    // sign the bundled content with this installation's publisher identity.
    const rebind = async <T extends ProfileScript>(s: T): Promise<T> => {
      const res = await resolver.bundleForExport(s);
      if (!res) {
        failures.push(s.id || s.pluginId || 'unnamed script');
        return s;
      }
      bundles.push(res.bundle);
      return res.signature
        ? { ...s, checksum: res.checksum, signature: res.signature }
        : s;
    };

    const scripts = await Promise.all((profile.scripts ?? []).map(rebind));
    const profileUiAction = profile.profileUiAction
      ? await rebind(profile.profileUiAction)
      : undefined;
    const botExtensionAction = profile.botExtensionAction
      ? await rebind(profile.botExtensionAction)
      : undefined;

    if (failures.length) {
      throw new Error(
        `Profile export was not created. Could not resolve: ${failures.join(', ')}.`,
      );
    }

    if (!bundles.length) return profile;
    return {
      ...profile,
      scripts,
      ...(profileUiAction ? { profileUiAction } : null),
      ...(botExtensionAction ? { botExtensionAction } : null),
      scriptBundles: bundles,
    };
  }

  /** Backups include only bundled files; library plugins have their own backup. */
  async buildBackupPayload(profile: CustomProfile): Promise<CustomProfile> {
    const portable = portableProfile(profile);
    const resolver = this.scripts;
    const bundles: ProfileScriptBundle[] = [];
    const collect = async (script: ProfileScript) => {
      if (script.source.kind !== 'bundled') return;
      if (!resolver) throw new Error('Profile script resolver is unavailable');
      const result = await resolver.bundleForExport(script);
      if (!result) throw new Error(`Could not back up profile script ${script.id}`);
      bundles.push(result.bundle);
    };
    for (const script of [
      ...(portable.scripts ?? []),
      ...(portable.profileUiAction ? [portable.profileUiAction] : []),
      ...(portable.botExtensionAction ? [portable.botExtensionAction] : []),
    ]) await collect(script);
    return bundles.length ? { ...portable, scriptBundles: bundles } : portable;
  }

  /** Materialize backup bundles without an interactive trust prompt. */
  async restoreBackupProfile(profile: CustomProfile): Promise<CustomProfile> {
    if (this.inspectBundleTrust(profile).invalid)
      throw new Error('Invalid profile script signature in backup');
    return this.materializeImportedBundles(profile);
  }
}

export default Profiles_;
