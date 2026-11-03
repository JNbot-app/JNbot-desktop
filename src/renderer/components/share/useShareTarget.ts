import { create } from 'zustand';
import type { ShareCreateInput } from '../../../common/share';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import { SHARE_TAB, type SharePanelData } from '../other/botSideBar/panelTabs';

export type ShareTarget = ShareCreateInput & { title: string };

/** The item the {@link ShareModal} is managing. */
export const useShareTarget = create<{ target?: ShareTarget }>(() => ({}));

export const openShareModal = (target: ShareTarget) => useShareTarget.setState({ target });

/** Opens the review panel for a share (link, id, or a reviewer's pending revision). */
export const useOpenShareLink = () => {
  const { setPanel } = usePanelContext();
  return (link: string, review?: Omit<SharePanelData, 'link'>) =>
    setPanel({ active: true, tab: SHARE_TAB, data: { link, ...review } satisfies SharePanelData });
};
