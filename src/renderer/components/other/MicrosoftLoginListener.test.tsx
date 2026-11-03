import React from 'react';
import { act, render, screen } from '@testing-library/react';
import MicrosoftLoginListener from './MicrosoftLoginListener';

let mockBots: Array<{ username: string; status: string }> = [];
jest.mock('../../redux/settings', () => ({
  useSettingsStore: (
    selector: (state: { activeBots: typeof mockBots }) => unknown,
  ) => selector({ activeBots: mockBots }),
}));
jest.mock('../mcLauncher/MicrosoftLoginModal', () => ({
  __esModule: true,
  default: ({ open, userCode }: { open: boolean; userCode: string }) =>
    open ? <div>{userCode}</div> : null,
}));

test('closes only when the prompted account is connected, and removes the event listener', () => {
  let onCode: (payload: unknown) => void = () => {};
  const remove = jest.fn();
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: {
      on: jest.fn((_event, listener) => {
        onCode = listener;
        return remove;
      }),
    },
  });
  const { rerender, unmount } = render(<MicrosoftLoginListener />);
  act(() =>
    onCode({
      username: 'Alpha',
      userCode: 'ABC123',
      verificationUri: 'https://www.microsoft.com/link',
    }),
  );
  expect(screen.getByText('ABC123')).toBeInTheDocument();
  mockBots = [
    { username: 'Alpha', status: 'queued' },
    { username: 'Beta', status: 'connected' },
  ];
  rerender(<MicrosoftLoginListener />);
  expect(screen.getByText('ABC123')).toBeInTheDocument();
  mockBots = [{ username: 'Alpha', status: 'failed' }];
  rerender(<MicrosoftLoginListener />);
  expect(screen.getByText('ABC123')).toBeInTheDocument();
  mockBots = [{ username: 'alpha', status: 'connected' }];
  rerender(<MicrosoftLoginListener />);
  expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
  act(() => onCode({ userCode: 'OTHER123' }));
  expect(screen.getByText('OTHER123')).toBeInTheDocument();
  unmount();
  expect(remove).toHaveBeenCalled();
});
