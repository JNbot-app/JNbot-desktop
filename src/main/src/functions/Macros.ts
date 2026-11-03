import {
  MacroCode,
  MacroCodeJavascript,
  MacroInfo,
  MacroLanguage,
  MacroScriptType,
} from '../types';
import fs from './storage/portableFs';
import { isPortableMemoryActive } from './storage/portableFs';
import { shell } from 'electron';
import { devicePath, portablePath } from './storage/portablePaths';
import { recordingBrainName } from '../../../common/brainSpec';
import { brainDir } from '../workers/brain/recorder';
import { portableFileChanged } from './storage/PortableWrites';
import { getPlatform } from '../platform';
import path from 'path';
import { spawn } from 'child_process';
import showDialog from './actions/dialog';
import type { BotJoinActivity } from './MixpanelActivityTracker';

export interface MacroDatabase {
  user?: unknown;
  /** Records a successful bot join when the runtime has activity storage. */
  addActivity(activity: BotJoinActivity): Promise<void>;
}
import {
  MAX_PLUGIN_BUNDLE_BYTES,
  PluginSignatureV2,
  PluginVerification,
  exportablePluginInfo,
  formatFingerprint,
  pluginContentDigest,
  pluginSecurity,
} from './signing';
import generateUID from '../../UID';
import type {
  PluginImportDecision,
  PluginImportPreview,
  PluginImportResult,
  PortablePluginPackage,
} from '../../../common/mobileClientContract';
import { PLUGIN_API_TYPES } from '../../../common/pluginApiTypesSource';
import {
  createDefaultRecipeDocument,
  isRecipeDocument,
} from '../../../common/recipeV3';
import type { RecipeDocumentV3 } from '../../../common/recipeV3';
import type Settings_ from './Settings';
import {
  assertAutomationDocument,
  createAutomationDocument,
  isAutomationDocument,
  type AutomationInput,
} from '../../../common/automation';
import { AutomationDocument } from 'common/types/pluginApi';
import { PluginOptionSchema } from 'common/pluginOptions';

export function defaultRecordingConfig(inputs?: AutomationInput[]): PluginOptionSchema {
  const options: PluginOptionSchema[number]['options'] = [
    {
      id: 'account',
      label: 'Target Bot / Client',
      type: 'activeBotSelect',
      multiple: false,
      botFilter: 'all',
      tooltip: 'Select the active bot or Minecraft client to replay this recording with.',
      clearable: true,
    },
    {
      id: 'spatialMode',
      label: 'Positioning',
      type: 'select',
      defaultValue: 'absolute',
      options: [
        { label: 'Recorded world coordinates', value: 'absolute' },
        { label: 'Relative to replay start', value: 'relative' },
      ],
      tooltip: 'Whether movements are offset relative to where the bot starts or uses exact absolute coordinates.',
    },
    {
      id: 'playMode',
      label: 'Play mode',
      type: 'select',
      defaultValue: 'exact',
      options: [
        { label: 'Replay exactly', value: 'exact' },
        { label: 'Play with AI', value: 'ai' },
      ],
      tooltip: 'Replay the recorded steps exactly, or let an AI learned from your recordings react to the situation (bots only).',
    },
  ];

  if (inputs?.length) {
    for (const input of inputs) {
      options.push({
        id: input.id,
        label: input.label || input.id,
        type: 'input',
        inputType: input.secret ? 'password' : 'text',
        required: input.required,
      });
    }
  }

  return [{ name: 'Replay Settings', options }];
}

const NO_MACROS = false && process.env.NODE_ENV !== 'development';

let localMacroCache: MacroInfo[] | undefined | null;

type LegacyMacroInfo = MacroInfo & {
  folder?: unknown;
  profile?: unknown;
  containsDeveloperCode?: unknown;
};

export type PluginCollisionPolicy = 'prompt' | 'overwrite' | 'keep-both' | 'cancel';
export type PluginTrustPolicy = 'prompt' | 'allow-unverified' | 'verified-only' | 'restore';

export interface PluginImportOptions {
  collision?: PluginCollisionPolicy;
  trust?: PluginTrustPolicy;
}

export type PortablePlugin = PortablePluginPackage<
  MacroInfo,
  MacroCode,
  PluginSignatureV2
>;

export type PortablePluginPreview = PluginImportPreview<PortablePlugin>;
/** Mobile cannot use profile-UI / bot-extension plugins; share links install on desktop. */
type PortablePluginOptions = { allowDesktopTypes?: boolean };

class Macros_ {
  db: MacroDatabase;
  macros_path: string;
  private settings?: Settings_;

  constructor(db: MacroDatabase, settings?: Settings_) {
    this.db = db;
    this.settings = settings;
    this.macros_path = portablePath('macros');
    setImmediate(() => this.migratePluginMetadata());
  }

  /** Move legacy metadata out of plugin-info files without changing edits. */
  private migratePluginMetadata() {
    if (!this.settings || !fs.existsSync(this.macros_path)) return;
    const pluginMetadata = { ...this.settings.shared.pluginMetadata };
    let metadataChanged = false;
    for (const file of fs.readdirSync(this.macros_path)) {
      if (!file.startsWith('_') || !file.endsWith('.json')) continue;
      const filePath = path.join(this.macros_path, file);
      try {
        const info = JSON.parse(
          fs.readFileSync(filePath, 'utf8'),
        ) as LegacyMacroInfo;
        const hasFolder = Object.hasOwn(info, 'folder');
        const hasRemovedFields =
          Object.hasOwn(info, 'profile') ||
          Object.hasOwn(info, 'containsDeveloperCode');
        if (!hasFolder && !hasRemovedFields) continue;
        const pluginId = info.pluginId || file.slice(1, -'.json'.length);
        if (
          hasFolder &&
          typeof info.folder === 'string' &&
          info.folder &&
          !pluginMetadata[pluginId]?.folder
        ) {
          pluginMetadata[pluginId] = { folder: info.folder };
          metadataChanged = true;
        }
        info.pluginId = pluginId;
        delete info.folder;
        delete info.profile;
        delete info.containsDeveloperCode;
        fs.writeFileSync(filePath, JSON.stringify(info));
      } catch (error) {
        console.warn(`Failed to migrate plugin metadata from ${file}`, error);
      }
    }
    if (metadataChanged)
      this.settings.updateShared({ pluginMetadata });
  }

  public readPluginInfo(pluginId: string): MacroInfo | null {
    if (!pluginId) return null;
    const pluginPath = path.join(this.macros_path, '_' + pluginId + '.json');
    if (!fs.existsSync(pluginPath)) return null;
    const pluginContent = fs.readFileSync(pluginPath, 'utf-8');
    let pluginData;
    try {
      pluginData = JSON.parse(pluginContent) as LegacyMacroInfo;
    } catch (e) {
      console.log('Failed to parse plugin JSON:', e);
      return null;
    }
    pluginData.pluginId ??= this.generatePluginId();
    const info = this.stripRemovedPluginFields(pluginData);
    if (info.language === 'recording' && (!info.config || info.config.length === 0)) {
      info.config = defaultRecordingConfig();
    }
    const security = pluginSecurity().getProvenance(info.pluginId);
    return security ? { ...info, security } : info;
  }

