import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assertAutomationDocument,
  isRecordingSession,
  type AutomationDocument,
} from '../../../../common/automation';
import type { MacroInfo } from '../../../../main/src/types';
import useAppApi from '../../../hooks/useAppApi';
import { onAutomationSessionEnd } from '../../../redux/automationSessions';
import { clone } from '../automationUtils';

/** The recording plugin's document: loaded, reloaded after each take and autosaved on edits. */
export default function useRecordingDocument(id?: string) {
  const { message } = useAppApi();
  const [plugin, setPlugin] = useState<MacroInfo | null>(null);
  const [document, setDocument] = useState<AutomationDocument | null>(null);
  const dirty = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const result = await window.ipcRenderer.get<{
        info: MacroInfo;
        code: unknown;
        status: 'success' | 'error';
        error?: string;
      }>('MACRO_CODE', id);
      if (result.status !== 'success' || result.info.language !== 'recording')
        throw new Error(result.error ?? 'Recording plugin not found');
      assertAutomationDocument(result.code);
      dirty.current = false;
      generation.current += 1;
      setPlugin(result.info);
      setDocument(result.code);
    } catch (error) {
      message.error(String(error));
    }
  }, [id, message]);

  useEffect(() => {
    void load();
  }, [load]);

  // a take can change the replay steps
  useEffect(
    () =>
      id
        ? onAutomationSessionEnd(id, (status) => {
            if (isRecordingSession(status)) void load();
          })
        : undefined,
    [id, load],
  );

  useEffect(() => {
    if (!document || !dirty.current) return;
    const snapshot = clone(document);
    const currentGeneration = generation.current;
    const timer = setTimeout(async () => {
      try {
        const saved = await window.ipcRenderer.get<AutomationDocument>(
          'SAVE_MACRO',
          { pluginId: id, code: snapshot },
        );
        if (generation.current === currentGeneration) {
          dirty.current = false;
          setDocument(saved);
        }
      } catch {
        message.error('Could not save recording');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [document, id, message]);

  const mutate = useCallback(
    (change: (draft: AutomationDocument) => void) =>
      setDocument((current) => {
        if (!current) return current;
        const next = clone(current);
        change(next);
        next.updatedAt = Date.now();
        next.durationMs = next.steps.at(-1)?.atMs ?? 0;
        dirty.current = true;
        generation.current += 1;
        return next;
      }),
    [],
  );

  return { plugin, setPlugin, document, mutate, reload: load };
}
