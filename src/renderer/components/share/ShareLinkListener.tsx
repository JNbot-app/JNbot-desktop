import { useEffect } from 'react';
import { useOpenShareLink } from './useShareTarget';

/**
 * Opens `jnbot://share/<id>` links in the review panel. Main keeps the latest
 * link pending until the UI asks for it, so links from a cold start work too.
 */
const ShareLinkListener: React.FC = () => {
  const openShareLink = useOpenShareLink();

  /* oxlint-disable react-hooks/exhaustive-deps */
  // useOpenShareLink returns a new function each render; keep the listener registered once.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (window.web) return;
    const pull = () =>
      void window.ipcRenderer
        .invoke<string | null>('share-link-pending')
        .then((id) => id && openShareLink(id));
    pull();
    return window.ipcRenderer.on('share-link', pull);
  }, []);

  /* oxlint-enable react-hooks/exhaustive-deps */  /* oxlint-enable react-hooks/exhaustive-deps */

  return null;
};

export default ShareLinkListener;
