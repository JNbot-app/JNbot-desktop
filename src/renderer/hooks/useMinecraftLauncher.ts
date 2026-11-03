import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { MinecraftLauncherTypes } from '../../common/CommonEnums';
import type {
  Gamemode,
  LaunchMinecraftOptions,
  MinecraftLaunchLogSnapshot,
} from '../../main/src/types';
import {
  initialLauncherState,
  isMinecraftCrashInfo,
  isMinecraftInstallProgressPayload,
  isMinecraftLaunchLogBatch,
  isMinecraftLaunchLogSnapshot,
  isMinecraftLaunchStatusPayload,
  launcherStateReducer,
  mergeSnapshots,
  type LauncherState,
} from './launcherState';

interface UseMinecraftLauncherProps {
  selectedAccount: string;
  selectedVersion: { id: string; launcherFlags: number } | null;
  selectedGamemode: Gamemode | null;
  minecraftDirectory: string;
  message: {
    warning: (_content: string) => void;
    info: (_content: string) => void;
    error: (_content: string) => void;
  };
}

const currentBridgeInstanceId = (state: LauncherState): string | null =>
  state.kind === 'idle' ? null : state.bridgeInstanceId;

export const useMinecraftLauncher = ({
  selectedAccount,
  selectedVersion,
  selectedGamemode,
  minecraftDirectory,
  message,
}: UseMinecraftLauncherProps) => {
  const [launchState, dispatch] = useReducer(
    launcherStateReducer,
    initialLauncherState,
  );
  const launchStateRef = useRef(launchState);
  const [logsSnapshot, setLogsSnapshot] =
    useState<MinecraftLaunchLogSnapshot | null>(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const logsOpenRef = useRef(false);
  const [isCrashReportOpen, setIsCrashReportOpen] = useState(false);

  useEffect(() => {
    launchStateRef.current = launchState;
  }, [launchState]);

  useEffect(() => {
    const removeProgressListener = window.ipcRenderer.on(
      'MC_INSTALL_PROGRESS',
      (data: unknown) => {
        if (isMinecraftInstallProgressPayload(data)) {
          dispatch({ type: 'progress', payload: data });
        }
      },
    );

    const removeStatusListener = window.ipcRenderer.on(
      'MC_LAUNCH_STATUS',
      (data: unknown) => {
        if (isMinecraftLaunchStatusPayload(data)) {
          dispatch({ type: 'status', payload: data });
        }
      },
    );

    const removeLogListener = window.ipcRenderer.on(
      'MC_LAUNCH_LOGS',
      (data: unknown) => {
        if (!logsOpenRef.current || !isMinecraftLaunchLogBatch(data)) return;
        const activeId = currentBridgeInstanceId(launchStateRef.current);
        if (activeId && activeId !== data.bridgeInstanceId) return;

        setLogsSnapshot((current) =>
          data.reset ? data : mergeSnapshots(current, data),
        );
      },
    );

    const removeCrashListener = window.ipcRenderer.on(
      'MC_LAUNCH_CRASH_INFO',
      (data: unknown) => {
        if (isMinecraftCrashInfo(data)) {
          dispatch({ type: 'crash', payload: data });
        }
      },
    );

    return () => {
      removeProgressListener?.();
      removeStatusListener?.();
      removeLogListener?.();
      removeCrashListener?.();
    };
  }, []);

  const handlePlay = useCallback(async () => {
    if (!selectedAccount) {
      message.warning('Please select an account first');
      return;
    }
    if (!selectedVersion) return;

    const bridgeInstanceId = crypto.randomUUID();
    dispatch({ type: 'request', bridgeInstanceId });
    setLogsSnapshot(null);
    setIsCrashReportOpen(false);

    try {
      message.info(
        `Launching Minecraft ${selectedVersion.id} with ${selectedAccount}...`,
      );

      const options: LaunchMinecraftOptions = {
        username: selectedAccount,
        version: selectedVersion.id,
        bridgeInstanceId,
        launcherFlags:
          selectedVersion.launcherFlags ?? MinecraftLauncherTypes.VANILLA,
        gamemode: selectedGamemode,
        minecraftDirectory: minecraftDirectory || undefined,
        minMemoryMB: 512,
        maxMemoryMB: 2048,
        window: { fullscreen: false },
      };

      await window.ipcRenderer.get('LAUNCH_MINECRAFT', options);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to launch Minecraft';
      dispatch({ type: 'request-failed', message: errorMessage });
      message.error(errorMessage);
    }
  }, [
    selectedAccount,
    selectedVersion,
    selectedGamemode,
    minecraftDirectory,
    message,
  ]);

  const openLogs = useCallback(async () => {
    logsOpenRef.current = true;
    setIsLogsOpen(true);
    const bridgeInstanceId = currentBridgeInstanceId(launchStateRef.current);
    if (!bridgeInstanceId) return;
    try {
      const data: unknown = await window.ipcRenderer.get(
        'GET_MC_LAUNCH_LOGS',
        bridgeInstanceId,
      );
      if (!isMinecraftLaunchLogSnapshot(data)) return;

      const activeId = currentBridgeInstanceId(launchStateRef.current);
      if (activeId && activeId !== data.bridgeInstanceId) return;
      setLogsSnapshot((current) => mergeSnapshots(current, data));
    } catch {
      message.error('Failed to load launch logs');
    }
  }, [message]);

  const closeLogs = useCallback(() => {
    logsOpenRef.current = false;
    setIsLogsOpen(false);
    setLogsSnapshot(null);
  }, []);

  const clearLogs = useCallback(async () => {
    const bridgeInstanceId = logsSnapshot?.bridgeInstanceId;
    if (!bridgeInstanceId) return;
    try {
      const cleared = await window.ipcRenderer.get(
        'CLEAR_MC_LAUNCH_LOGS',
        bridgeInstanceId,
      );
      if (cleared) {
        setLogsSnapshot({
          bridgeInstanceId,
          entries: [],
          truncated: false,
        });
      }
    } catch {
      message.error('Failed to clear launch logs');
    }
  }, [logsSnapshot?.bridgeInstanceId, message]);

  const isLaunching =
    launchState.kind === 'preparing' ||
    launchState.kind === 'downloading' ||
    launchState.kind === 'starting';

  return {
    launchState,
    isLaunching,
    logsSnapshot,
    isLogsOpen,
    openLogs,
    closeLogs,
    clearLogs,
    isCrashReportOpen,
    openCrashReport: () => setIsCrashReportOpen(true),
    closeCrashReport: () => setIsCrashReportOpen(false),
    handlePlay,
  };
};
