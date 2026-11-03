import { useEffect, useState } from 'react';
import { BACKEND } from '../../common/messaging';
import type { ProfileRuntimeSummary } from '../../common/profileRuntime';
import { useSettingsStore } from '../redux/settings';

const useProfileRuntimeSummaries = () => {
  const selectedProfileId = useSettingsStore((state) => state.selectedProfileId);
  const [summaries, setSummaries] = useState<
    Record<string, ProfileRuntimeSummary>
  >({});

  useEffect(() => {
    let mounted = true;
    const update = (summary: ProfileRuntimeSummary) => {
      if (!mounted) return;
      setSummaries((current) => ({
        ...current,
        [summary.profileKey]: summary,
      }));
    };
    const unsubscribe = selectedProfileId === null
      ? () => {}
      : window.messenger.sub(
          'profiles:runtime-summary',
          { broadcast: 'profile-clients', profileId: selectedProfileId },
          (data) => update(data as ProfileRuntimeSummary),
        );

    void window.messenger
      .request<ProfileRuntimeSummary[]>('profiles:runtime-summaries', BACKEND)
      .then((initial) => {
        if (!mounted) return;
        const initialByProfile = Object.fromEntries(
          initial.map((summary) => [summary.profileKey, summary]),
        );
        setSummaries((current) => ({ ...initialByProfile, ...current }));
      })
      .catch((error) =>
        console.error('Failed to load profile runtime summaries', error),
      );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [selectedProfileId]);

  return summaries;
};

export default useProfileRuntimeSummaries;
