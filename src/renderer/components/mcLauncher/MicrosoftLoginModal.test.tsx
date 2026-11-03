import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import MicrosoftLoginModal from './MicrosoftLoginModal';
import { ConfigProvider } from 'antd';

const renderModal = (element: React.ReactElement) =>
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      {element}
    </ConfigProvider>,
  );
const button = (name: string) =>
  name === 'Copy verification URL'
    ? screen.getByLabelText(name)
    : screen.getByText(name).closest('button');

const mockMessage = { success: jest.fn(), error: jest.fn() };
jest.mock('../../hooks/useAppApi', () => ({
  __esModule: true,
  default: () => ({ message: mockMessage }),
}));

const props = {
  open: true,
  expiresAt: undefined,
  userCode: 'ABC123',
  verificationUri: 'https://www.microsoft.com/link',
  onClose: jest.fn(),
};
const writeText = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('shows and copies the code, supplied URL, and combined message', async () => {
  renderModal(<MicrosoftLoginModal {...props} />);
  expect(screen.getByText(props.userCode)).toBeInTheDocument();
  expect(screen.getByText(props.verificationUri)).toBeInTheDocument();
  fireEvent.click(button('Copy code')!);
  fireEvent.click(button('Copy verification URL')!);
  fireEvent.click(button('Copy URL and code')!);
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
  expect(writeText.mock.calls.map(([value]) => value)).toEqual([
    props.userCode,
    props.verificationUri,
    `${props.verificationUri}\nCode: ${props.userCode}`,
  ]);
});

test('opens the supplied URL and reports open and clipboard failures', async () => {
  const open = jest.spyOn(window, 'open').mockImplementation(() => {
    throw new Error('blocked');
  });
  writeText.mockRejectedValueOnce(new Error('denied'));
  renderModal(<MicrosoftLoginModal {...props} />);
  fireEvent.click(button('Open Microsoft')!);
  expect(open).toHaveBeenCalledWith(
    props.verificationUri,
    '_blank',
    'noopener,noreferrer',
  );
  fireEvent.click(button('Copy code')!);
  await waitFor(() => expect(mockMessage.error).toHaveBeenCalledTimes(2));
});

test('expires, resets for a new code, and cleans up its timer on dismissal', () => {
  jest.useFakeTimers().setSystemTime(1000);
  const { rerender, unmount } = renderModal(
    <MicrosoftLoginModal {...props} expiresAt={3000} />,
  );
  expect(screen.getByText('Expires in 0:02')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(2000));
  for (const name of [
    'Open Microsoft',
    'Copy code',
    'Copy verification URL',
    'Copy URL and code',
  ]) {
    expect(button(name)).toBeDisabled();
  }
  rerender(
    <MicrosoftLoginModal {...props} userCode="NEW123" expiresAt={5000} />,
  );
  expect(button('Open Microsoft')!).toBeEnabled();
  const clear = jest.spyOn(global, 'clearInterval');
  rerender(
    <MicrosoftLoginModal {...props} open={false} expiresAt={5000} />,
  );
  expect(clear).toHaveBeenCalled();
  unmount();
});

test('does not invent an expiry when it is absent', () => {
  renderModal(<MicrosoftLoginModal {...props} />);
  expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument();
  expect(button('Open Microsoft')!).toBeEnabled();
});
