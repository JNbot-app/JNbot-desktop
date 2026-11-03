/**
 * Profile-attached scripts. A profile (predefined or custom) declares an
 * ordered list of scripts that appear on the dashboard for that server.
 *
 * Each script has a "source" describing where to fetch the plugin's info
 * (display metadata + settings schema) and the executable code from. The
 * actual code/info bytes are NOT embedded in the profile during normal
 * operation — they are resolved at runtime. During export the resolved
 * bytes are inlined alongside the profile so the bundle is self-contained;
 * see `ProfileExportBundle` in this file.
 */

import { MacroCode, MacroInfo } from "main/src/types";
import type { PluginSignatureV2 } from './pluginSignatures';

/**
 * Where the script's info + code live. The display name, image, scriptType
 * and settings schema are read from the resolved plugin's MacroInfo —
 * there is no override on the `ProfileScript` itself. This keeps the
 * profile-scripts schema and the plugin schema in sync; if you want
 * extra display fields they go on MacroInfo (so plugins benefit too).
 */
export type ProfileScriptSource =
  /** Reference to a plugin already in the user's macro library. */
  | { kind: 'plugin'; pluginId: string }

  /**
   * Files stored locally on disk. Materialised either by the "From file"
   * picker in the wizard or by `materializeImportedBundles` when a
   * profile is imported. `codePath` points at an obfuscated payload
   * (see `scriptObfuscate.ts`); `infoPath` is plain JSON.
   */
  | { kind: 'bundled'; infoPath: string; codePath: string }

  /**
   * Imported from a remote URL. The code is re-downloaded from `url` every
   * time the script is *run*, so the author can push updates that every
   * user picks up automatically — nothing executable is cached. Only the
   * `MacroInfo` is cached at `infoPath` so the dashboard can render the
   * name/banner without hitting the network on every display.
   */
  | { kind: 'url'; url: string; infoPath: string };

export interface ProfileScript {
  /** Stable id within the profile. */
  id: string;
  /**
   * Matches the underlying plugin's MacroInfo.pluginId so per-script
   * settings persistence (keyed by pluginId) carries across reloads.
   */
  pluginId: string;
  /** Where to load info + code from. */
  source: ProfileScriptSource;
  /** SHA-256 hex of the canonical-JSON code payload. Verified after fetch. */
  checksum?: string;
  /** Ed25519 signature over the complete plugin package. */
  signature?: PluginSignatureV2;
  /** Lower = earlier on the dashboard. Stable secondary key: `id`. */
  order?: number;
  /**
   * When true, the script is omitted from the dashboard but still
   * resolvable via action runner. Lets profiles ship "internal" scripts
   * that are intended to be invoked from other actions rather than run
   * manually by the user.
   */
  hidden?: boolean;
}

export type ProfileScriptList = ProfileScript[];

/**
 * Bundle embedded into an exported profile JSON. The receiver can use
 * this to rehydrate the script without any external dependency. `info`
 * is plain JSON (it's purely descriptive) but `codeObf` is the
 * base64-encoded obfuscated payload — see `scriptObfuscate.ts` for the
 * encoding. Only used during import/export.
 */
export interface ProfileScriptBundle {
  scriptId: string;
  info: MacroInfo;
  codeObf: string;
}

export function isProfileScript(value: unknown): value is ProfileScript {
  if (!value || typeof value !== 'object') return false;
  const v = value as ProfileScript;
  return (
    typeof v.id === 'string' &&
    typeof v.pluginId === 'string' &&
    !!v.source &&
    typeof v.source === 'object' &&
    typeof (v.source as { kind: string }).kind === 'string'
  );
}

/** Human label for a source kind. Shared by every place that shows it. */
export const SOURCE_LABELS: Record<ProfileScriptSource['kind'], string> = {
  plugin: 'Local plugin',
  bundled: 'File on disk',
  url: 'From URL',
};

/**
 * Stable identity for a script's source — used as an effect dependency so
 * resolvers re-run when the source actually changes. One definition shared
 * by both the wizard and dashboard resolve hooks.
 */
export function sourceKey(source: ProfileScriptSource): string {
  switch (source.kind) {
    case 'plugin':
      return `plugin:${source.pluginId}`;
    case 'bundled':
      return `bundled:${source.infoPath}|${source.codePath}`;
    case 'url':
      return `url:${source.url}`;
  }
}

/**
 * Validate a parsed `.jnp` payload — used by both the "from file" and
 * "from URL" importers so they apply identical rules for what counts as a
 * valid plugin. Returns the narrowed `{ info, code }` on success, or an
 * `{ error }` describing the first problem found.
 */
export function validatePluginPayload(
  raw: unknown,
): { info: MacroInfo; code: MacroCode } | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: 'Not a JNbot plugin (expected JSON with info + code)' };
  }
  const { info, code } = raw as { info?: MacroInfo; code?: MacroCode };
  if (!info || typeof info !== 'object' || !info.pluginId) {
    return { error: 'Plugin info is missing a pluginId' };
  }
  if (!info.name) {
    return { error: 'Plugin info is missing a name' };
  }
  if (!info.scriptType) {
    return { error: 'Plugin info is missing a scriptType' };
  }
  if (!code || typeof code !== 'object') {
    return { error: 'Plugin is missing its code payload' };
  }
  return { info, code };
}

export function sortScripts(list: ProfileScriptList): ProfileScriptList {
  return [...list].sort((a, b) => {
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });
}
