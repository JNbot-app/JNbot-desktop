import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DesktopBackgroundSetting from './DesktopBackgroundSetting';
import { getSettingsSchema } from './settingsSchema';

const invoke = jest.fn();
const message = { error: jest.fn() };

jest.mock('../../hooks/useAppApi', () => ({
  __esModule: true,
  default: () => ({ message }),
}));
jest.mock('./KickBehavior', () => () => null);
jest.mock('./ProxySettings', () => () => null);
jest.mock('./PublisherIdentity', () => () => null);

beforeEach(() => {
  jest.clearAllMocks();
  window.web = false;
  Object.defineProperty(window, '__JNdata', {
    configurable: true,
    value: { fullVersions: [] },
  });
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke },
  });
});

test('loads and updates the device preference without changing portable app settings', async () => {
  invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<DesktopBackgroundSetting />);
  const control = screen.getByRole('switch');
  await waitFor(() => expect(control).not.toBeDisabled());
  expect(control).not.toBeChecked();
  fireEvent.click(control);
  await waitFor(() => expect(control).toBeChecked());
  expect(invoke.mock.calls).toEqual([
    ['desktop:background:get'],
    ['desktop:background:set', true],
  ]);
});

test('keeps the existing value if enabling background mode fails', async () => {
  invoke
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error('Tray unavailable'));
  render(<DesktopBackgroundSetting />);
  const control = screen.getByRole('switch');
  await waitFor(() => expect(control).not.toBeDisabled());
  fireEvent.click(control);
  await waitFor(() => expect(message.error).toHaveBeenCalledTimes(1));
  expect(control).not.toBeChecked();
  expect(control).not.toBeDisabled();
});

test('offers the preference only in the desktop settings schema', () => {
  const desktopSettings = getSettingsSchema().flatMap((tab) => tab.settings);
  expect(
    desktopSettings.some((setting) => setting.key === 'desktopBackgroundMode'),
  ).toBe(true);
  window.web = true;
  const remoteSettings = getSettingsSchema().flatMap((tab) => tab.settings);
  expect(
    remoteSettings.some((setting) => setting.key === 'desktopBackgroundMode'),
  ).toBe(false);
});
