import { fireEvent, render, screen } from '@testing-library/react';
import CooldownRow from './CooldownRow';
import { toggleAutoStartCooldown } from '../../../redux/settings';
import type { ScriptCooldown } from '../../../../common/cooldowns';

jest.mock('../../../redux/settings', () => ({
  toggleAutoStartCooldown: jest.fn(),
}));

const cooldown: ScriptCooldown = {
  id: 'c',
  name: 'Mining',
  pluginId: 'miner',
  time: 0,
  cooldown: 60_000,
};
const handlers = {
  onEdit: jest.fn(),
  onRun: jest.fn(),
  onReset: jest.fn(),
  onDelete: jest.fn(),
};

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

beforeEach(() => jest.clearAllMocks());

test('a pending cooldown shows auto-run and the menu, but no run button', () => {
  render(<CooldownRow reminder={cooldown} now={1_000} {...handlers} />);
  expect(screen.getByRole('button', { name: 'Auto-run when ready' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'More actions for Mining' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Run script' })).toBeNull();
});

test('a ready cooldown shows run and moves auto-run into the menu', async () => {
  render(<CooldownRow reminder={cooldown} now={120_000} {...handlers} />);
  expect(screen.queryByRole('button', { name: 'Auto-run when ready' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Run script' }));
  expect(handlers.onRun).toHaveBeenCalledWith(cooldown);
  expect(handlers.onEdit).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'More actions for Mining' }));
  fireEvent.click(await screen.findByText('Auto-run when ready'));
  expect(toggleAutoStartCooldown).toHaveBeenCalledWith('c');
});
