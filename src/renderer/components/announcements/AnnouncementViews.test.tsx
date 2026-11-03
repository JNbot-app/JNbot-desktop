import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import React from 'react';
import { AnnouncementProvider } from './AnnouncementProvider';
import { AnnouncementBanner } from './AnnouncementViews';
import Notifications from '../other/Notifications';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({
    components,
  }: {
    components: Record<string, React.ElementType>;
  }) => {
    const Link = components.a;
    return (
      <p>
        The <strong>mobile app</strong> is ready.{' '}
        <Link href="https://example.com/guide">Read the guide</Link>.
      </p>
    );
  },
}));

(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

window.matchMedia =
  window.matchMedia ||
  (() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));

const payload = {
  current: {
    id: 'news-1',
    title: 'A new JNbot release',
    body: 'The **mobile app** is ready. [Read the guide](https://example.com/guide).',
    actions: [{ label: 'Download', url: 'https://example.com/download' }],
  },
};

const renderAnnouncements = () =>
  render(
    <ConfigProvider>
      <AnnouncementProvider>
        <AnnouncementBanner />
        <Notifications />
      </AnnouncementProvider>
    </ConfigProvider>,
  );

describe('announcement views', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.web = false;
    window.ipcRenderer = { action: jest.fn() } as any;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
  });

  it('renders formatted content and safe external links', async () => {
    renderAnnouncements();

    expect(await screen.findByText('A new JNbot release')).toBeInTheDocument();
    expect(screen.getByText('mobile app').tagName).toBe('STRONG');

    const markdownLink = screen.getByRole('link', { name: 'Read the guide' });
    expect(markdownLink).toHaveAttribute('href', 'https://example.com/guide');
    expect(markdownLink).toHaveAttribute('target', '_blank');
    expect(markdownLink).toHaveAttribute('rel', 'noreferrer noopener');

    fireEvent.click(screen.getByRole('link', { name: 'Download' }));
    expect(window.ipcRenderer.action).toHaveBeenCalledWith(
      'OPEN_URL',
      'https://example.com/download',
    );
  });

  it('dismisses the banner and keeps the announcement in notifications', async () => {
    renderAnnouncements();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Dismiss announcement' }),
    );

    expect(
      screen.queryByRole('button', { name: 'Dismiss announcement' }),
    ).not.toBeInTheDocument();

    expect(screen.queryByText('A new JNbot release')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open notifications' }));

    expect(await screen.findByText('A new JNbot release')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  });

  it('renders nothing when no active announcement is available', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: null }),
    });

    renderAnnouncements();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    expect(
      screen.queryByRole('button', { name: 'Dismiss announcement' }),
    ).not.toBeInTheDocument();
  });
});
