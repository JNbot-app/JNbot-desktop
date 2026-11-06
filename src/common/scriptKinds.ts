import { chainIdFromPluginId } from './chains';

/** The kinds of runnable script a user can pick, in display order. */
export const SCRIPT_KINDS = [
  'profileScript',
  'action',
  'recording',
  'plugin',
  'chain',
] as const;

export type ScriptKind = (typeof SCRIPT_KINDS)[number];

export const SCRIPT_KIND_LABELS: Record<ScriptKind, string> = {
  profileScript: 'Profile scripts',
  action: 'Actions',
  recording: 'Recordings',
  plugin: 'Plugins',
  chain: 'Chains',
};

type KindedScript = {
  info: { pluginId: string; language?: string; scriptType?: string };
  profileScriptId?: string;
};

const libraryKind = ({ info }: KindedScript): ScriptKind => {
  if (chainIdFromPluginId(info.pluginId)) return 'chain';
  if (info.language === 'recording') return 'recording';
  return info.scriptType === 'action' ? 'action' : 'plugin';
};

/**
 * Group scripts by kind, in display order. A script attached to the profile
 * also keeps its own kind, so it stays pickable when `kinds` leaves out
 * `profileScript`. No `kinds` (or an empty list) allows every kind.
 */
export function groupScriptsByKind<T extends KindedScript>(
  scripts: T[],
  kinds?: readonly ScriptKind[],
) {
  const groups = new Map<ScriptKind, T[]>(
    SCRIPT_KINDS.filter((kind) => !kinds?.length || kinds.includes(kind)).map(
      (kind) => [kind, []],
    ),
  );
  for (const script of scripts) {
    const kind =
      script.profileScriptId && groups.has('profileScript')
        ? 'profileScript'
        : libraryKind(script);
    groups.get(kind)?.push(script);
  }
  return [...groups]
    .filter(([, members]) => members.length)
    .map(([kind, members]) => ({
      kind,
      label: SCRIPT_KIND_LABELS[kind],
      scripts: members,
    }));
}
