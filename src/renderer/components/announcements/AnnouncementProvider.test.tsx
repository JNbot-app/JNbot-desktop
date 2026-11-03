import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
  AnnouncementProvider,
  DISMISSED_ANNOUNCEMENT_STORAGE_KEY,
  useAnnouncement,
} from './AnnouncementProvider';

const response = (id: string) =>
  Promise.resolve({
    ok: true,
    json: async () => ({
      current: { id, title: 'News', body: 'A **formatted** message.' },
    }),
  } as Response);

const Probe = () => {
  const { announcement, dismiss, isDismissed } = useAnnouncement();

  if (!announcement) return <span>No announcement</span>;
  return (
    <div>
      <span>{announcement.id}</span>
      <span>{isDismissed ? 'Dismissed' : 'Visible'}</span>
      <button onClick={dismiss}>Dismiss</button>
    </div>
  );
};

describe('AnnouncementProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn();
  });

  it('fetches once and exposes a valid active announcement', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => response('news-1'));

    render(
      <AnnouncementProvider>
        <Probe />
      </AnnouncementProvider>,
    );

    expect(await screen.findByText('news-1')).toBeInTheDocument();
    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('persists dismissal and keeps the active announcement available', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => response('news-1'));

    render(
      <AnnouncementProvider>
        <Probe />
      </AnnouncementProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(screen.getByText('Dismissed')).toBeInTheDocument();
    expect(
      window.localStorage.getItem(DISMISSED_ANNOUNCEMENT_STORAGE_KEY),
    ).toBe('news-1');
  });

  it('restores dismissal for the same id and shows a new id', async () => {
    window.localStorage.setItem(DISMISSED_ANNOUNCEMENT_STORAGE_KEY, 'news-1');
    (global.fetch as jest.Mock).mockImplementation(() => response('news-1'));

    const view = render(
      <AnnouncementProvider>
        <Probe />
      </AnnouncementProvider>,
    );
    expect(await screen.findByText('Dismissed')).toBeInTheDocument();

    view.unmount();
    (global.fetch as jest.Mock).mockImplementation(() => response('news-2'));
    render(
      <AnnouncementProvider>
        <Probe />
      </AnnouncementProvider>,
    );

    expect(await screen.findByText('news-2')).toBeInTheDocument();
    expect(screen.getByText('Visible')).toBeInTheDocument();
  });

  it('silently exposes no announcement when fetching or validation fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const view = render(
      <AnnouncementProvider>
        <Probe />
      </AnnouncementProvider>,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText('No announcement')).toBeInTheDocument();

    view.unmount();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ current: { id: 'broken' } }),
    });
    render(
      <AnnouncementProvider>
        <Probe />
      </AnnouncementProvider>,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('No announcement')).toBeInTheDocument();
  });
});
