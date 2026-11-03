import React, { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import SelectFolder from './SelectFolder';

const get = jest.fn();
const onChange = jest.fn();

function FolderPicker() {
  const [value, setValue] = useState('/existing/logs');
  return (
    <SelectFolder
      id="log-directory"
      label="Log directory"
      value={value}
      onChange={(directory) => {
        onChange(directory);
        setValue(directory);
      }}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { get },
  });
});

it('updates the log directory using the platform picker result', async () => {
  get.mockResolvedValue({ canceled: false, path: '/selected/logs' });
  render(<FolderPicker />);

  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(onChange).toHaveBeenCalledWith('/selected/logs'));
  expect(get).toHaveBeenCalledWith('SELECT_DIRECTORY');
  expect(screen.getByLabelText('Log directory')).toHaveValue('/selected/logs');
});

it.each([
  { canceled: true },
  { canceled: true, path: '/selected/logs' },
  { canceled: false },
  { canceled: false, path: '' },
])('preserves the directory for an unselected result: %j', async (result) => {
  get.mockResolvedValue(result);
  render(<FolderPicker />);

  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });

  expect(get).toHaveBeenCalledWith('SELECT_DIRECTORY');
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Log directory')).toHaveValue('/existing/logs');
});
