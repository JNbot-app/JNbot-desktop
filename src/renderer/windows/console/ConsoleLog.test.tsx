import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { LogStatus } from '../../../common/CommonEnums';
import type { FullLogMessage } from '../../../main/src/types';
import ConsoleLog, { ConsoleLogRef } from './ConsoleLog';

jest.mock('nanoid', () => {
  let nextId = 0;
  return {
    nanoid: () => {
      nextId += 1;
      return String(nextId);
    },
  };
});

jest.mock('react-inspector', () => ({
  chromeDark: {},
  Inspector: ({ data }: { data: unknown }) => (
    <span>{JSON.stringify(data)}</span>
  ),
}));

const log = (
  message: FullLogMessage[0],
  scriptName = 'Miner',
): FullLogMessage => [message, LogStatus.INFO, scriptName, 'script-id', 0];

beforeEach(() => {
  global.ResizeObserver = jest.fn(() => ({
    observe: jest.fn(),
    disconnect: jest.fn(),
    unobserve: jest.fn(),
  }));
});

it('searches messages, object values, and script names without losing hidden logs', () => {
  const ref = createRef<ConsoleLogRef>();
  const view = render(<ConsoleLog ref={ref} />);
  act(() =>
    ref.current?.set([
      log('Connected'),
      log({ error: 'Connection refused' }, 'Builder'),
    ]),
  );

  view.rerender(<ConsoleLog ref={ref} searchQuery="  REFUSED  " />);
  expect(screen.getByText(/Connection refused/)).toBeInTheDocument();
  expect(screen.queryByText('"Connected"')).not.toBeInTheDocument();

  view.rerender(<ConsoleLog ref={ref} searchQuery="mINer" />);
  expect(screen.getByText('"Connected"')).toBeInTheDocument();
  expect(screen.queryByText(/Connection refused/)).not.toBeInTheDocument();

  view.rerender(<ConsoleLog ref={ref} searchQuery="" />);
  expect(screen.getByText('"Connected"')).toBeInTheDocument();
  expect(screen.getByText(/Connection refused/)).toBeInTheDocument();
});

it('filters incoming rows and copies only the matching logs', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const ref = createRef<ConsoleLogRef>();
  const view = render(<ConsoleLog ref={ref} searchQuery="error" />);
  expect(screen.getByRole('status')).toHaveTextContent('No matching logs');

  act(() => ref.current?.addLogs([log('All good'), log('New ERROR')]));
  act(() => ref.current?.addString('Another error'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText('"All good"')).not.toBeInTheDocument();
  expect(screen.getByText('"New ERROR"')).toBeInTheDocument();
  expect(screen.getByText('Another error')).toBeInTheDocument();

  await act(async () => ref.current?.copy());
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('New ERROR'));
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining('Another error'),
  );
  expect(writeText).not.toHaveBeenCalledWith(
    expect.stringContaining('All good'),
  );

  view.rerender(<ConsoleLog ref={ref} searchQuery=" " />);
  expect(screen.getByText('"All good"')).toBeInTheDocument();
});
