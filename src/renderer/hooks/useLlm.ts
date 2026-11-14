import { create } from 'zustand';
import type { LlmStatus } from '../../common/llm';

const useLlmStore = create<LlmStatus>(() => ({ configured: false }));

let subscribed = false;
function subscribe() {
  if (subscribed || !window.ipcRenderer) return;
  subscribed = true;
  window.ipcRenderer.on('LLM_STATUS', (status: LlmStatus) => useLlmStore.setState(status, true));
  window.ipcRenderer
    .get('LLM_STATUS')
    .then((status) => useLlmStore.setState(status, true))
    .catch(() => undefined);
}

/**
 * The optional AI provider's status. Every AI button checks `configured`, so
 * users without a key never see them.
 */
export default function useLlm(): LlmStatus {
  subscribe();
  return useLlmStore();
}
