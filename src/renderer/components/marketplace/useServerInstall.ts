import { useEffect, useState } from 'react';
import type { MarketEntry, ShareInstallInput } from '../../../common/share';
import type { ServerMeta } from '../../../common/serverInfo';
import useAppApi from '../../hooks/useAppApi';
import {
  useSettingsStore,
  deleteCustomProfile,
  selectInstalledServerIds,
  switchServer,
} from '../../redux/settings';
import { loadMarket, useMarket } from '../../redux/shares';
import shareRequest from '../share/shareRequest';

export interface UninstallResult {
  fallbackServer: string | null;
}

/** Profile shares on the marketplace; official (built-in) servers first. */
export function useMarketProfiles(): { profiles: MarketEntry[]; loading: boolean; error?: string } {
  const { entries, loading, error } = useMarket();
  useEffect(() => {
    void loadMarket();
  }, []);
  const profiles = (entries ?? [])
    .filter((entry) => entry.kind === 'profile')
    .sort((a, b) => Number(b.publisher.official) - Number(a.publisher.official) || a.listing.title.localeCompare(b.listing.title));
  return { profiles, loading: loading && !entries, error };
}

/**
 * Shared install / uninstall actions for server profiles. Used by the
 * marketplace modal, the intro and the Profiles page so the confirm dialog,
 * IPC call and toasts live in exactly one place. `busyId` is the share or
 * profile currently mutating (for button spinners).
 */
export function useServerInstall() {
  const appApi = useAppApi();
  const installedIds = useSettingsStore(selectInstalledServerIds);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Installs an official profile share in one click; returns its profile key. */
  const install = async (entry: MarketEntry, onDone?: (profileKey: string) => void) => {
    setBusyId(entry.id);
    const result = await shareRequest<{ localRef: string }>(appApi, 'SHARE_INSTALL', {
      id: entry.id,
      decisions: [],
    } satisfies ShareInstallInput);
    setBusyId(null);
    if (!result) return;
    switchServer(result.localRef);
    appApi.message.success(`Added ${entry.listing.title}`);
    onDone?.(result.localRef);
  };

  const uninstall = (meta: ServerMeta, onDone?: (result: UninstallResult) => void) => {
    appApi.modal.confirm({
      title: `Remove ${meta.name}?`,
      content:
        'This removes the server from this device. Alts and devices stay where they are. ' +
        'You can add it again from the marketplace.',
      okText: 'Remove',
      okType: 'danger',
      onOk: () => {
        const fallbackServer = installedIds.find((id) => id !== meta.id) ?? null;
        if (fallbackServer) switchServer(fallbackServer);
        deleteCustomProfile(meta.id);
        appApi.message.success(`Removed ${meta.name}`);
        onDone?.({ fallbackServer });
      },
    });
  };

  return { install, uninstall, busyId };
}
