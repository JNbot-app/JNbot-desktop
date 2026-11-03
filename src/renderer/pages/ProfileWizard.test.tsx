import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProfileWizard from './ProfileWizard';
import { guessServerName, parseAddress } from '../components/profiles/wizardUtils';

(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(window as any).matchMedia = () => ({
  matches: false,
  addListener: jest.fn(),
  removeListener: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
});

const upsertCustomProfile = jest.fn();
jest.mock('../redux/settings', () => ({
  useSettingsStore: (select: (s: any) => unknown) => select({}),
  selectJNdata: () => ({ serverList: [] }),
  selectCustomProfiles: () => [],
  switchServer: jest.fn(),
  upsertCustomProfile: (p: unknown) => upsertCustomProfile(p),
}));
jest.mock('../hooks/useAppApi', () => ({
  __esModule: true,
  default: () => ({ message: { success: jest.fn(), warning: jest.fn() }, modal: { confirm: jest.fn() } }),
}));
jest.mock('../components/profiles/steps/StepRanksGkits', () => () => null);
jest.mock('../components/profiles/steps/StepScripts', () => () => null);
jest.mock('../components/profiles/steps/StepProfileUi', () => () => null);
jest.mock('../components/profiles/steps/StepBotExtension', () => () => null);
jest.mock('../components/profiles/steps/StepDefaultSettings', () => () => null);

describe('address helpers', () => {
  it('splits pasted addresses', () => {
    expect(parseAddress('https://Play.Example.net:25566/')).toEqual({ host: 'play.example.net', port: 25566 });
    expect(parseAddress('play.example.net:')).toEqual({ host: 'play.example.net', port: 25565 });
    expect(parseAddress('mc.hypixel.net')).toEqual({ host: 'mc.hypixel.net', port: 25565 });
  });
  it('guesses a name from the host', () => {
    expect(guessServerName('play.jartexnetwork.com')).toBe('Jartexnetwork');
    expect(guessServerName('127.0.0.1')).toBe('');
  });
});

describe('ProfileWizard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    upsertCustomProfile.mockClear();
    (window as any).ipcRenderer = {
      get: jest.fn().mockResolvedValue({ version: '1.8-1.21', online: 1200 }),
    };
  });
  afterEach(() => jest.useRealTimers());

  const renderNew = () =>
    render(
      <MemoryRouter initialEntries={['/profiles/new']}>
        <Routes>
          <Route path="/profiles/new" element={<ProfileWizard />} />
          <Route path="/profiles" element={<div>Profiles list</div>} />
        </Routes>
      </MemoryRouter>,
    );

  it('creates a profile from just an address', async () => {
    renderNew();
    fireEvent.change(screen.getByPlaceholderText('play.example.net'), {
      target: { value: 'play.jartexnetwork.com' },
    });
    await act(async () => {
      jest.advanceTimersByTime(700);
    });

    expect(window.ipcRenderer.get).toHaveBeenCalledWith('PING_MINECRAFT_SERVER', {
      host: 'play.jartexnetwork.com',
      port: 25565,
    });
    expect(screen.getByText('Online · 1.8-1.21 · 1,200 playing')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('My server')).toHaveValue('Jartexnetwork');

    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    const saved = upsertCustomProfile.mock.calls[0][0];
    expect(saved.data).toMatchObject({
      name: 'Jartexnetwork',
      defaultIp: 'play.jartexnetwork.com',
      gamemodes: ['Hub'],
      defaultGamemode: 'Hub',
    });
    expect(screen.getByText('Profiles list')).toBeInTheDocument();
  });

  it('cleans gamemode names and blocks saving without an address', () => {
    renderNew();
    fireEvent.click(screen.getByText('Gamemodes'));
    const input = screen.getByPlaceholderText('e.g. Skyblock');
    fireEvent.change(input, { target: { value: 'Sky Block!' } });
    expect(screen.getByText('Will be added as SkyBlock')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(screen.getByText('SkyBlock')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(upsertCustomProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the server address')).toBeInTheDocument();
  });
});
