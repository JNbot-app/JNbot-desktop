import type { AppApiContextT } from '../../providers/AppApiProvider';
import promptPublisherName from './promptPublisherName';

type ShareResult<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }
  | { status: 'publisher-name-required'; identity?: { fingerprint?: string } };

/**
 * Runs a SHARE_* action. Asks for a publisher name first when signing needs
 * one, and shows errors; resolves null when it failed or was cancelled.
 */
export default async function shareRequest<T>(
  api: Pick<AppApiContextT, 'modal' | 'message'>,
  action: string,
  input?: unknown,
): Promise<T | null> {
  let result = await window.ipcRenderer.get<ShareResult<T>>(action, input);
  if (result?.status === 'publisher-name-required') {
    if (!(await promptPublisherName(api, result.identity?.fingerprint, 'Save and share'))) return null;
    result = await window.ipcRenderer.get<ShareResult<T>>(action, input);
  }
  if (result?.status === 'success') return result.data;
  api.message.error(result?.status === 'error' ? result.message : 'Share link request failed');
  return null;
}
