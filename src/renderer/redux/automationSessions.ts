import { create } from 'zustand';
import {
  isActiveSession,
  type AutomationSessionStatus,
} from '../../common/automation';

type SessionAction = 'pause' | 'resume' | 'stop';

export const useAutomationSessions = create<{
  sessions: Record<string, AutomationSessionStatus>;
}>(() => ({ sessions: {} }));

const upsert = (status: AutomationSessionStatus) =>
  useAutomationSessions.setState((state) => ({
    sessions: { ...state.sessions, [status.sessionId]: status },
  }));

let initialized = false;
/** Loads the current sessions and keeps them in sync; safe to call repeatedly. */
export function initAutomationSessions(): void {
  if (initialized) return;
  initialized = true;
  void window.ipcRenderer
    .get<AutomationSessionStatus[]>('GET_AUTOMATION_SESSIONS')
    .then((values) => values.forEach(upsert))
    .catch(() => {});
  window.ipcRenderer.on('AUTOMATION_SESSION_UPDATE', upsert);
}

/** The running/paused session of an automation, if any. */
export const useActiveAutomationSession = (automationId?: string) =>
  useAutomationSessions((state) =>
    Object.values(state.sessions).find(
      (session) =>
        session.automationId === automationId && isActiveSession(session),
    ),
  );

/** Calls back whenever one of the automation's sessions ends; returns the unsubscribe. */
export const onAutomationSessionEnd = (
  automationId: string,
  callback: (status: AutomationSessionStatus) => void,
) =>
  useAutomationSessions.subscribe(({ sessions }, previous) => {
    for (const status of Object.values(sessions)) {
      const before = previous.sessions[status.sessionId];
      if (
        status.automationId === automationId &&
        !isActiveSession(status) &&
        before &&
        isActiveSession(before)
      )
        callback(status);
    }
  });

export async function controlAutomationSession(
  session: AutomationSessionStatus,
  action: SessionAction,
): Promise<void> {
  try {
    await window.ipcRenderer.get('AUTOMATION_SESSION_CONTROL', {
      sessionId: session.sessionId,
      action,
      target: session.target,
    });
  } catch {
    // Session already ended
  }
}
