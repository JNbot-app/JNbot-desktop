import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScheduleOverrides from './ScheduleOverrides';
import { useSettingsStore } from '../../../redux/settings';
import type { MacroInfo } from '../../../../main/src/types';

const plugin: MacroInfo = {
  name: 'Mining',
  description: '',
  pluginId: 'miner',
  language: 'js',
  scriptType: 'script',
  createdAt: 0,
  editedAt: null,
  public: false,
  config: [
    {
      name: 'Options',
      options: [
        {
          id: 'message',
          label: 'Message',
          type: 'input',
          defaultValue: 'Default',
        },
      ],
    },
  ],
};
const onChange = jest.fn();
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
function Editor() {
  const [values, setValues] = useState<Record<string, unknown>>({});
  return (
    <ScheduleOverrides
      plugin={plugin}
      values={values}
      onChange={(next) => {
        setValues(next);
        onChange(next);
      }}
    />
  );
}

beforeEach(() => {
  onChange.mockClear();
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      scripts: { miner: { message: 'Saved message' } },
    },
  });
});

test('displays inherited values in existing option controls and restores inheritance', async () => {
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: /Script overrides/ }));
  const field = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(field).toHaveValue('Saved message'));
  fireEvent.change(field, { target: { value: 'Scheduled message' } });
  expect(onChange).toHaveBeenLastCalledWith({ message: 'Scheduled message' });
  fireEvent.click(screen.getByRole('button', { name: 'Use saved setting' }));
  expect(onChange).toHaveBeenLastCalledWith({});
  await waitFor(() => expect(field).toHaveValue('Saved message'));
  expect(useSettingsStore.getState().settings.scripts.miner.message).toBe(
    'Saved message',
  );
});

test('shows the inherited values of the picked preset', async () => {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      scripts: {
        miner: {
          message: 'Saved message',
          $presets: { second: { name: 'Second', values: { message: 'Preset message' } } },
        },
      },
    },
  });
  render(<Editor />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Preset' }));
  fireEvent.click(await screen.findByText('Second'));
  expect(onChange).toHaveBeenLastCalledWith({ $preset: 'second' });
  fireEvent.click(screen.getByRole('button', { name: /Script overrides/ }));
  const field = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(field).toHaveValue('Preset message'));
});
