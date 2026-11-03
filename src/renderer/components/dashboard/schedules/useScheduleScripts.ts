import { useEffect, useState } from 'react';
import type { MacroInfo } from '../../../../main/src/types';
import { isPluginDisallowed } from '../../../../common/profiles';
import { chainPluginId } from '../../../../common/chains';
import {
  selectActiveServerId,
  selectCanUsePlugins,
  selectCanUseScripts,
  useSettingsStore,
} from '../../../redux/settings';

export type ScheduleScript = { info: MacroInfo; profileScriptId?: string };

/** Resolve only metadata while the schedule editor is open. Profile scripts win by id. */
export function useScheduleScripts() {
  const profileId = useSettingsStore((state) => state.selectedProfileId);
  const profileKey = useSettingsStore(selectActiveServerId);
  const profile = useSettingsStore((state) =>
    profileKey ? state.JNdata.data[profileKey] : undefined,
  );
  const installed = useSettingsStore((state) => state.macros.list);
  const savedScripts = useSettingsStore((state) => state.settings.scripts);
  const canUseScripts = useSettingsStore(selectCanUseScripts);
  const canUsePlugins = useSettingsStore(selectCanUsePlugins);
  const [scripts, setScripts] = useState<ScheduleScript[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScripts([]);
    if (profileId === null)
      return () => {
        cancelled = true;
      };
    const entries = profile?.scripts ?? [];
    void Promise.all(
      entries.map(async (entry): Promise<ScheduleScript | undefined> => {
        if (isPluginDisallowed(profile, entry.pluginId)) return undefined;
        try {
          const result = await window.messenger.profileRequest<{
            info?: MacroInfo;
          }>(profileId, 'RESOLVE_PROFILE_SCRIPT_INFO', { id: entry.id });
          if (result.info)
            return { info: result.info, profileScriptId: entry.id };
        } catch {
          /* Unavailable scripts are omitted from the picker. */
        }
        return undefined;
      }),
    ).then((resolved) => {
      if (cancelled) return;
      const byId = new Map<string, ScheduleScript>();
      const candidates: (ScheduleScript | undefined)[] = [
        ...resolved,
        ...installed.map((info) => ({ info })),
      ];
      for (const script of candidates) {
        if (!script || isPluginDisallowed(profile, script.info.pluginId))
          continue;
        if (
          script.info.scriptType !== 'script' &&
          script.info.scriptType !== 'action'
        )
          continue;
        if (script.profileScriptId ? !canUseScripts : !canUsePlugins) continue;
        if (!byId.has(script.info.pluginId))
          byId.set(script.info.pluginId, script);
      }
      setScripts([...byId.values()]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, profile, installed, canUsePlugins, canUseScripts]);

  // Chains run like plugins under a `chain:<id>` pluginId.
  const chains = Object.values(savedScripts?.chains ?? {}).map(
    (chain): ScheduleScript => ({
      info: {
        pluginId: chainPluginId(chain.id),
        name: savedScripts?.[chain.id]?.name ?? chain.name ?? 'Chain',
        scriptType: 'script',
      } as MacroInfo,
    }),
  );
  return { scripts: [...scripts, ...chains], loading };
}
