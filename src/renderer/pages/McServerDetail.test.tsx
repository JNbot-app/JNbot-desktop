import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MinecraftServerDetail } from '../../common/minecraftServers';
import McServerDetail from './McServerDetail';

(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(window as any).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: jest.fn(),
  removeListener: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
});

const message = {
  error: jest.fn(),
  success: jest.fn(),
};
const modal = { confirm: jest.fn() };

jest.mock('../hooks/useAppApi', () => ({
  __esModule: true,
  default: () => ({ message, modal }),
}));
jest.mock('../components/mcServer/ServerConsole', () => ({
  __esModule: true,
  default: () => <div>Console content</div>,
}));
jest.mock('../components/mcServer/ServerPlugins', () => ({
  __esModule: true,
  default: () => <div>Plugin content</div>,
}));

const managed: MinecraftServerDetail = {
  id: 'managed-1',
  name: 'Survival',
  version: '1.21.11',
  role: 'host',
  source: 'dedicated',
  state: 'online',
  localAddress: '127.0.0.1:25565',
  peerCount: 2,
  createdAt: 1,
  apiState: 'online',
  apiVersion: '0.1.1',
  restartRequired: false,
  pluginCount: 3,
  capabilities: {
    console: true,
    plugins: true,
    api: true,
  },
};

const renderPage = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/mc-server/:serverId" element={<McServerDetail />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Minecraft server detail page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.web = false;
    window.ipcRenderer = {
      get: jest.fn(async (action: string) => {
        if (action === 'MC_SERVER_GET') return managed;
        throw new Error(`Unexpected action ${action}`);
      }),
      on: jest.fn(() => jest.fn()),
    } as any;
  });

  test('deep-links to managed plugin details', async () => {
    renderPage('/mc-server/managed-1?tab=plugins');

    expect((await screen.findAllByText('Survival')).length).toBeGreaterThan(0);
    expect(screen.getByText('Plugins (3)')).toBeInTheDocument();
    expect(screen.getByText('Plugin content')).toBeInTheDocument();
    expect(screen.getByText('Console')).toBeInTheDocument();
  });

  test('shows a connection log without plugins for LAN worlds', async () => {
    const lan: MinecraftServerDetail = {
      ...managed,
      id: 'lan-1',
      name: 'LAN world',
      source: 'manual-lan',
      apiState: 'unsupported',
      apiVersion: undefined,
      pluginCount: 0,
      capabilities: {
        console: false,
        plugins: false,
        api: false,
      },
    };
    (window.ipcRenderer.get as jest.Mock).mockResolvedValueOnce(lan);
    renderPage('/mc-server/lan-1?tab=plugins');

    expect((await screen.findAllByText('LAN world')).length).toBeGreaterThan(0);
    expect(screen.getByText('Connection log')).toBeInTheDocument();
    expect(screen.queryByText(/Plugins \(/)).not.toBeInTheDocument();
    expect(
      screen.getByText('Overview').closest('[role="tab"]'),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('renders a useful missing-server state', async () => {
    (window.ipcRenderer.get as jest.Mock).mockRejectedValueOnce(
      new Error('Minecraft server not found'),
    );
    renderPage('/mc-server/missing');

    expect(
      (await screen.findAllByText('Minecraft server not found')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Back to servers')).toBeInTheDocument();
  });
});
