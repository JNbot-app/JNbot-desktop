import type { KickBehaviorConfig } from '../../../types';
import {
  defaultKickBehaviorConfig,
  KickBehaviorOptions,
} from '../../../../../common/CommonEnums';
import workerScript from '../../lib/workerScript';

export type KickAction = 'retry' | 'pause' | 'skip';
export type KickDecision = Exclude<KickAction, 'pause'>;

const ACTIONS: Record<KickBehaviorOptions, KickAction> = {
  [KickBehaviorOptions.RETRY]: 'retry',
  [KickBehaviorOptions.PAUSE]: 'pause',
  [KickBehaviorOptions.SKIP]: 'skip',
};

export function getKickAction(reason: string): KickAction {
  const config: KickBehaviorConfig =
    global.appSettings.kickBehaviour ?? defaultKickBehaviorConfig;
  const normalized = reason.toLowerCase();
  const rule = config.rules.find((candidate) =>
    normalized.includes(candidate.kickMessage.toLowerCase()),
  );
  return ACTIONS[rule?.action ?? config.defaultAction] ?? 'retry';
}

export async function resolveKickAction(
  bot: { username: string; botId: number },
  reason: string,
  action: KickAction,
): Promise<KickDecision> {
  if (action === 'retry') {
    global.log(
      `[${bot.username}] will retry joining due to kick reason: ${reason}`,
      'info',
    );
    return 'retry';
  }

  if (action === 'skip') {
    global.log(
      `[${bot.username}] skipped bot due to kick reason: ${reason}`,
      'info',
    );
    return 'skip';
  }

  global.log(
    `[${bot.username}] paused bot due to kick reason: ${reason}`,
    'info',
  );
  const choice = await workerScript.showSnackbarWithButtons({
    body: `Your bot "${bot.username}" has been kicked for reason: "${reason}".`,
    title: 'Bot Paused',
    buttons: [
      { label: 'Rejoin bot', id: 'rejoin' },
      { label: 'Skip bot', id: 'skip' },
    ],
  });
  return choice === 'rejoin' ? 'retry' : 'skip';
}