  public setAiProvenance(
    pluginId: string,
    ai: NonNullable<import('./signing').PluginProvenance['ai']>,
  ): void {
    const provenance = pluginSecurity().getProvenance(pluginId);
    if (!provenance) throw new Error('Plugin provenance was not persisted.');
    pluginSecurity().setProvenance(pluginId, { ...provenance, ai });
    localMacroCache = null;
  }

  /**
   * The extensions a plugin's code can live under, in resolution order.
   * JS/TS plugins are stored as real script files (`<id>.js` / `<id>.ts`)
   * so they can be edited in an external editor; component plugins (and
   * legacy JS plugins) stay as `<id>.json`; recordings use
   * `<id>.recording.json`.
   */
  private static readonly CODE_EXTS = [
    '.js',
    '.ts',
    '.recording.json',
    '.json',
  ] as const;

  /** Absolute path to the code file for a plugin in the given language. */
  public codeFilePath(pluginId: string, language?: MacroLanguage): string {
    const ext =
      language === 'ts'
        ? '.ts'
        : language === 'js'
          ? '.js'
          : language === 'recording'
            ? '.recording.json'
            : '.json';
    return path.join(this.macros_path, pluginId + ext);
  }

  /** First existing on-disk code file for a plugin, or null. */
  private resolveCodeFile(pluginId: string): string | null {
    for (const ext of Macros_.CODE_EXTS) {
      const p = path.join(this.macros_path, pluginId + ext);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Persist a plugin's code. Script languages (`{ code: string }`) are
   * written as raw `.js`/`.ts` source; component canvases are written as
   * `.json`. After writing a script file, any stale alternate code files
   * are removed so a plugin only ever has one canonical code file (this is
   * also the migration path for legacy `<id>.json` JS plugins).
   */
  private writeCode(
    pluginId: string,
    code: MacroCode,
    language?: MacroLanguage,
  ) {
    const isScript = typeof (code as MacroCodeJavascript)?.code === 'string';
    if (isScript) {
      const ext = language === 'ts' ? '.ts' : '.js';
      this.writeFileAtomically(
        path.join(this.macros_path, pluginId + ext),
        (code as MacroCodeJavascript).code,
      );
      for (const stale of Macros_.CODE_EXTS) {
        if (stale === ext) continue;
        const p = path.join(this.macros_path, pluginId + stale);
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            /* best-effort cleanup */
          }
        }
      }
    } else {
      const isRecording =
        language === 'recording' || isAutomationDocument(code);
      if (isRecording) assertAutomationDocument(code);
      const targetExtension = isRecording ? '.recording.json' : '.json';
      this.writeFileAtomically(
        path.join(this.macros_path, pluginId + targetExtension),
        JSON.stringify(code),
      );
      for (const stale of Macros_.CODE_EXTS) {
        if (stale === targetExtension) continue;
        const stalePath = path.join(this.macros_path, pluginId + stale);
        if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
      }
    }
  }

