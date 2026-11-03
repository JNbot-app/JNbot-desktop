import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BrainInfo,
  BrainLearnSettings,
  BrainTrainStatus,
} from '../../../../common/brainSpec';
import { isRecordingSession } from '../../../../common/automation';
import useAppApi from '../../../hooks/useAppApi';
import { onAutomationSessionEnd } from '../../../redux/automationSessions';

/** The recording's takes and AI state; reloads when a take, practice run or training ends. */
export default function useBrainInfo(
  pluginId?: string,
  learn?: BrainLearnSettings,
) {
  const { message } = useAppApi();
  const [info, setInfo] = useState<BrainInfo | null>(null);
  const [training, setTraining] = useState<BrainTrainStatus | null>(null);
  // the editor clones the document on every change; only real setting edits matter
  const settings = JSON.stringify(learn ?? {});

  const load = useCallback(async () => {
    if (!pluginId) return;
    try {
      setInfo(
        await window.ipcRenderer.get<BrainInfo>('GET_BRAIN_INFO', {
          pluginId,
          learn: JSON.parse(settings),
        }),
      );
    } catch (error) {
      message.error(String(error));
    }
  }, [message, pluginId, settings]);

  // setting edits reload what training would use, once the user stops clicking
  const loaded = useRef(false);
  useEffect(() => {
    if (!pluginId) return;
    const timer = setTimeout(load, loaded.current ? 300 : 0);
    loaded.current = true;
    return () => clearTimeout(timer);
  }, [load, pluginId]);

  useEffect(
    () =>
      pluginId
        ? onAutomationSessionEnd(pluginId, (status) => {
            if (isRecordingSession(status) || status.practice) void load();
          })
        : undefined,
    [load, pluginId],
  );

  useEffect(
    () =>
      window.ipcRenderer.on(
        'BRAIN_TRAIN_STATUS',
        (status: BrainTrainStatus) => {
          if (status.pluginId !== pluginId) return;
          setTraining(status.state === 'training' ? status : null);
          if (status.state === 'failed') message.error(status.error);
          if (status.state === 'done') void load();
        },
      ),
    [load, message, pluginId],
  );

  return { info, training, reload: load };
}
