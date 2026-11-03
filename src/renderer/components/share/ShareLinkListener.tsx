import { useEffect } from 'react';
import { useOpenShareLink } from './useShareTarget';

/**
 * Opens `jnbot://share/<id>` links in the review panel. Main keeps the latest
 * link pending until the UI asks for it, so links from a cold start work too.
 */
const ShareLinkListener: React.FC = () => {
  const openShareLink = useOpenShareLink();

  useEffect(() => {
    if (window.web) return;
    const pull = () =>
      void window.ipcRenderer
        .invoke<string | null>('share-link-pending')
        .then((id) => id && openShareLink(id));
    pull();
    return window.ipcRenderer.on('share-link', pull);
  }, []);

  return null;
};

export default ShareLinkListener;
