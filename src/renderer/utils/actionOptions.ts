import type { ScriptActionInfo } from '../../main/src/types';

export interface ActionOption {
  label: string;
  value: string;
}
export type ActionOptionGroup =
  | ActionOption
  | { label: string; options: ActionOption[] };

/**
 * Build AntD `Select` options from script actions, grouping the active
 * server's profile-attached actions under a "Profile" header. Falls back to
 * a flat list when there are no profile actions, so the common case shows no
 * group headers. Shared by every action picker (Run-a-script, chains, …).
 */
export function groupActionOptions(
  actions: ScriptActionInfo[],
): ActionOptionGroup[] {
  const toOpt = (a: ScriptActionInfo): ActionOption => ({
    label: a.name,
    value: a.pluginId,
  });
  const profile = actions.filter((a) => a.profile);
  if (!profile.length) return actions.map(toOpt);
  const library = actions.filter((a) => !a.profile);
  return [
    ...(library.length
      ? [{ label: 'Library', options: library.map(toOpt) }]
      : []),
    { label: 'Profile', options: profile.map(toOpt) },
  ];
}
