import ProxyServer from '../../bot/proxyV3/ProxyServer';
import { DebugPlugin } from '../../bot/proxyV3/plugins/Recorder';
import type {
  ProxyInfo,
  ProxyOperationResult,
  ProxyStateProvider,
  ProxyStateSnapshot,
} from '../../../../../common/types/proxyApi';
import { getScriptSettings } from '../../bot/scriptFunctional';
import workerScript from '../../lib/workerScript';

const TAKEOVER_WINDOW_MS = 60_000;
const STATE_TRANSFER_TIMEOUT_MS = 120_000;

function startProxy() {
  const scriptOptions = getScriptSettings('jnbotproxy');
  const port = Number(scriptOptions.port) || 25565;

  const proxy = new ProxyServer({
    proxyPort: port,
    limits: { transferTimeoutMs: STATE_TRANSFER_TIMEOUT_MS },
    resolveBotStateProvider,
  });
  /** Clients admitted to take over a running session; they drive once attached. */
  const takeovers = new Set<string>();
  let armedSessionId: string | undefined;
  let takeoverTimer: ReturnType<typeof setTimeout> | undefined;

  /** Bots run in other workers: authenticate the bot, then capture through the app. */
  async function resolveBotStateProvider(
    botId: number,
    token: string,
  ): Promise<ProxyStateProvider | undefined> {
    const authenticated = await workerScript.sendAsync<boolean>(
      'PROXY:VALIDATE_BOT_PROXY',
      { botId, token },
      { timeoutMs: 5_000 },
    );
    if (!authenticated) return undefined;
    return {
      async capture(signal) {
        const snapshot = await workerScript.sendAsync<ProxyStateSnapshot>(
          'PROXY:REQUEST_BOT_STATE',
          { botId },
          { timeoutMs: STATE_TRANSFER_TIMEOUT_MS, signal },
        );
        if (!snapshot) throw new Error(`Failed to capture state for bot ${botId}`);
        return snapshot;
      },
    };
  }

  const sendInfo = () => {
    global.sendToClients('PROXY:INFO', proxy.getInfo() satisfies ProxyInfo);
  };

  const notify = (type: 'success' | 'warning' | 'error', content: string) =>
    global.sendToClients('NOTIFICATION_MESSAGE', { type, content });

  const report = (result: ProxyOperationResult) => {
    if (result.ok) return;
    console.error(`[proxy] ${result.message} (${result.code})`);
    notify('error', result.message);
  };

  const clearTakeover = () => {
    armedSessionId = undefined;
    clearTimeout(takeoverTimer);
    takeoverTimer = undefined;
  };

  // A client joining an armed session (or one logged in as its own account)
  // takes control of it; everyone else gets a session of their own.
  proxy.onAdmission((request) => {
    const armed = armedSessionId && proxy.getSession(armedSessionId);
    const own = [...proxy.sessions.values()].find(
      (s) => s.account.toLowerCase() === request.username.toLowerCase(),
    );
    const session = armed || own;
    if (!session) return;
    if (armed) clearTakeover();
    takeovers.add(request.username);
    return { type: 'join', sessionId: session.id };
  });

  proxy.on('participant', (action, participant, session) => {
    if (action !== 'attached' || !takeovers.delete(participant.username)) return;
    void session.switchTo(participant).then(report);
  });

  proxy.on('driver', ({ driver, session }) => {
    if (driver) notify('success', `${driver.username} is now playing as ${session.account}`);
  });

  proxy.on('reconnect', (session, state) => {
    if (!state) notify('success', `${session.account} reconnected to the server`);
    else if (state.attempt === 1)
      notify('warning', `${session.account} lost connection (${state.reason}). Reconnecting…`);
  });

  proxy.on('session', (action, session) => {
    if (action === 'ended' && armedSessionId === session.id) clearTakeover();
  });

  proxy.on('change', sendInfo);

  const debugPlugin = (sessionId: string) =>
    proxy.getSession(sessionId)?.pluginManager.getPlugin<DebugPlugin>('debug');

  workerScript.onMessage('PROXY:GET_INFO', sendInfo);

  workerScript.onMessage('PROXY:KICK', ({ participantId }: { participantId: string }) => {
    proxy.kick(participantId);
  });

  workerScript.onMessage(
    'PROXY:SWITCH',
    async ({ participantId }: { participantId: string }) => {
      const result = await proxy.switch(participantId);
      report(result);
      return result;
    },
  );

  workerScript.onMessage(
    'PROXY:ARM_SWITCH',
    ({ sessionId }: { sessionId: string }): ProxyOperationResult => {
      const session = proxy.getSession(sessionId);
      const reasons = session
        ? session.switchingCapability.reasons
        : ['The proxy session is no longer connected'];
      if (reasons.length) {
        const result = { ok: false, code: 'switching_unavailable', message: reasons.join('. '), sessionId } as const;
        report(result);
        return result;
      }

      clearTakeover();
      armedSessionId = sessionId;
      takeoverTimer = setTimeout(() => {
        if (armedSessionId !== sessionId) return;
        clearTakeover();
        notify('error', 'No client connected within 60 seconds');
      }, TAKEOVER_WINDOW_MS);
      notify('success', 'Takeover armed. Connect the client within 60 seconds.');
      return { ok: true };
    },
  );

  DebugPlugin.onCapturesChanged = () =>
    workerScript.send('PROXY_RECORDINGS_UPDATE');

  workerScript.onMessage('PROXY:START_DEBUG_RECORDING', ({ sessionId }: { sessionId: string }) => {
    debugPlugin(sessionId)?.startDebug();
    sendInfo();
  });

  workerScript.onMessage('PROXY:STOP_DEBUG_RECORDING', ({ sessionId }: { sessionId: string }) => {
    debugPlugin(sessionId)?.stopDebug();
    sendInfo();
  });

  sendInfo();
  void proxy.ready.then(() => workerScript.send('PROXY:LISTENING', { port }));
}

export default startProxy;
