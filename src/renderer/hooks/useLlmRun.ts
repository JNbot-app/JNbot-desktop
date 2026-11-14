import { useCallback, useEffect, useRef, useState } from 'react';
import { LLM_STREAM_EVENT, type LlmStreamMessage } from '../../common/llm';

export type LlmRunState = {
  running: boolean;
  /** Progress steps; the last one is current while running. */
  steps: string[];
  thinking: string;
  /** The current reply, streamed. */
  text: string;
  error?: string;
  stopped?: boolean;
  startedAt?: number;
  finishedAt?: number;
};

const IDLE: LlmRunState = { running: false, steps: [], thinking: '', text: '' };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type LlmRun = LlmRunState & {
  /**
   * Run a slow AI request (`LLM_*`) and stream its progress into the state.
   * Resolves to undefined when the user stopped it or it failed (see `error`).
   */
  run: <T>(event: string, input: object) => Promise<T | undefined>;
  stop: () => void;
  reset: () => void;
};

/** One AI request at a time, with live progress instead of a bare spinner. */
export default function useLlmRun(): LlmRun {
  const [state, setState] = useState<LlmRunState>(IDLE);
  const current = useRef<{ streamId: string; stopped: boolean } | null>(null);

  const stop = useCallback(() => {
    const active = current.current;
    if (!active) return;
    active.stopped = true;
    window.ipcRenderer.get('LLM_CANCEL', { streamId: active.streamId }).catch(() => undefined);
  }, []);

  // Stop a request whose UI went away.
  useEffect(() => stop, [stop]);

  const run = useCallback(async <T,>(event: string, input: object): Promise<T | undefined> => {
    const active = { streamId: crypto.randomUUID(), stopped: false };
    current.current = active;
    setState({ ...IDLE, running: true, startedAt: Date.now() });
    const update = (change: (previous: LlmRunState) => Partial<LlmRunState>) =>
      current.current === active && setState((previous) => ({ ...previous, ...change(previous) }));
    const unsubscribe = window.messenger.sub(LLM_STREAM_EVENT, window.messenger.address, (data) => {
      const message = data as LlmStreamMessage;
      if (message.streamId !== active.streamId) return;
      if (message.type === 'status') update(({ steps }) => ({ steps: [...steps, message.text] }));
      else if (message.type === 'thinking') update(({ thinking }) => ({ thinking: thinking + message.delta }));
      else if (message.type === 'text') update(({ text }) => ({ text: text + message.delta }));
      else update(({ thinking }) => ({ text: '', thinking: thinking && `${thinking}\n\n` }));
    });
    try {
      const result = (await window.ipcRenderer.get(event as never, { ...input, streamId: active.streamId } as never)) as T;
      update(() => ({ running: false, finishedAt: Date.now() }));
      return result;
    } catch (error) {
      update(() => ({ running: false, finishedAt: Date.now(), stopped: active.stopped, error: active.stopped ? undefined : errorText(error) }));
      return undefined;
    } finally {
      unsubscribe();
      if (current.current === active) current.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stop();
    current.current = null;
    setState(IDLE);
  }, [stop]);

  return { ...state, run, stop, reset };
}
