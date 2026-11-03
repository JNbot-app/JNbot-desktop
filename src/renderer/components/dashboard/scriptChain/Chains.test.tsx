import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Chains from './Chains';
import { useSettingsStore } from '../../../redux/settings';
import SidePanel from '../../other/botSideBar/SidePanel';
import SidePanelContextProvider, {
  usePanelContext,
} from '../../other/botSideBar/SidePanelContextProvider';

jest.mock('../../other/botSideBar/panelTabs/LogsTab', () => () => null);
jest.mock('../../other/botSideBar/botPanel/BotPanel', () => () => null);
jest.mock('../../mcLauncher/tabs/MinecraftProjectPanel', () => ({
  __esModule: true,
  default: () => null,
  MINECRAFT_PROJECT_TAB: 'minecraft-project',
}));

function ChainDashboard() {
  const { panel, setPanel } = usePanelContext();
  return (
    <>
      <Chains />
      {panel.active && (
        <SidePanel
          activeTab={panel.tab}
          onClose={() => setPanel((current) => ({ ...current, active: false }))}
          onTabChange={(tab) => setPanel((current) => ({ ...current, tab }))}
        />
      )}
    </>
  );
}

function renderDashboard() {
  return render(
    <SidePanelContextProvider>
      <ChainDashboard />
    </SidePanelContextProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'MessageChannel', {
    value: class {
      port1 = { onmessage: () => {} };
      port2 = { postMessage: () => setTimeout(() => this.port1.onmessage(), 0) };
    },
  });
  window.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  Object.defineProperty(window, 'ipcRenderer', {
    value: { get: jest.fn().mockResolvedValue([]) },
  });
});

beforeEach(() => {
  const current = useSettingsStore.getState();
  useSettingsStore.setState({
    ...current,
    selectedProfileId: null,
    selectedProfileKey: 'test-server',
    JNdata: { ...current.JNdata, data: { 'test-server': { gamemodes: ['Skyblock'] } } } as any,
    settings: { ...current.settings, scripts: {} },
  });
});

it('keeps a new chain unsaved until setup is complete and discards cancellation', async () => {
  renderDashboard();
  fireEvent.click(screen.getByRole('button', { name: /New chain/ }));
  expect(screen.getByRole('tab', { name: 'New chain' })).toBeInTheDocument();
  expect(await screen.findByLabelText('Chain name')).toHaveValue('');
  expect(useSettingsStore.getState().settings.scripts.chains).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Create chain' }));
  await screen.findByText('Enter a chain name.');
  expect(useSettingsStore.getState().settings.scripts.chains).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(screen.queryByLabelText('Chain name')).not.toBeInTheDocument(),
  );
  expect(useSettingsStore.getState().settings.scripts.chains).toBeUndefined();
});

it('creates a named chain with the chosen settings and reuses the settings panel for edits', async () => {
  renderDashboard();
  fireEvent.click(screen.getByRole('button', { name: /New chain/ }));
  fireEvent.change(await screen.findByLabelText('Chain name'), {
    target: { value: ' Daily rewards ' },
  });
  fireEvent.mouseDown(screen.getByLabelText('Gamemode'));
  expect(screen.queryByText('any', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByText('Skyblock', {
      selector: '.ant-select-item-option-content',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create chain' }));
  await waitFor(() =>
    expect(
      Object.values(useSettingsStore.getState().settings.scripts.chains ?? {}),
    ).toHaveLength(1),
  );
  const chain = Object.values(
    useSettingsStore.getState().settings.scripts.chains,
  )[0];
  expect(chain).toMatchObject({ name: 'Daily rewards', chains: [] });
  expect(useSettingsStore.getState().settings.scripts[chain.id]).toMatchObject({
    name: 'Daily rewards',
    gamemode: 'Skyblock',
  });
  expect(screen.getByText('Gamemode: Skyblock')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Settings$/ }));
  expect(
    screen.getByRole('tab', { name: 'Chain settings' }),
  ).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText('Chain name'), {
    target: { value: 'Evening rewards' },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: ' Claims every kit ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.scripts[chain.id]).toMatchObject({
      name: 'Evening rewards',
      description: 'Claims every kit',
    }),
  );
  // Shown in the chain list and above the steps.
  expect(await screen.findAllByText('Claims every kit')).toHaveLength(2);
});