  public readPlugin(pluginId: string): MacroCode | null {
    if (!pluginId) return null;
    const filePath = this.resolveCodeFile(pluginId);
    if (!filePath) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Real script files store raw source; wrap to the `{ code }` shape the
      // rest of the app expects. `.json` is a component canvas or a legacy
      // `{ code }` JS plugin — both parse straight through.
      if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
        return { code: content };
      }
      return JSON.parse(content) as MacroCode;
    } catch (e) {
      console.error('Failed to read plugin code:', e);
      return null;
    }
  }

  /**
   * Make the macros folder a TypeScript-aware project so a plugin opened in an
   * external editor gets the same autocomplete as the in-app editor. Writes a
   * shared ambient `jnbot.d.ts` (refreshed each time, so it tracks app
   * updates) and a `jsconfig.json` (written once, never clobbering user
   * tweaks). Cheap + idempotent.
   */
  ensureEditorWorkspace() {
    if (!fs.existsSync(this.macros_path)) {
      fs.mkdirSync(this.macros_path, { recursive: true });
    }
    fs.writeFileSync(
      path.join(this.macros_path, 'jnbot.d.ts'),
      PLUGIN_API_TYPES,
    );
    const jsconfig = path.join(this.macros_path, 'jsconfig.json');
    if (!fs.existsSync(jsconfig)) {
      fs.writeFileSync(
        jsconfig,
        JSON.stringify(
          {
            compilerOptions: {
              allowJs: true,
              checkJs: false,
              target: 'ES2020',
              module: 'CommonJS',
              moduleResolution: 'node',
              lib: ['ES2020'],
            },
            include: ['*.js', '*.ts', 'jnbot.d.ts'],
            exclude: ['_*.json'],
          },
          null,
          2,
        ),
      );
    }
  }

  /**
   * Open a plugin's code file in the user's external editor. When
   * `editorCommand` is set we spawn it (no shell, so a plugin path can't inject
   * shell syntax) with the macros folder + file as arguments; otherwise we fall
   * back to the OS default app for the file.
   */
  async openInExternalEditor(
    pluginId: string,
    editorCommand?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (isPortableMemoryActive())
      return { ok: false, error: 'Use the in-app editor while Dropbox storage is selected.' };
    if (!/^[a-z0-9]+$/i.test(pluginId)) {
      return { ok: false, error: 'Invalid plugin id' };
    }
    const filePath = this.resolveCodeFile(pluginId);
    if (!filePath) return { ok: false, error: 'Plugin code not found' };

    this.ensureEditorWorkspace();

    const command = editorCommand?.trim();
    if (command) {
      try {
        const child = spawn(command, [this.macros_path, filePath], {
          shell: false,
          detached: true,
          stdio: 'ignore',
        });
        // ENOENT / launch failures arrive asynchronously on detached spawns.
        child.on('error', (err) =>
          console.error('[Macros] external editor launch failed', err),
        );
        child.unref();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? 'Failed to launch editor' };
      }
    }

    const res = await shell.openPath(filePath);
    return res ? { ok: false, error: res } : { ok: true };
  }

  toList() {
    if (localMacroCache) return localMacroCache;
    let result: MacroInfo[] = [];

    if (!fs.existsSync(this.macros_path)) {
      fs.mkdirSync(this.macros_path, { recursive: true });
    }
    const files = NO_MACROS ? [] : fs.readdirSync(this.macros_path);
    // An info file `_<id>.json` lists a plugin when a matching code file
    // exists in any supported form (component/legacy `.json`, recording
    // `.recording.json`, or `.js`/`.ts`).
    let macroInfo = files.filter((f) => {
      if (!f.startsWith('_') || !f.endsWith('.json')) return false;
      const id = f.replace('_', '').replace('.json', '');
      return Macros_.CODE_EXTS.some((ext) => files.includes(id + ext));
    });
    macroInfo.forEach((file) => {
      const pluginList = this.readPluginInfo(
        file.replace('_', '').replace('.json', ''),
      );
      if (pluginList) {
        const security = pluginSecurity().getProvenance(pluginList.pluginId);
        result.push(security ? { ...pluginList, security } : pluginList);
      }
    });
    result.sort(
      (a: MacroInfo, b: MacroInfo) => (a.editedAt || 0) - (b.editedAt || 0),
    );
    localMacroCache = result;
    return result;
  }

  private clearAll() {
    if (!fs.existsSync(this.macros_path)) return;

    const pluginIds = fs
      .readdirSync(this.macros_path)
      .filter((file) => file.startsWith('_') && file.endsWith('.json'))
      .map((file) => file.slice(1, -'.json'.length));

    pluginIds.forEach((pluginId) => this.delete(pluginId));
    localMacroCache = null;
  }

  scriptActionData(
    name: string,
  ): { error: string; code: number } | { info: MacroInfo; code: MacroCode } {
    const info = this.toList().find((m) => m.name === name);
    if (!info) return { error: 'Script action not found', code: 139 };
    if (info.scriptType !== 'action' && info.language !== 'recording')
      return { error: 'Script is not an action', code: 141 };
    const { code } = this.getMacro(info.pluginId, true);
    if (!code) return { error: 'Action code not found', code: 140 };
    return { info, code };
  }

  save(pluginId: string, components: MacroCode): MacroCode | void {
    if (!components) return console.warn('no components found');
    if (!fs.existsSync(this.macros_path))
      return console.warn('did not save because plugin not found');
    // Language drives the on-disk extension for script plugins; read it from
    // the plugin's info file (the renderer only sends `{ pluginId, code }`).
    const pluginInfo = this.readPluginInfo(pluginId);
    if(!pluginInfo) return console.warn('did not save because plugin info not found');
    const language = pluginInfo?.language;
    let saved = components;
    if (language === 'recording') {
      assertAutomationDocument(components);
      const existing = this.readPlugin(pluginId);
      const existingRecording = isAutomationDocument(existing)
        ? existing
        : null;
      saved = {
        ...components,
        id: pluginId,
        name: pluginInfo.name,
        revision: existingRecording ? existingRecording.revision + 1 : 0,
        createdAt: existingRecording?.createdAt ?? components.createdAt,
        updatedAt: Date.now(),
      };
      assertAutomationDocument(saved);
      pluginInfo.config = defaultRecordingConfig(saved.inputs);
      if (pluginInfo.scriptType !== 'action') pluginInfo.scriptType = 'action';
    }
    this.writeCode(pluginId, saved, language);
    if (pluginInfo) this.saveInfo(pluginInfo);
    pluginSecurity().markModified(pluginId, pluginInfo, saved);
    localMacroCache = null;
    this.send();
    return saved;

  }

  migrateComponentsToRecipe(
    pluginId: string,
    recipe: RecipeDocumentV3,
  ): { status: 'success' | 'error'; message?: string } {
    if (!/^[a-z0-9]+$/i.test(pluginId) || !isRecipeDocument(recipe)) {
      return { status: 'error', message: 'Invalid recipe migration request' };
    }
    const current = this.readPlugin(pluginId);
    if (!current) return { status: 'error', message: 'Plugin not found' };
    if (isRecipeDocument(current)) return { status: 'success' };
    if (!('nodes' in current) || !('edges' in current)) {
      return {
        status: 'error',
        message: 'Only component graphs can be migrated',
      };
    }
    try {
      if (!fs.existsSync(this.macros_path))
        fs.mkdirSync(this.macros_path, { recursive: true });
      const backupPath = path.join(
        this.macros_path,
        `${pluginId}.components-v2.backup.json`,
      );
      if (!fs.existsSync(backupPath)) {
        fs.writeFileSync(backupPath, JSON.stringify(current));
      }
      const targetPath = this.codeFilePath(pluginId, 'components');
      const temporaryPath = `${targetPath}.recipe-migration.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(recipe));
      fs.renameSync(temporaryPath, targetPath);
      localMacroCache = null;
      return { status: 'success' };
    } catch (error: any) {
      return {
        status: 'error',
        message: error?.message ?? 'Failed to migrate plugin',
      };
    }
  }

  delete(pluginId: string) {
    if (!pluginId) return;
    for (const ext of Macros_.CODE_EXTS) {
      const p = path.join(this.macros_path, pluginId + ext);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const infoPath = path.join(this.macros_path, '_' + pluginId + '.json');
    if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
    fs.rmSync(brainDir(devicePath('ai'), recordingBrainName(pluginId)), {
      recursive: true,
      force: true,
    });
    pluginSecurity().deleteProvenance(pluginId);
    localMacroCache = null;
  }

  saveInfo(pluginInfo: MacroInfo) {
    if (!pluginInfo?.pluginId)
      return console.error('Did not save plugin because invalid!');
    const info = this.stripRemovedPluginFields(pluginInfo);
    info.editedAt = Date.now();
    fs.writeFileSync(
      path.join(this.macros_path, '_' + info.pluginId + '.json'),
      JSON.stringify(info),
    );
    const code = this.readPlugin(info.pluginId);
    if (code) pluginSecurity().markModified(info.pluginId, info, code);
    localMacroCache = null;
  }

  invalidateLocalCache() {
    localMacroCache = null;
    this.send();
  }

  create({
    name,
    description,
    language,
    scriptType,
    folder,
  }: {
    name: string;
    description: string;
    language: MacroLanguage;
    scriptType: MacroScriptType;
    folder?: string;
  }) {
    if (!fs.existsSync(this.macros_path)) {
      fs.mkdirSync(this.macros_path, { recursive: true });
    }
    let macroInfo: MacroInfo;
    try {
      macroInfo = this.generateMacroDetails({
        name,
        description,
        language,
        scriptType,
      });
      this.writeMacroToFile(
        macroInfo,
        defaultMacro(language, scriptType, macroInfo),
      );
      const createdCode = this.readPlugin(macroInfo.pluginId);
      if (createdCode) {
        pluginSecurity().setProvenance(macroInfo.pluginId, {
          status: 'local',
          contentDigest: pluginContentDigest(macroInfo, createdCode),
          installedAt: Date.now(),
        });
      }
      if (folder && this.settings) {
        this.settings.updateShared({
          pluginMetadata: {
            ...this.settings.shared.pluginMetadata,
            [macroInfo.pluginId]: { folder },
          },
        });
      }
      localMacroCache = null;
    } catch (e) {
      console.error(e);
      return { status: 'error', message: 'Failed to create plugin' };
    }
    return { ...(macroInfo ?? {}), status: 'success' };
  }

  importLegacyRecording(
    document: AutomationDocument,
  ): MacroInfo {
    assertAutomationDocument(document);
    const preferredId = document.id.replace(/[^a-z0-9]/gi, '');
    const existing = preferredId ? this.readPluginInfo(preferredId) : null;
    if (existing?.language === 'recording') return existing;
    const info = this.generateMacroDetails({
      pluginId: existing ? undefined : preferredId || undefined,
      name: document.name,
      description: 'Recorded Minecraft task',
      language: 'recording',
      scriptType: 'script',
    });
    const code = {
      ...document,
      id: info.pluginId,
      name: info.name,
    };
    this.writeMacroToFile(info, code);
    pluginSecurity().setProvenance(info.pluginId, {
      status: 'local',
      contentDigest: pluginContentDigest(info, code),
      installedAt: Date.now(),
    });
    localMacroCache = null;
    return info;
  }

  /**
   * Clone a plugin into a brand-new one: same code, theme and option
   * *schema*, fresh `pluginId`. Because user-set option values live in
   * `settings.scripts[pluginId]`, the new id alone guarantees the copy
   * starts with default values. The clone gets local provenance and drops
   * public/download state.
   */
  duplicate(pluginId: string) {
    const info = this.readPluginInfo(pluginId);
    const code = this.readPlugin(pluginId);
    if (!info || !code) return { status: 'error', message: 'Plugin not found' };

    const copy: MacroInfo = {
      ...this.defaultPluginInfo({
        name: `${info.name} (copy)`,
        description: info.description,
        language: info.language,
        scriptType: info.scriptType,
        theme: info.theme,
        banner: info.banner,
        config: info.config,
      }),
    };
    this.writeMacroToFile(copy, code);
    pluginSecurity().setProvenance(copy.pluginId, {
      status: 'local',
      contentDigest: pluginContentDigest(copy, code),
      installedAt: Date.now(),
    });
    const folder = this.settings?.shared.pluginMetadata[pluginId]?.folder;
    if (folder && this.settings) {
      this.settings.updateShared({
        pluginMetadata: {
          ...this.settings.shared.pluginMetadata,
          [copy.pluginId]: { folder },
        },
      });
    }
    localMacroCache = null;
    this.send();
    return { ...copy, status: 'success' };
  }

  getScriptActions(): MacroInfo[] {
    return this.toList().filter((m) => m.scriptType === 'action');
  }

  getMacro(
    pluginId: string,
    macroCodeOnly: boolean = false,
  ):
    | { info: MacroInfo | null; code: MacroCode; status: 'success' }
    | { error: string; status?: 'error'; code?: null } {
    let pluginInfo: MacroInfo | null = null;
    let pluginCode: MacroCode | null = null;
    if (!macroCodeOnly) {
      pluginInfo = this.readPluginInfo(pluginId);
      if (!pluginInfo) {
        return {
          error: 'Failed to read plugin info',
          status: 'error',
          code: null,
        };
      }
      if (pluginInfo && !pluginInfo.scriptType)
        pluginInfo.scriptType = 'script';
    }
    pluginCode = this.readPlugin(pluginId);
    if (!pluginCode) {
      return {
        error: 'Failed to read plugin code',
        status: 'error',
        code: null,
      };
    }

    return {
      info: pluginInfo as MacroInfo,
      code: pluginCode,
      status: 'success',
    };
  }

  private writeMacroToFile(macroInfo: MacroInfo, components?: MacroCode) {
    const info = this.stripRemovedPluginFields(macroInfo);
    this.writeFileAtomically(
      path.join(this.macros_path, '_' + info.pluginId + '.json'),
      JSON.stringify(info),
    );
    if (components) {
      this.writeCode(info.pluginId, components, info.language);
    }
  }

  /** A failed write can never leave a truncated plugin source or info file. */
  private writeFileAtomically(filePath: string, content: string) {
    if (!fs.existsSync(this.macros_path)) fs.mkdirSync(this.macros_path, { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, content, { mode: 0o600 });
      fs.renameSync(temporary, filePath);
      portableFileChanged(filePath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  private stripRemovedPluginFields(pluginInfo: LegacyMacroInfo): MacroInfo {
    const {
      profile: _profile,
      containsDeveloperCode: _containsDeveloperCode,
      security: _security,
      ...info
    } = pluginInfo;
    return info;
  }

  private generateMacroDetails(pluginInfo: Partial<MacroInfo>) {
    const { folder: _folder, ...info } = pluginInfo as Partial<MacroInfo> & {
      folder?: unknown;
    };
    info.pluginId ??= this.generatePluginId();
    return this.defaultPluginInfo(info);
  }

  private generatePluginId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).substring(2, 15)
    );
  }

  public findPlugin(pluginId: string) {
    const plugins = this.toList();
    return plugins.find((p) => p.pluginId === pluginId) || null;
  }

  /**
   * Serialize one installed plugin for a paired mobile device. `sign` signs
   * content without a valid signature with this installation's publisher key
   * (share links), instead of sending it unsigned.
   */
  exportPortablePlugin(pluginId: string, { sign = false } = {}): PortablePlugin {
    if (!/^[a-z0-9_-]+$/i.test(pluginId)) throw new Error('Invalid plugin id.');
    const info = this.findPlugin(pluginId);
    const code = this.readPlugin(pluginId);
    if (!info || !code) throw new Error('Plugin not found.');
    const portableInfo = exportablePluginInfo(this.stripRemovedPluginFields(info));
    const revision = pluginContentDigest(portableInfo, code);
    if (sign) {
      return {
        version: 1,
        source: { ownerId: generateUID(), pluginId },
        revision,
        exportedAt: Date.now(),
        bundle: pluginSecurity().bundleForExport(portableInfo, code),
      };
    }
    const provenance = pluginSecurity().getProvenance(pluginId);
    const candidate = provenance?.contentDigest === revision
      ? provenance.signature
      : undefined;
    // A matching local digest alone does not prove the original signature
    // survived metadata migrations or code serialization.
    const verification = candidate && pluginSecurity().verify({
      format: 'jnbot-plugin', version: 2, info: portableInfo, code, signature: candidate,
    });
    const signature = verification &&
      (verification.status === 'trusted' || verification.status === 'valid-untrusted')
      ? candidate
      : undefined;
    return {
      version: 1,
      source: { ownerId: generateUID(), pluginId },
      revision,
      exportedAt: Date.now(),
      bundle: {
        ...(signature && typeof signature === 'object'
          ? { format: 'jnbot-plugin' as const, version: 2 as const }
          : {}),
        info: portableInfo,
        code,
        ...(signature ? { signature } : {}),
      },
    };
  }

  parsePortablePlugin(input: unknown): PortablePlugin {
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        throw new Error("Invalid JSON format.");
      }
    }
    if (!input || typeof input !== "object") {
      throw new Error("Invalid plugin payload.");
    }
    const record = input as Record<string, any>;
    if (
      record.version === 1 &&
      record.source &&
      typeof record.source.pluginId === "string" &&
      record.bundle?.info &&
      record.bundle?.code &&
      typeof record.revision === "string"
    ) {
      return record as PortablePlugin;
    }
    const info: MacroInfo = record.info;
    const code: MacroCode = record.code ?? record.components;
    if (!info || typeof info !== "object") {
      throw new Error("Plugin is missing metadata header (info).");
    }
    if (!info.name || typeof info.name !== "string" || !info.name.trim()) {
      throw new Error("Plugin is missing a name.");
    }
    if (!code || (typeof code !== "object" && typeof code !== "string")) {
      throw new Error("Plugin is missing code contents.");
    }

    const pluginId =
      typeof info.pluginId === "string" && /^[a-z0-9_-]+$/i.test(info.pluginId)
        ? info.pluginId
        : this.generatePluginId();

    const signature = record.signature;
    const isV2 = record.format === "jnbot-plugin" && record.version === 2;
    // Signed contents must reach verification exactly as received. Defaults are
    // only for unsigned legacy files, never part of signature verification.
    const signed = isV2 || Boolean(signature);
    const completeInfo: MacroInfo = signed ? info : {
      ...info,
      pluginId,
      name: String(info.name).slice(0, 200),
      description: typeof info.description === "string" ? info.description : "",
      scriptType: info.scriptType ?? "script",
      language: info.language ?? "js",
      public: false,
      createdAt: typeof info.createdAt === "number" ? info.createdAt : Date.now(),
      editedAt: null,
    };

    const portableInfo = signed ? info : exportablePluginInfo(completeInfo);
    const normalizedCode: MacroCode = !signed && typeof code === "string" ? { code } : code;
    const revision = pluginContentDigest(portableInfo, normalizedCode);

    return {
      version: 1,
      source: {
        ownerId: "local-file",
        pluginId: completeInfo.pluginId,
      },
      revision,
      exportedAt: Date.now(),
      bundle: {
        ...(signed
          ? { format: record.format ?? "jnbot-plugin", version: record.version ?? 2 }
          : {}),
        info: portableInfo,
        code: normalizedCode,
        ...(signature ? { signature } : {}),
      },
    };
  }

  previewPortablePlugins(
    packages: (PortablePlugin | string | Record<string, unknown>)[],
    options: PortablePluginOptions = {},
  ): PortablePluginPreview[] {
    return packages.map((item) => {
      try {
        const parsed = this.parsePortablePlugin(item);
        return this.previewPortablePlugin(parsed, options);
      } catch (err: any) {
        return {
          package: (typeof item === "object" && item !== null
            ? item
            : {
                version: 1,
                source: { ownerId: "local-file", pluginId: "invalid" },
                revision: "",
                exportedAt: Date.now(),
                bundle: {
                  info: {
                    name: "Invalid plugin",
                    pluginId: "invalid",
                    description: "",
                    scriptType: "script",
                    createdAt: Date.now(),
                    editedAt: null,
                    public: false,
                  },
                  code: {},
                },
              }) as PortablePlugin,
          state: "invalid",
          verification: "invalid",
          reason: err?.message ?? "Invalid plugin package.",
        };
      }
    });
  }

  async importPortablePlugins(
    packages: (PortablePlugin | string | Record<string, unknown>)[],
    decisions: PluginImportDecision[],
    options: PortablePluginOptions = {},
  ): Promise<PluginImportResult> {
    const normalizedPackages = packages
      .map((item) => {
        try {
          return this.parsePortablePlugin(item);
        } catch {
          return null;
        }
      })
      .filter((item): item is PortablePlugin => item !== null);

    const result: PluginImportResult = { installed: [], skipped: [], failed: [] };
    const decisionByKey = new Map(
      decisions.map((item) => [
        `${item.ownerId}:${item.pluginId}:${item.revision}`,
        item,
      ]),
    );
    for (const item of normalizedPackages) {
      const preview = this.previewPortablePlugin(item, options);
      const key = `${item.source.ownerId}:${item.source.pluginId}:${item.revision}`;
      const decision = decisionByKey.get(key);
      try {
        if (preview.state === 'invalid' || preview.state === 'unsupported') {
          result.skipped.push({ pluginId: item.source.pluginId, reason: preview.reason ?? 'Plugin cannot be imported.' });
          continue;
        }
        if (preview.state === 'identical') {
          result.skipped.push({ pluginId: item.source.pluginId, reason: 'Already up to date.' });
          continue;
        }
        if (!decision || decision.action === 'skip') {
          result.skipped.push({ pluginId: item.source.pluginId, reason: 'Skipped.' });
          continue;
        }
        if (
          (preview.verification === 'unsigned' || preview.verification === 'valid-untrusted') &&
          !decision.acceptUnverified
        ) {
          result.skipped.push({ pluginId: item.source.pluginId, reason: 'Unverified plugin was not confirmed.' });
          continue;
        }
        const mode = decision.action === 'keep-both' ? 'Keep both' : 'Overwrite';
        const incomingInfo = structuredClone(item.bundle.info);
        const imported = await this._importPlugin(
          incomingInfo,
          item.bundle.code,
          mode,
          item.bundle.signature,
          'allow-unverified',
        );
        if (imported.status !== 'success') {
          result.failed.push({ pluginId: item.source.pluginId, error: imported.message ?? 'Import failed.' });
          continue;
        }
        const installedPluginId = incomingInfo.pluginId;
        const provenance = pluginSecurity().getProvenance(installedPluginId);
        if (provenance) {
          pluginSecurity().setProvenance(installedPluginId, {
            ...provenance,
            importSource: {
              ownerId: item.source.ownerId,
              pluginId: item.source.pluginId,
              revision: item.revision,
              importedAt: Date.now(),
            },
          });
        }
        result.installed.push({
          sourcePluginId: item.source.pluginId,
          installedPluginId,
          outcome: decision.action === 'keep-both'
            ? 'duplicated'
            : preview.state === 'conflict'
              ? 'replaced'
              : 'installed',
        });
      } catch (error) {
        result.failed.push({
          pluginId: item.source.pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.invalidateLocalCache();
    return result;
  }

  private previewPortablePlugin(
    item: PortablePlugin,
    { allowDesktopTypes = false }: PortablePluginOptions = {},
  ): PortablePluginPreview {
    const invalid = (reason: string): PortablePluginPreview => ({
      package: item,
      state: 'invalid',
      verification: 'invalid',
      reason,
    });
    if (!item || item.version !== 1 || !item.source || !/^[a-z0-9_-]+$/i.test(item.source.pluginId))
      return invalid('Invalid plugin package.');
    if (Buffer.byteLength(JSON.stringify(item), 'utf8') > MAX_PLUGIN_BUNDLE_BYTES)
      return invalid('Plugin package is too large.');
    const { info, code, signature, format, version } = item.bundle ?? {};
    if (!info || !code) return invalid('Plugin package is missing code.');
    const verification = pluginSecurity().verify({ format, version, info, code, signature });
    if (verification.status === 'invalid' || verification.status === 'unsupported')
      return invalid(verification.reason ?? 'Plugin signature is invalid.');
    if (pluginContentDigest(info, code) !== item.revision)
      return invalid('Plugin contents do not match the declared revision.');
    if (info.pluginId !== item.source.pluginId)
      return invalid('Plugin identity does not match the package source.');
    if (
      !allowDesktopTypes &&
      (info.scriptType === 'profileUi' || info.scriptType === 'botExtension')
    ) {
      return {
        package: item,
        state: 'unsupported',
        verification: verification.status,
        reason: 'This plugin type is not supported on JNbot Mobile.',
      };
    }
    const current = this.findPlugin(info.pluginId);
    const currentCode = current && this.readPlugin(current.pluginId);
    const state = current && currentCode && pluginContentDigest(current, currentCode) === item.revision
      ? 'identical'
      : current ? 'conflict' : 'new';
    return {
      package: item,
      state,
      verification: verification.status,
      publisherName: verification.publisherName,
      fingerprint: verification.fingerprint,
    };
  }

  async export(
    macroInfo: MacroInfo,
    code: MacroCode,
  ): Promise<{ status: 'success' | 'cancelled' | 'publisher-name-required' | 'error'; message?: string; identity?: ReturnType<ReturnType<typeof pluginSecurity>['getIdentitySummary']> }> {
    if (!macroInfo.pluginId || !code)
      return { status: 'error', message: 'Invalid plugin info or code' };

    let serialized: string;
    try {
      serialized = this.pluginToJson(macroInfo, code);
    } catch (error: any) {
      if (error?.message === 'PUBLISHER_NAME_REQUIRED') {
        return {
          status: 'publisher-name-required',
          identity: pluginSecurity().getIdentitySummary(),
        };
      }
      return { status: 'error', message: error?.message ?? 'Failed to sign plugin' };
    }

    const response = await getPlatform().saveFile({
      title: 'Select the File Path to save',
      defaultName: macroInfo.name + '.jnp',
      content: serialized,
      filters: [
        {
          name: 'JNbot script',
          extensions: ['jnp'],
        },
      ],
    });
    if (!response.canceled) {
      return { status: 'success' };
    }
    return { status: 'cancelled' };
  }

  /** Export an installed plugin to an explicit path for non-Electron callers. */
  exportToPath(pluginId: string, filePath: string): void {
    const info = this.findPlugin(pluginId);
    const code = info && this.readPlugin(pluginId);
    if (!info || !code) throw new Error('Plugin not found');
    fs.writeFileSync(filePath, this.pluginToJson(info, code));
  }

  private pluginToJson(
    macroInfo: MacroInfo,
    code: MacroCode,
    fullPluginInfo?: boolean,
    allowUnsigned?: boolean,
  ) {
    const info = fullPluginInfo
      ? exportablePluginInfo(this.stripRemovedPluginFields(macroInfo))
      : exportablePluginInfo({
          name: macroInfo.name,
          description: macroInfo.description,
          language: macroInfo.language,
          scriptType: macroInfo.scriptType,
          pluginId: macroInfo.pluginId,
          theme: macroInfo.theme,
          config: macroInfo.config,
          banner: macroInfo.banner,
          createdAt: macroInfo.createdAt,
          editedAt: null,
          public: false,
        });
    return JSON.stringify(
      pluginSecurity().bundleForExport(info, code, { allowUnsigned }),
    );
  }

  private async resolveImportTrust(
    verification: PluginVerification,
  ): Promise<'trusted' | 'accepted-once' | 'unsigned' | 'modified' | null> {
    if (verification.status === 'trusted') return 'trusted';
    if (verification.status === 'unsupported') return null;
    if (verification.status === 'invalid') {
      const response = await showDialog({
        title: 'Modified plugin',
        body:
          `"${verification.info?.name}" could not be verified: ${verification.reason ?? 'the signature does not match the current content'}. ` +
          'Only import this exact version when you trust its source.',
        buttons: [
          { label: 'Import this version once', type: 'primary' },
          { label: 'Cancel', type: 'default' },
        ],
      });
      return response === 'Import this version once' ? 'modified' : null;
    }
    if (verification.status === 'valid-untrusted') {
      const response = await showDialog({
        title: 'Unknown plugin publisher',
        body:
          `"${verification.info?.name}" is signed by ${verification.publisherName}. ` +
          `Publisher fingerprint: ${formatFingerprint(verification.fingerprint ?? '')}. ` +
          'Publisher names are self-asserted; compare the fingerprint with a trusted source.',
        buttons: [
          { label: 'Trust publisher and import', type: 'primary' },
          { label: 'Import this version once', type: 'default' },
          { label: 'Cancel', type: 'default' },
        ],
      });
      if (response === 'Trust publisher and import') {
        pluginSecurity().trustPublisher(verification);
        return 'trusted';
      }
      return response === 'Import this version once' ? 'accepted-once' : null;
    }
    const response = await showDialog({
      title: 'Unsigned plugin',
      body:
        `"${verification.info?.name}" has no signature. Plugins can run arbitrary code on your machine. ` +
        'Only import it when you trust the source.',
      buttons: [
        { label: 'Import this version once', type: 'primary' },
        { label: 'Cancel', type: 'default' },
      ],
    });
    return response === 'Import this version once' ? 'unsigned' : null;
  }

  async _importPlugin(
    pluginInfo: MacroInfo,
    code: MacroCode,
    mode: 'auto' | 'Overwrite' | 'Keep both' = 'auto',
    signature?: string | PluginSignatureV2,
    trustPolicy: PluginTrustPolicy = 'prompt',
  ) {
    if (!pluginInfo || !code)
      return { status: 'error', message: 'Invalid file' };

    const signedPluginId = pluginInfo.pluginId;
    const raw = signature
      ? { format: 'jnbot-plugin', version: 2, info: pluginInfo, code, signature }
      : { info: pluginInfo, code };
    const verification = pluginSecurity().verify(raw);
    if (
      verification.status === 'unsupported' ||
      (trustPolicy === 'restore' && verification.status === 'invalid')
    ) {
      return { status: 'error', message: verification.reason ?? 'Plugin signature is invalid' };
    }
    if (trustPolicy === 'verified-only' && verification.status !== 'trusted') {
      return { status: 'cancelled', message: 'Plugin is not signed by a trusted publisher' };
    }
    const contentDigest = pluginContentDigest(pluginInfo, code);
    const accepted = pluginSecurity().getProvenance(pluginInfo.pluginId);
    const decision = accepted?.contentDigest === contentDigest &&
      (accepted.status === 'accepted-once' ||
        accepted.status === 'unsigned' ||
        accepted.status === 'modified')
      ? accepted.status
      : trustPolicy === 'allow-unverified' || trustPolicy === 'restore'
      ? verification.status === 'trusted'
        ? 'trusted'
        : verification.status === 'unsigned'
          ? 'unsigned'
          : verification.status === 'invalid'
            ? 'modified'
          : 'accepted-once'
      : await this.resolveImportTrust(verification);
    if (!decision) return { status: 'cancelled', message: 'Cancelled import' };
    if (pluginInfo.trust) {
      delete (pluginInfo as Partial<MacroInfo>).trust;
    }
    if (pluginInfo.security) {
      delete (pluginInfo as Partial<MacroInfo>).security;
    }

    // See if plugin already exists in your list
    const macro = this.findPlugin(pluginInfo.pluginId);
    if (macro) {
      if (mode === 'auto') {
        const response = await showDialog({
          title: macro.name + ' already exists',
          body: '',
          buttons: [
            { label: 'Overwrite', type: 'primary' },
            { label: 'Keep both', type: 'default' },
            { label: 'Cancel', type: 'default' },
          ],
        });
        if (!response || response === 'Cancel')
          return { status: 'error', message: 'Cancelled import' };
        mode = response as 'Overwrite' | 'Keep both';
      }
      if (mode === 'Overwrite') {
        this.writeMacroToFile(pluginInfo, code);
        pluginSecurity().setProvenance(pluginInfo.pluginId, {
          status: decision,
          fingerprint: verification.fingerprint,
          publisherName: verification.publisherName,
          signature: verification.signature,
          contentDigest: pluginContentDigest(pluginInfo, code),
          installedAt: Date.now(),
        });

        localMacroCache = null;
        this.send();

        return {
          status: 'success',
          message: 'Plugin successfully overwritten',
        };
      }

      if (mode === 'Keep both') {
        pluginInfo.pluginId = this.generatePluginId();
      }
    }
    // Rebuilding verified metadata would invalidate the publisher signature on
    // the next export (timestamps, defaults, and legacy fields can all differ).
    if (verification.status !== 'trusted' && verification.status !== 'valid-untrusted') {
      pluginInfo = this.generateMacroDetails(pluginInfo);
    }
    this.writeMacroToFile(pluginInfo, code);
    pluginSecurity().setProvenance(pluginInfo.pluginId, {
      status: pluginInfo.pluginId === signedPluginId ? decision : 'modified',
      fingerprint: verification.fingerprint,
      publisherName: verification.publisherName,
      signature:
        pluginInfo.pluginId === signedPluginId
          ? verification.signature
          : undefined,
      contentDigest: pluginContentDigest(pluginInfo, code),
      installedAt: Date.now(),
    });
    localMacroCache = null;
    this.send();
    return { status: 'success', message: 'Plugin imported successfully' };
  }

  public send() {
    global.send('MACROS', this.toList());
  }

  async importFile(file: string) {
    return this.importFileWithOptions(file);
  }

  async importFileWithOptions(
    file: string,
    options: PluginImportOptions = {},
  ) {
    try {
      if (fs.statSync(file).size > MAX_PLUGIN_BUNDLE_BYTES) {
        return { status: 'error', message: 'Plugin file is too large' };
      }
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const macroInfo: MacroInfo = data.info;
      const code: MacroCode = data.code;
      const signature: string | PluginSignatureV2 | undefined = data.signature;

      if (!macroInfo || !code)
        return { status: 'error', message: 'Invalid file' };

      const collision = options.collision ?? 'prompt';
      if (collision === 'cancel')
        return { status: 'cancelled', message: 'Cancelled import' };
      const mode = collision === 'overwrite'
        ? 'Overwrite'
        : collision === 'keep-both'
          ? 'Keep both'
          : 'auto';
      return this._importPlugin(
        macroInfo,
        code,
        mode,
        signature,
        options.trust ?? 'prompt',
      );
    } catch (err) {
      console.error(err);
      return { status: 'error', message: 'Failed to read macro' };
    }
  }

  importFromContent(
    content: string,
    options: PluginImportOptions = {},
  ) {
    try {
      if (Buffer.byteLength(content, 'utf8') > MAX_PLUGIN_BUNDLE_BYTES) {
        return { status: 'error', message: 'Plugin file is too large' };
      }
      const data = JSON.parse(content);
      const macroInfo: MacroInfo = data.info;
      const code: MacroCode = data.code;
      const signature: string | PluginSignatureV2 | undefined = data.signature;

      if (!macroInfo || !code)
        return { status: 'error', message: 'Invalid file' };

      const collision = options.collision ?? 'prompt';
      if (collision === 'cancel')
        return { status: 'cancelled', message: 'Cancelled import' };
      const mode = collision === 'overwrite'
        ? 'Overwrite'
        : collision === 'keep-both'
          ? 'Keep both'
          : 'auto';
      return this._importPlugin(
        macroInfo,
        code,
        mode,
        signature,
        options.trust ?? 'prompt',
      );
    } catch (err) {
      console.error(err);
      return { status: 'error', message: 'Failed to read macro' };
    }
  }

  async import(): Promise<{ status: string; message: string }> {
    const response = await getPlatform().openFile({
      title: 'Select the JNbot script you want to import',
      filters: [
        {
          name: 'JNbot script',
          extensions: ['jnp'],
        },
      ],
    });
    if (!response.canceled && response.files.length) {
      return this.importFromContent(response.files[0].content);
    }
    return { status: 'cancelled', message: '' };
  }

  defaultPluginInfo(pluginInfo: Partial<MacroInfo>): MacroInfo {
    const isRecording = pluginInfo.language === 'recording';
    return {
      name: pluginInfo.name || 'noname',
      description: pluginInfo.description || '',
      editedAt: Date.now(),
      createdAt: Date.now(),
      public: false,
      language: pluginInfo.language || 'components',
      scriptType: isRecording ? 'action' : (pluginInfo.scriptType || 'script'),
      downloads: 0,
      theme: pluginInfo.theme || {
        primaryColor: '#2193b0',
        secondaryColor: '#6dd5ed',
        accentColor: '#2193b0',
        gradientStart: '#2193b0',
        gradientEnd: '#6dd5ed',
        tagColor: '#6dd5ed',
      },
      banner: pluginInfo.banner || undefined,
      config: pluginInfo.config || (isRecording ? defaultRecordingConfig() : undefined),
      pluginId: pluginInfo.pluginId || this.generatePluginId(),
    };
  }

  toJSON(options: { allowUnsigned?: boolean } = { allowUnsigned: true }) {
    if (!fs.existsSync(this.macros_path)) return JSON.stringify([]);

    const plugins: string[] = [];
    const failures: string[] = [];
    const pluginIds = fs
      .readdirSync(this.macros_path)
      .filter((file) => file.startsWith('_') && file.endsWith('.json'))
      .map((file) => file.slice(1, -'.json'.length));

    for (const pluginId of pluginIds) {
      const pluginInfo = this.readPluginInfo(pluginId);
      if (!pluginInfo) {
        failures.push(`${pluginId}: metadata is unreadable`);
        continue;
      }
      const pluginCode = this.readPlugin(pluginId);
      if (!pluginCode) {
        failures.push(`${pluginInfo.name || pluginId}: Missing code`);
        continue;
      }
      try {
        plugins.push(
          this.pluginToJson(
            pluginInfo,
            pluginCode,
            true,
            options?.allowUnsigned ?? true,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${pluginInfo.name || pluginId}: ${message}`);
      }
    }

    if (failures.length) {
      console.error(`[backup warnings]: ${failures.join('; ')}`);
    }
    return JSON.stringify(plugins);
  }

  async fromJSON(
    jsonString: string,
    trustPolicy: PluginTrustPolicy = 'restore',
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      console.error('Skipping invalid plugin backup payload.');
      return;
    }
    if (!Array.isArray(parsed)) {
      console.error('Skipping invalid plugin backup payload.');
      return;
    }
    const plugins = parsed;

    this.clearAll();

    for (const pluginJson of plugins) {
      try {
        const data = (typeof pluginJson === 'string'
          ? JSON.parse(pluginJson)
          : pluginJson) as {
          info?: MacroInfo;
          code?: MacroCode;
          signature?: PluginSignatureV2;
        };
        if (!data?.info || !data?.code) {
          console.error('Skipping invalid plugin in backup.');
          continue;
        }

        const pluginInfo: MacroInfo = { ...data.info };
        delete pluginInfo.trust;
        delete pluginInfo.security;
        const result = await this._importPlugin(
          pluginInfo,
          data.code,
          'Overwrite',
          data.signature,
          trustPolicy,
        );
        if (result.status !== 'success') {
          console.error(
            `Failed to restore plugin "${pluginInfo.name}".`,
            result,
          );
        }
      } catch (error) {
        console.error('Skipping malformed plugin in backup.', error);
      }
    }

    this.send();
  }
}

