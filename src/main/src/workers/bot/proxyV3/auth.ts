/**
 * Resolves how the proxy -> server bridge authenticates.
 *
 * The client -> proxy hop is offline (localhost, trusted), so the bridge is the
 * one that must log into the real server. For jnbot's own premium accounts we
 * reuse the prismarine-auth token cache the launcher/bots already populated
 * (`workerData.paths.minecraftAuth`), keyed by the in-game name — so no new
 * device-code prompt is needed. Mirrors the logic in workers/bot/join.js.
 */
import type { Alt } from '../../../types';
import { workerData } from 'worker_threads';

export interface BridgeAuthOptions {
  username: string;
  auth: 'microsoft' | 'offline';
  profilesFolder?: string;
  onMsaCode?: (data: any) => void;
}

/** Forward a Microsoft device-code prompt to the app's single login modal. */
function onMsaCode(username: string) {
  return (auth: any) => {
    if (!auth) return;
    global.sendToClients('MC_MICROSOFT_DEVICE_CODE', {
      message: auth.message,
      userCode: auth.user_code ?? auth.userCode,
      verificationUri: auth.verification_uri ?? auth.verificationUri,
      expiresIn: auth.expires_in ?? auth.expiresIn,
      username,
    });
  };
}

export function resolveBridgeAuth(username: string): BridgeAuthOptions {
  const sharedSettings = global.sharedSettings;
  const alt = sharedSettings?.alts?.find((a: Alt) => a.username === username);
  const altData = alt
    ? global.settings?.altData?.[alt.username]
    : undefined;

  if (altData?.premium) {
    return {
      username,
      auth: 'microsoft',
      profilesFolder: workerData?.paths?.minecraftAuth,
      onMsaCode: onMsaCode(username),
    };
  }

  return { username, auth: 'offline' };
}
