import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PresetBar from './PresetBar';
import PresetSelect from './PresetSelect';
import RunningControls from '../../../macros/RunningControls';
import {
  createPluginPreset,
  deletePluginPreset,
  selectPluginPreset,
  updateScriptSettings,
  useSettingsStore,
} from '../../../../redux/settings';

jest.mock('../../../../hooks/useAppApi', () => ({
  __esModule: true,
  default: () => ({ modal: jest.requireActual('antd').Modal }),
}));

const setScripts = (scripts: Record<string, any>) =>
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, scripts },
  });
const stored = () => useSettingsStore.getState().settings.scripts.miner;

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
});

const ipcGet = jest.fn(async () => []);
const ipcAction = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (window as any).ipcRenderer = { get: ipcGet, action: ipcAction };
  useSettingsStore.setState({ activeScripts: {} });
  setScripts({ miner: { message: 'Default message' } });
});

describe('preset settings', () => {
  test('a new preset starts as a copy and edits stay inside it', () => {
    createPluginPreset('miner', 'Second', 'second');
    updateScriptSettings({ scriptName: 'miner', optionId: 'message', value: 'Edited' });
    expect(stored().message).toBe('Default message');
    expect(stored().$presets.second).toEqual({
      name: 'Second',
      values: { message: 'Edited' },
    });
  });

  test('switching back to Default edits the flat settings again', () => {
    createPluginPreset('miner', 'Second', 'second');
    selectPluginPreset('miner', 'default');
    updateScriptSettings({ scriptName: 'miner', optionId: 'message', value: 'Edited' });
    expect(stored().message).toBe('Edited');
    expect(stored().$presets.second.values.message).toBe('Default message');
  });

  test('deleting the selected preset returns to Default', () => {
    createPluginPreset('miner', 'Second', 'second');
    deletePluginPreset('miner', 'second');
    expect(stored().$preset).toBe('default');
    expect(stored().$presets).toEqual({});
  });
});

describe('PresetBar', () => {
  test('is a single button until a preset exists', async () => {
    render(<PresetBar pluginId="miner" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /New preset/ }));
    fireEvent.change(await screen.findByLabelText('Preset name'), {
      target: { value: 'Alts 11-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(Object.values<any>(stored().$presets)[0].name).toBe('Alts 11-20');
  });
});

describe('PresetSelect', () => {
  test('renders nothing for plugins without presets', () => {
    const { container } = render(<PresetSelect pluginId="miner" onChange={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('defaults to the current preset', () => {
    createPluginPreset('miner', 'Second', 'second');
    render(<PresetSelect pluginId="miner" onChange={jest.fn()} />);
    expect(screen.getByText('Current preset')).toBeInTheDocument();
  });
});

describe('RunningControls', () => {
  const instance = (instanceId: number, presetName?: string) => ({
    name: 'Miner',
    scriptId: 'miner',
    instanceId,
    presetName,
  });

  test('one instance: Stop stops it and the plus runs another right away', () => {
    useSettingsStore.setState({ activeScripts: { 1: instance(1) } });
    render(<RunningControls pluginId="miner" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run another instance' }));
    expect(ipcGet).toHaveBeenCalledWith(
      'START_SCRIPT',
      expect.objectContaining({
        arguments: expect.objectContaining({ macroInfo: { name: undefined, pluginId: 'miner' } }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(ipcAction).toHaveBeenCalledWith('STOP', 1);
  });

  test('with presets the plus asks which preset to run', async () => {
    createPluginPreset('miner', 'Second', 'second');
    useSettingsStore.setState({ activeScripts: { 1: instance(1) } });
    render(<RunningControls pluginId="miner" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run another instance' }));
    fireEvent.click(await screen.findByText('Second'));
    expect(ipcGet).toHaveBeenCalledWith(
      'START_SCRIPT',
      expect.objectContaining({
        arguments: expect.objectContaining({ optionOverrides: { $preset: 'second' } }),
      }),
    );
  });

  test('several instances: Stop asks which one, by preset', async () => {
    useSettingsStore.setState({
      activeScripts: { 1: instance(1), 2: instance(2, 'Second') },
    });
    render(<RunningControls pluginId="miner" />);
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(within(stop).getByText('Stop (2)')).toBeInTheDocument();
    fireEvent.click(stop);
    expect(ipcAction).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('Stop 2. Second'));
    expect(ipcAction).toHaveBeenCalledWith('STOP', 2);
  });
});