function defaultMacro(
  language: MacroLanguage,
  scriptType: MacroScriptType,
  info: Pick<MacroInfo, 'pluginId' | 'name'>,
): MacroCode {
  if (language === 'components') {
    return createDefaultRecipeDocument();
    // if (scriptType === 'script') return s.script;
    // else if (scriptType === "action") return s.action
  } else if (language === 'recording') {
    return createAutomationDocument({ id: info.pluginId, name: info.name });
  } else if (language === 'js' || language === 'ts') {
    if (scriptType === 'script')
      return {
        code: `
const { script, join } = require('jnbot');


const { response: username } = await script.prompt({
  title: "Alt",
  label: "With what alt would you like to join?"
})

console.log("Joining with " + username)

const bot = await join({ username }, { login: true, gamemode: "skyblockdream" })

bot.on("messagestr", (m) => console.log(m.toString()))`,
      };
    else if (scriptType === 'action')
      return {
        code: `
async function main(bot, options) {
  // Your code here

}
      `,
      };
    else if (scriptType === 'profileUi')
      return {
        code: `// Profile-UI action — runs in a sandbox and returns a description of
// the player drawer. Compose the page with the \`ProfileBuilder\` API
// (autocomplete will hint the available methods). \`args\` carries the
// alt, serverAltInfo, stats, fetch helper, etc.
async function main(args) {
  const { username, alt, serverAltInfo, stats } = args;

  // --- derive a few values from the local alt data ----------------------

  const ranks = Object.entries(serverAltInfo?.ranks ?? {})
    .filter(([, name]) => !!name);                              // [server, rank][]
  const gkitGroups = Object.entries(serverAltInfo?.gkits ?? {})
    .filter(([, items]) => items.length);                        // [gm, items][]
  const totalGkits = gkitGroups.reduce((n, [, items]) => n + items.length, 0);

  // --- optional: enrich from an external API ----------------------------
  //
  // \`args.fetch\` is a sandboxed http/https client. It returns
  // { status, ok, text, json } and is rate-limited to 1 MiB + 6 s.
  //
  // const res = await args.fetch(
  //   "https://stats.example.com/api/profile/" + username,
  // );
  // const remote = res.ok ? res.json : null;

  // --- compose the page -------------------------------------------------

  const profile = new ProfileBuilder().player({
    username,
    displayName: username,
    // displayRank: 'Warrior',
  });

  // Identity card — skin, badges, headline counts.
  const id = profile.identity('left');
  if (serverAltInfo?.premium) id.badge('premium', 'emerald');
  id.count('ranks', ranks.length)
    .count('gkits', totalGkits);

  // KPI strip — three small tiles in the right column.
  profile.kpis('right')
    .item('times joined', String(stats?.joinCount ?? 0), { icon: 'hash',  tone: 'emerald' })
    .item('play time',    formatDuration(stats?.playTime ?? 0), { icon: 'clock', tone: 'rose' });

  // Ranks grid.
  if (ranks.length) {
    const r = profile.ranks('right');
    ranks.forEach(([server, name]) => r.add(name, server, 'emerald'));
  }

  // Stats card — clicking a gamemode tile swaps its breakdown.
  // const s = profile.stats('right');
  // s.gamemode('skyblockdream', 'Skyblock Dream', { icon: '🏝️' })
  //   .add('Coins',  '128k', { rank: '#142', delta: '+5k' })
  //   .add('Island', 'Lv 42');
  // s.gamemode('kitpvp', 'KitPvP', { icon: '🛡️' })
  //   .add('Kills',  '12,847', { rank: '#142', delta: '+318' })
  //   .add('Deaths', '4,210',  { rank: '#1,902', delta: '+87' });
  // s.selected('kitpvp');

  // Gkits, grouped by gamemode.
  if (gkitGroups.length) {
    const g = profile.gkits('left');
    gkitGroups.forEach(([gamemode, items]) => g.group(gamemode, items));
  }

  return profile.build();
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return d + 'd ' + (h % 24) + 'h';
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  return m + 'm';
}
`,
      };
    else if (scriptType === 'botExtension')
      return {
        code: `// Bot extension — runs once per bot instance, loaded as the LAST
// plugin for this server. Use it to override built-in bot
// methods, attach event listeners, or expose new APIs on the bot.
//
// Like actions, define a main(bot, options) function:
// You have full access to the bot instance and may mutate it.

function main(bot, options) {
  // ---- Example 1: log every chat message --------------------------------
  // bot.on('messagestr', (msg) => console.log('[chat]', msg));

  // ---- Example 2: wrap an existing method -------------------------------
  // const originalJoin = bot.join?.bind(bot);
  // if (originalJoin) {
  //   bot.join = async (gamemode, options) => {
  //     console.log('joining', gamemode);
  //     return originalJoin(gamemode, options);
  //   };
  // }

  // ---- Example 3: add a custom helper -----------------------------------
  // bot.sayHi = () => bot.chat('hi from my extension!');
}
`,
      };
  }
  return { code: '' };
}

export default Macros_;
