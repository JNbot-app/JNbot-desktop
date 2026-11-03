import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScheduleEditor from './ScheduleEditor';
import {
  useSettingsStore,
  addSchedule,
  setCooldown,
} from '../../../redux/settings';
import type { ScriptSchedule } from '../../../../common/cooldowns';

jest.mock('./useScheduleScripts', () => ({
  useScheduleScripts: () => ({
    loading: false,
    scripts: [
      {
        info: {
          pluginId: 'miner',
          name: 'Mining',
          scriptType: 'script',
          config: [],
        },
      },
    ],
  }),
}));
jest.mock('./ScheduleOverrides', () => ({
  __esModule: true,
  default: () => null,
}));
const mockPanel = jest.fn();
jest.mock('../../other/botSideBar/SidePanelContextProvider', () => ({
  usePanelContext: () => ({ setPanel: mockPanel }),
}));
jest.mock('../../../redux/settings', () => ({
  ...jest.requireActual('../../../redux/settings'),
  addSchedule: jest.fn(),
  setCooldown: jest.fn(),
}));

const schedule: ScriptSchedule = {
  kind: 'schedule',
  id: 's',
  name: 'Mining',
  pluginId: 'miner',
  nextRunAt: Date.now() + 86_400_000,
  autoStart: true,
};

beforeAll(() => {
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

beforeEach(() => {
  jest.clearAllMocks();
  useSettingsStore.setState({
    selectedProfileId: 7,
    remoteCapabilities: null,
    settings: {
      scripts: {},
      pluginData: {},
      reminders: [schedule],
      triggers: [],
      altTags: [],
      altData: {},
      version: 2,
    },
  });
});

test('saves the selected script as a schedule with inherited options', async () => {
  render(<ScheduleEditor schedule={schedule} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await waitFor(() =>
    expect(setCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'schedule',
        pluginId: 'miner',
        options: undefined,
        repeat: undefined,
        autoStart: true,
      }),
    ),
  );
  expect(addSchedule).not.toHaveBeenCalled();
  expect(mockPanel).toHaveBeenCalled();
});

test('expired dates keep the editor open with a recovery message', async () => {
  render(<ScheduleEditor schedule={{ ...schedule, nextRunAt: 1 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose a future date and time.',
  );
  expect(setCooldown).not.toHaveBeenCalled();
});

test('does not recreate a schedule that expired while being edited', async () => {
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, reminders: [] },
  });
  render(<ScheduleEditor schedule={schedule} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'expired or was deleted',
  );
  expect(setCooldown).not.toHaveBeenCalled();
});
