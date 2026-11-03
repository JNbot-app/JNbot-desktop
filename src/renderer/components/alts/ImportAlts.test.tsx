import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ImportAlts from './ImportAlts';

const mockGet = jest.fn();
const mockSaveAlt = jest.fn();
const mockMessage = { success: jest.fn(), error: jest.fn() };
const mockState = {
  active: 'current',
  alts: [
    {
      username: 'CurrentAlt',
      UID: null,
      data: { premium: false, password: '', ranks: {}, gkits: {} },
    },
  ],
  shared: [
    { username: 'CurrentAlt' },
    { username: 'Alpha' },
    { username: 'Bravo' },
  ],
  jndata: { servers: {} },
};
jest.mock('../../redux/settings', () => ({
  useSettingsStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
  selectActiveServerId: (state: typeof mockState) => state.active,
  selectAlts: (state: typeof mockState) => state.alts,
  selectSharedAlts: (state: typeof mockState) => state.shared,
  selectJNdata: (state: typeof mockState) => state.jndata,
  saveAlt: (...args: unknown[]) => mockSaveAlt(...args),
}));
jest.mock('../../hooks/useAppApi', () => ({
  __esModule: true,
  default: () => ({ message: mockMessage }),
}));
jest.mock('../../../common/serverInfo', () => ({
  getServerMeta: (_data: unknown, id: string) => ({
    id,
    name: id,
    shortName: id,
    onlineMode: false,
  }),
  getAllServerMeta: () => [
    { id: 'current', name: 'Current' },
    { id: 'source', name: 'Source' },
  ],
}));

beforeAll(() => {
  Object.defineProperty(window, 'MessageChannel', {
    configurable: true,
    value: class {
      port1 = { onmessage: () => {} };
      port2 = {
        postMessage: () => setTimeout(() => this.port1.onmessage(), 0),
      };
    },
  });
  global.ResizeObserver = jest.fn(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }),
  });
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { get: mockGet },
  });
});

it('requests the selected source profile rather than the current profile', async () => {
  mockGet.mockImplementation((_event, payload) =>
    Promise.resolve(
      payload?.profileKey === 'source'
        ? [
            {
              username: 'SourceAlt',
              data: { premium: false, password: '', ranks: {}, gkits: {} },
            },
          ]
        : mockState.alts,
    ),
  );
  render(React.createElement(ImportAlts));
  fireEvent.click(screen.getByRole('button', { name: /Import$/ }));
  fireEvent.click(screen.getByRole('tab', { name: /From another profile/ }));
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByText('Source'));
  await waitFor(() =>
    expect(mockGet).toHaveBeenCalledWith('ALTS_OF_PROFILE', {
      profileKey: 'source',
    }),
  );
  expect((await screen.findAllByText('SourceAlt')).length).toBeGreaterThan(0);
  expect(screen.queryByText('CurrentAlt')).not.toBeInTheDocument();
});

it('imports only explicitly selected existing accounts and preserves selection while searching', async () => {
  render(React.createElement(ImportAlts));
  fireEvent.click(screen.getByRole('button', { name: /Import$/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Existing accounts/ }));
  const tab = within(screen.getByRole('tabpanel', { name: /Existing accounts/ }));
  expect(screen.getByRole('button', { name: 'Add 0 Alts' })).toBeDisabled();
  expect(tab.queryByLabelText('Password for Alpha')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Import Alpha' }));
  expect(tab.getByLabelText('Password for Alpha')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search alts'), {
    target: { value: 'brAV' },
  });
  await waitFor(() =>
    expect(tab.queryByText('Alpha')).not.toBeInTheDocument(),
  );
  expect(tab.getByText('Bravo')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 Alt' }));
  expect(mockSaveAlt).toHaveBeenCalledTimes(1);
  expect(mockSaveAlt.mock.calls[0][0].alt.username).toBe('Alpha');
});
