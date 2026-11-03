import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LaunchStatusPanel from './LaunchStatusPanel';

const actions = {
  onOpenLogs: jest.fn(),
  onOpenCrashReport: jest.fn(),
};

describe('LaunchStatusPanel', () => {
  test.each([
    ['preparing', 'Checking installation…'],
    ['starting', 'Starting Minecraft…'],
  ] as const)('does not show fake progress while %s', (kind, label) => {
    render(
      <LaunchStatusPanel
        state={{ kind, bridgeInstanceId: 'launch-a' }}
        {...actions}
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  test('shows determinate progress only for a measurable download', () => {
    render(
      <LaunchStatusPanel
        state={{
          kind: 'downloading',
          bridgeInstanceId: 'launch-a',
          taskName: 'client.jar',
          percent: 42,
        }}
        {...actions}
      />,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(screen.getByText('client.jar')).toBeInTheDocument();
  });

  test('keeps success and normal exit outcomes visible', () => {
    const { rerender } = render(
      <LaunchStatusPanel
        state={{ kind: 'running', bridgeInstanceId: 'launch-a' }}
        {...actions}
      />,
    );
    expect(screen.getByText('Minecraft is running')).toBeInTheDocument();

    rerender(
      <LaunchStatusPanel
        state={{ kind: 'exited', bridgeInstanceId: 'launch-a' }}
        {...actions}
      />,
    );
    expect(screen.getByText('Minecraft closed')).toBeInTheDocument();
  });

  test('offers logs and a crash report for a diagnosed failure', () => {
    render(
      <LaunchStatusPanel
        state={{
          kind: 'failed',
          bridgeInstanceId: 'launch-a',
          message: 'Process failed',
          crashInfo: {
            bridgeInstanceId: 'launch-a',
            username: 'Steve',
            version: '1.21.11',
            instancePath: '/minecraft',
          },
        }}
        {...actions}
      />,
    );

    expect(screen.getByText('Process failed')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view logs/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view crash report/i }),
    ).toBeInTheDocument();
  });
});
