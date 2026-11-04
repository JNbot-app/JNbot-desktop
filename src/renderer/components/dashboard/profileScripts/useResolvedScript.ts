import { useEffect, useState } from 'react';
import { sourceKey, type ProfileScript } from '../../../../common/profileScripts';
import type { MacroInfo } from '../../../../main/src/types';
import { useSettingsStore } from '../../../redux/settings';

interface ResolvedDashboardScript {
  info: MacroInfo | null;
  loading: boolean;
  error: string | null;
}

/**
 * Module-level cache of resolved info, keyed by script identity. It survives
 * navigation between pages (cleared only on a full reload), so returning to the
 * dashboard shows cards instantly instead of flashing back into a loading state
 * and re-resolving. A cold load (first visit / hard refresh) has no entry yet
 * and correctly starts in the loading state.
 */
const infoCache = new Map<string, MacroInfo>();

const cacheKey = (script: ProfileScript) =>
  `${script.id}|${sourceKey(script.source)}`;

/**
 * Dashboard-side resolve hook. We only ever display `info`, so this uses the
 * selected profile's messenger request (no code download/deobfuscate) and
 * caches the result in `infoCache` for flash-free revisits.
 */
export function useResolvedScript(
  script: ProfileScript,
  infoOverride?: MacroInfo,
): ResolvedDashboardScript {
  const key = cacheKey(script);
  const profileId = useSettingsStore((state) => state.selectedProfileId);
  const [state, setState] = useState<ResolvedDashboardScript>(() => {
    const cached = infoOverride ?? infoCache.get(key) ?? null;
    return { info: cached, loading: !cached, error: null };
  });

  /* oxlint-disable react-hooks/exhaustive-deps */
  // Refetch only when the cache key or profile changes, not on script object identity.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (infoOverride) {
      infoCache.set(key, infoOverride);
      setState({ info: infoOverride, loading: false, error: null });
      return;
    }
    if (profileId === null) return;
    let cancelled = false;
    window.messenger
      .profileRequest<{ info?: MacroInfo; error?: string }>(
        profileId,
        'RESOLVE_PROFILE_SCRIPT_INFO',
        script,
      )
      .then((res) => {
        if (cancelled) return;
        if (res?.info) {
          infoCache.set(key, res.info);
          setState({ info: res.info, loading: false, error: null });
        } else {
          setState((s) => ({
            info: s.info,
            loading: false,
            error: res?.error ?? 'Failed to resolve',
          }));
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setState((s) => ({
          info: s.info,
          loading: false,
          error: err?.message ?? 'Failed',
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, profileId, infoOverride]);

  /* oxlint-enable react-hooks/exhaustive-deps */  /* oxlint-enable react-hooks/exhaustive-deps */

  return state;
}
