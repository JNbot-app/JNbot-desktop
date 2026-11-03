import type {
  MinecraftCrashInfo,
  MinecraftInstallProgressPayload,
  MinecraftLaunchStatusPayload,
} from '../../main/src/types';
import {
  initialLauncherState,
  isMinecraftInstallProgressPayload,
  launcherStateReducer,
} from './launcherState';

const status = (
  stage: MinecraftLaunchStatusPayload['stage'],
  overrides: Partial<MinecraftLaunchStatusPayload> = {},
): MinecraftLaunchStatusPayload => ({
  bridgeInstanceId: 'launch-a',
  stage,
  username: 'Steve',
  version: '1.21.11',
  ...overrides,
});

describe('launcherStateReducer', () => {
  test('moves through an installed-version launch without inventing 0% progress', () => {
    let state = launcherStateReducer(initialLauncherState, {
      type: 'request',
      bridgeInstanceId: 'launch-a',
    });
    state = launcherStateReducer(state, {
      type: 'status',
      payload: status('installing'),
    });
    expect(state).toEqual({ kind: 'preparing', bridgeInstanceId: 'launch-a' });

    state = launcherStateReducer(state, {
      type: 'status',
      payload: status('launching'),
    });
    expect(state).toEqual({ kind: 'starting', bridgeInstanceId: 'launch-a' });
  });

  test('shows validated and clamped task progress', () => {
    const preparing = launcherStateReducer(
      { kind: 'preparing', bridgeInstanceId: 'launch-a' },
      {
        type: 'progress',
        payload: {
          bridgeInstanceId: 'launch-a',
          name: 'client.jar',
          progress: 150,
          total: 100,
          state: 'running',
        },
      },
    );

    expect(preparing).toEqual({
      kind: 'downloading',
      bridgeInstanceId: 'launch-a',
      taskName: 'client.jar',
      percent: 100,
    });
  });

  test('ignores status and progress from older processes', () => {
    const running = { kind: 'running', bridgeInstanceId: 'launch-b' } as const;
    expect(
      launcherStateReducer(running, {
        type: 'status',
        payload: status('exit'),
      }),
    ).toBe(running);
    expect(
      launcherStateReducer(running, {
        type: 'progress',
        payload: {
          bridgeInstanceId: 'launch-a',
          name: 'old',
          progress: 1,
          total: 2,
          state: 'running',
        },
      }),
    ).toBe(running);
  });

  test('persists normal exits and exposes crash details after failures', () => {
    const running = { kind: 'running', bridgeInstanceId: 'launch-a' } as const;
    expect(
      launcherStateReducer(running, {
        type: 'status',
        payload: status('exit', { code: 0 }),
      }),
    ).toEqual({ kind: 'exited', bridgeInstanceId: 'launch-a' });

    const failed = launcherStateReducer(running, {
      type: 'status',
      payload: status('exit', { code: 1 }),
    });
    const crashInfo: MinecraftCrashInfo = {
      bridgeInstanceId: 'launch-a',
      username: 'Steve',
      version: '1.21.11',
      instancePath: '/minecraft',
    };
    expect(
      launcherStateReducer(failed, { type: 'crash', payload: crashInfo }),
    ).toMatchObject({ kind: 'failed', crashInfo });
  });
});

describe('isMinecraftInstallProgressPayload', () => {
  test.each([
    null,
    {},
    { bridgeInstanceId: 'a', progress: -1, total: 2, name: 'x', state: 'x' },
    { bridgeInstanceId: 'a', progress: 1, total: 0, name: 'x', state: 'x' },
    { bridgeInstanceId: 'a', progress: NaN, total: 2, name: 'x', state: 'x' },
  ])('rejects invalid progress %#', (payload) => {
    expect(isMinecraftInstallProgressPayload(payload)).toBe(false);
  });

  test('accepts measurable progress', () => {
    const payload: MinecraftInstallProgressPayload = {
      bridgeInstanceId: 'a',
      progress: 0,
      total: 2,
      name: 'client.jar',
      state: 'running',
    };
    expect(isMinecraftInstallProgressPayload(payload)).toBe(true);
  });
});
