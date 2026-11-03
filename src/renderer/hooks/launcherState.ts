import type {
  LaunchLogEntry,
  MinecraftCrashInfo,
  MinecraftInstallProgressPayload,
  MinecraftLaunchLogBatch,
  MinecraftLaunchLogSnapshot,
  MinecraftLaunchStage,
  MinecraftLaunchStatusPayload,
} from '../../main/src/types';

export type LauncherState =
  | { kind: 'idle' }
  | { kind: 'preparing'; bridgeInstanceId: string | null }
  | {
      kind: 'downloading';
      bridgeInstanceId: string;
      taskName: string;
      percent: number;
    }
  | { kind: 'starting'; bridgeInstanceId: string }
  | { kind: 'running'; bridgeInstanceId: string }
  | { kind: 'exited'; bridgeInstanceId: string }
  | {
      kind: 'failed';
      bridgeInstanceId: string | null;
      message: string;
      crashInfo?: MinecraftCrashInfo;
    };

type LauncherAction =
  | { type: 'request'; bridgeInstanceId: string }
  | { type: 'request-failed'; message: string }
  | { type: 'status'; payload: MinecraftLaunchStatusPayload }
  | { type: 'progress'; payload: MinecraftInstallProgressPayload }
  | { type: 'crash'; payload: MinecraftCrashInfo };

export const initialLauncherState: LauncherState = { kind: 'idle' };

const launchStages = new Set<MinecraftLaunchStage>([
  'installing-modloader',
  'installing',
  'launching',
  'window-ready',
  'exit',
  'error',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const activeId = (state: LauncherState): string | null =>
  state.kind === 'idle' ? null : state.bridgeInstanceId;

export const isMinecraftLaunchStatusPayload = (
  value: unknown,
): value is MinecraftLaunchStatusPayload => {
  if (!isRecord(value)) return false;
  return (
    typeof value.bridgeInstanceId === 'string' &&
    typeof value.stage === 'string' &&
    launchStages.has(value.stage as MinecraftLaunchStage) &&
    typeof value.username === 'string' &&
    typeof value.version === 'string' &&
    (value.error === undefined || typeof value.error === 'string') &&
    (value.code === undefined ||
      value.code === null ||
      typeof value.code === 'number')
  );
};

export const isMinecraftInstallProgressPayload = (
  value: unknown,
): value is MinecraftInstallProgressPayload => {
  if (!isRecord(value)) return false;
  return (
    typeof value.bridgeInstanceId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.state === 'string' &&
    typeof value.progress === 'number' &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    typeof value.total === 'number' &&
    Number.isFinite(value.total) &&
    value.total > 0
  );
};

const isLaunchLogEntry = (value: unknown): value is LaunchLogEntry => {
  if (!isRecord(value)) return false;
  return (
    typeof value.sequence === 'number' &&
    Number.isFinite(value.sequence) &&
    typeof value.bridgeInstanceId === 'string' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    typeof value.message === 'string' &&
    (value.type === 'stdout' ||
      value.type === 'stderr' ||
      value.type === 'info' ||
      value.type === 'error')
  );
};

export const isMinecraftLaunchLogSnapshot = (
  value: unknown,
): value is MinecraftLaunchLogSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.entries)) return false;
  return (
    (value.bridgeInstanceId === null ||
      typeof value.bridgeInstanceId === 'string') &&
    typeof value.truncated === 'boolean' &&
    value.entries.every(isLaunchLogEntry)
  );
};

export const isMinecraftLaunchLogBatch = (
  value: unknown,
): value is MinecraftLaunchLogBatch =>
  isMinecraftLaunchLogSnapshot(value) &&
  typeof (value as Record<string, unknown>).reset === 'boolean';

export const isMinecraftCrashInfo = (
  value: unknown,
): value is MinecraftCrashInfo => {
  if (!isRecord(value)) return false;
  return (
    typeof value.bridgeInstanceId === 'string' &&
    typeof value.username === 'string' &&
    typeof value.version === 'string' &&
    typeof value.instancePath === 'string'
  );
};

export const launcherStateReducer = (
  state: LauncherState,
  action: LauncherAction,
): LauncherState => {
  if (action.type === 'request') {
    return {
      kind: 'preparing',
      bridgeInstanceId: action.bridgeInstanceId,
    };
  }

  if (action.type === 'request-failed') {
    return {
      kind: 'failed',
      bridgeInstanceId: activeId(state),
      message: action.message,
    };
  }

  if (action.type === 'crash') {
    if (activeId(state) !== action.payload.bridgeInstanceId) return state;
    return {
      kind: 'failed',
      bridgeInstanceId: action.payload.bridgeInstanceId,
      message:
        state.kind === 'failed'
          ? state.message
          : action.payload.error ?? 'Minecraft closed unexpectedly',
      crashInfo: action.payload,
    };
  }

  if (action.type === 'progress') {
    if (activeId(state) !== action.payload.bridgeInstanceId) return state;
    return {
      kind: 'downloading',
      bridgeInstanceId: action.payload.bridgeInstanceId,
      taskName: action.payload.name || 'Minecraft files',
      percent: Math.min(
        100,
        Math.round((action.payload.progress / action.payload.total) * 100),
      ),
    };
  }

  const { payload } = action;
  const currentId = activeId(state);
  if (currentId !== payload.bridgeInstanceId) return state;

  switch (payload.stage) {
    case 'installing':
    case 'installing-modloader':
      return {
        kind: 'preparing',
        bridgeInstanceId: payload.bridgeInstanceId,
      };
    case 'launching':
      return { kind: 'starting', bridgeInstanceId: payload.bridgeInstanceId };
    case 'window-ready':
      return { kind: 'running', bridgeInstanceId: payload.bridgeInstanceId };
    case 'exit':
      return payload.code === undefined ||
        payload.code === null ||
        payload.code === 0
        ? { kind: 'exited', bridgeInstanceId: payload.bridgeInstanceId }
        : {
            kind: 'failed',
            bridgeInstanceId: payload.bridgeInstanceId,
            message: `Minecraft closed unexpectedly (exit code ${payload.code})`,
          };
    case 'error':
      return {
        kind: 'failed',
        bridgeInstanceId: payload.bridgeInstanceId,
        message: payload.error ?? 'Failed to launch Minecraft',
      };
    default: {
      const exhaustive: never = payload.stage;
      return exhaustive;
    }
  }
};

export const mergeSnapshots = (
  current: MinecraftLaunchLogSnapshot | null,
  incoming: MinecraftLaunchLogSnapshot,
): MinecraftLaunchLogSnapshot => {
  if (!current || current.bridgeInstanceId !== incoming.bridgeInstanceId) {
    return incoming;
  }

  const bySequence = new Map(
    [...current.entries, ...incoming.entries].map((entry) => [
      entry.sequence,
      entry,
    ]),
  );
  return {
    bridgeInstanceId: incoming.bridgeInstanceId,
    entries: [...bySequence.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .slice(-500),
    truncated: current.truncated || incoming.truncated,
  };
};
