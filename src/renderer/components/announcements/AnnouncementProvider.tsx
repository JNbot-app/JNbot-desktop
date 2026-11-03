import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ANNOUNCEMENT_URL,
  type Announcement,
  parseAnnouncementDocument,
} from './announcement';

export const DISMISSED_ANNOUNCEMENT_STORAGE_KEY =
  'jnbot.dismissedAnnouncementId';

type AnnouncementContextValue = {
  announcement: Announcement | null;
  isDismissed: boolean;
  dismiss: () => void;
};

const AnnouncementContext = createContext<AnnouncementContextValue | null>(
  null,
);

function readDismissedId(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_ANNOUNCEMENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveDismissedId(id: string): void {
  try {
    window.localStorage.setItem(DISMISSED_ANNOUNCEMENT_STORAGE_KEY, id);
  } catch {
    // Dismissal still applies for this session when storage is unavailable.
  }
}

export function AnnouncementProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(
    readDismissedId,
  );

  useEffect(() => {
    const controller = new AbortController();

    const loadAnnouncement = async () => {
      try {
        const response = await fetch(ANNOUNCEMENT_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;

        const document: unknown = await response.json();
        
        if (!controller.signal.aborted) {
          setAnnouncement(parseAnnouncementDocument(document));
        }
      } catch {
        // Announcements are optional and must never interrupt the app shell.
      }
    };

    loadAnnouncement();
    return () => controller.abort();
  }, []);

  const dismiss = useCallback(() => {
    if (!announcement) return;
    setDismissedId(announcement.id);
    saveDismissedId(announcement.id);
  }, [announcement]);

  const value = useMemo<AnnouncementContextValue>(
    () => ({
      announcement,
      dismiss,
      isDismissed: announcement !== null && dismissedId === announcement.id,
    }),
    [announcement, dismiss, dismissedId],
  );

  return (
    <AnnouncementContext.Provider value={value}>
      {children}
    </AnnouncementContext.Provider>
  );
}

export function useAnnouncement(): AnnouncementContextValue {
  const value = useContext(AnnouncementContext);
  if (!value) {
    throw new Error('useAnnouncement must be used within AnnouncementProvider');
  }
  return value;
}
