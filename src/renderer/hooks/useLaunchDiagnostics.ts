import { useCallback, useEffect, useRef, useState } from 'react';
import type { MinecraftLaunchLogSnapshot } from '../../main/src/types';
import {
  isMinecraftLaunchLogBatch,
  isMinecraftLaunchLogSnapshot,
  mergeSnapshots,
} from './launcherState';

export const useLaunchDiagnostics = () => {
  const [logsSnapshot, setLogsSnapshot] =
    useState<MinecraftLaunchLogSnapshot | null>(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const logsOpenRef = useRef(false);
  const activeBridgeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const removeLogListener = window.ipcRenderer.on(
      'MC_LAUNCH_LOGS',
      (data: unknown) => {
        if (!logsOpenRef.current || !isMinecraftLaunchLogBatch(data)) return;
        if (
          activeBridgeIdRef.current &&
          activeBridgeIdRef.current !== data.bridgeInstanceId
        ) {
          return;
        }

        setLogsSnapshot((current) =>
          data.reset ? data : mergeSnapshots(current, data),
        );
      },
    );

    return () => {
      removeLogListener?.();
    };
  }, []);

  const openDiagnostics = useCallback(
    async (bridgeInstanceId?: string | number) => {
      const normalizedBridgeId =
        bridgeInstanceId !== undefined && bridgeInstanceId !== null
          ? String(bridgeInstanceId)
          : undefined;
      logsOpenRef.current = true;
      activeBridgeIdRef.current = normalizedBridgeId || null;
      setIsLogsOpen(true);
      try {
        const data: unknown = await window.ipcRenderer.get(
          'GET_MC_LAUNCH_LOGS',
          normalizedBridgeId || '',
        );
        if (isMinecraftLaunchLogSnapshot(data)) {
          setLogsSnapshot(data);
        }
      } catch {
        // Ignored; modal gracefully handles missing snapshot
      }
    },
    [],
  );

  const closeDiagnostics = useCallback(() => {
    logsOpenRef.current = false;
    activeBridgeIdRef.current = null;
    setIsLogsOpen(false);
    setLogsSnapshot(null);
  }, []);

  const clearDiagnostics = useCallback(async () => {
    const bridgeInstanceId =
      logsSnapshot?.bridgeInstanceId || activeBridgeIdRef.current;
    if (bridgeInstanceId) {
      await window.ipcRenderer.get('CLEAR_MC_LAUNCH_LOGS', bridgeInstanceId);
    }
    setLogsSnapshot(null);
  }, [logsSnapshot?.bridgeInstanceId]);

  return {
    logsSnapshot,
    isLogsOpen,
    openDiagnostics,
    closeDiagnostics,
    clearDiagnostics,
  };
};

export default useLaunchDiagnostics;
