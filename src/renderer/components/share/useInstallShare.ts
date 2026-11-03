import { useNavigate } from 'react-router-dom';
import {
  previewNeedsCheck,
  type MarketEntry,
  type ShareInstallInput,
  type ShareKind,
  type SharePreview,
} from '../../../common/share';
import useAppApi from '../../hooks/useAppApi';
import {
  selectActiveServerId,
  switchServer,
  useSettingsStore,
} from '../../redux/settings';
import shareRequest from './shareRequest';

/** Takes the user to what was just installed: a profile becomes active, the rest open on their page. */
export const useOpenInstalled = () => {
  const navigate = useNavigate();
  return (kind: ShareKind, localRef: string) => {
    if (kind === 'profile') switchServer(localRef);
    navigate(
      kind === 'trigger'
        ? '/triggers'
        : kind === 'plugin' || kind === 'bundle'
          ? '/plugins'
          : '/',
    );
  };
};

/**
 * One-click install from the catalog. Resolves false when the share needs a
 * closer look first (unknown publisher, conflicts, unsigned code), so the
 * caller can open its review panel instead.
 */
export const useQuickInstall = () => {
  const api = useAppApi();
  const profileKey = useSettingsStore(selectActiveServerId);
  const openInstalled = useOpenInstalled();
  return async (entry: MarketEntry) => {
    const preview = await shareRequest<SharePreview>(api, 'SHARE_PREVIEW', {
      link: entry.id,
      profileKey: profileKey ?? undefined,
    });
    if (!preview) return true;
    if (previewNeedsCheck(preview)) return false;
    const result = await shareRequest<{ localRef: string }>(
      api,
      'SHARE_INSTALL',
      {
        id: preview.id,
        decisions: preview.plugins.map((plugin) => ({
          ownerId: plugin.ownerId,
          pluginId: plugin.pluginId,
          revision: plugin.revision,
          action: 'replace',
          acceptUnverified: true,
        })),
        ...(preview.kind === 'chain' || preview.kind === 'trigger'
          ? { profileKey }
          : {}),
      } satisfies ShareInstallInput,
    );
    if (!result) return true;
    api.message.success(`${entry.listing.title} installed`);
    openInstalled(preview.kind, result.localRef);
    return true;
  };
};
