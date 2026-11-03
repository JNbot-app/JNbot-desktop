import type { ProfileScriptSource } from '../../../../common/profileScripts';

/**
 * Shared renderer-side importers for the two non-library script sources:
 * a local `.jnp` file and a remote URL. Both call into the matching IPC
 * handler in `ProfileScripts.ts`, which validates the payload and caches
 * it to disk, then return a ready-to-use `ProfileScriptSource` (plus the
 * resolved `pluginId`/`checksum`). Keeping this in one place means the
 * wizard's various pickers stay in sync and free of duplicated plumbing.
 */
export interface ImportedSource {
  pluginId: string;
  source: ProfileScriptSource;
  checksum?: string;
}

export type ImportResult =
  | { ok: true; result: ImportedSource }
  | { ok: false; canceled?: boolean; error?: string };

const toResult = (res: any): ImportResult => {
  if (!res?.ok) {
    return { ok: false, canceled: res?.canceled, error: res?.error };
  }
  const source: ProfileScriptSource = res.url
    ? { kind: 'url', url: res.url, infoPath: res.infoPath }
    : { kind: 'bundled', infoPath: res.infoPath, codePath: res.codePath };
  return {
    ok: true,
    result: { pluginId: res.pluginId, source, checksum: res.checksum },
  };
};

/** Open the OS file picker and stage the chosen `.jnp` file. */
export async function importFromFile(): Promise<ImportResult> {
  return toResult(
    await window.ipcRenderer.invoke('profile-script-pick-file'),
  );
}

/** Download + validate a plugin from `url` and stage it. */
export async function importFromUrl(url: string): Promise<ImportResult> {
  return toResult(
    await window.ipcRenderer.invoke('profile-script-fetch-url', url),
  );
}
