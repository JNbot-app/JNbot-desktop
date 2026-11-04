import {
  SHARE_KIND_LABELS,
  shareUpdateAvailable,
  type ShareKind,
} from '../../../common/share';
import useAppApi from '../../hooks/useAppApi';
import {
  checkShareUpdate,
  useInstalledShare,
  useShares,
} from '../../redux/shares';
import { useOpenShareLink } from './useShareTarget';

/**
 * Update action for an item installed from a share: opens the update when one
 * is known, otherwise checks the server first. Undefined when it was not
 * installed from a share.
 */
export const useShareUpdateAction = (kind: ShareKind, localRef: string) => {
  const share = useInstalledShare(kind, localRef);
  const appVersion = useShares((state) => state.appVersion);
  const openShareLink = useOpenShareLink();
  const { message } = useAppApi();
  if (!share) return undefined;

  const available = shareUpdateAvailable(share, appVersion);
  const run = async () => {
    try {
      if (available || (await checkShareUpdate(share.id)))
        openShareLink(share.id);
      else
        message.success(
          `This ${SHARE_KIND_LABELS[kind].toLowerCase()} is up to date`,
        );
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  return {
    available,
    run,
    label: available ? `Update from ${share.ownerName}` : 'Check for updates',
  };
};
