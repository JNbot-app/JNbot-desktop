import {
  AutomationPlayer,
  type AutomationTargetAdapter,
} from '../../../../../common/AutomationPlayer';
import type {
  AutomationDocument,
  AutomationReplayOptions,
  AutomationSessionStatus,
} from '../../../../../common/automation';
import type { Bot } from '../../workerTypes';
import MineflayerAutomationAdapter from './MineflayerAutomationAdapter';
import BrainPlayer from './BrainPlayer';

const active = new Map<string, AutomationPlayer | BrainPlayer>();
const byBot = new Map<number, string>();

export function startBotAutomation(
  bot: Bot,
  options: {
    document: AutomationDocument;
    options: AutomationReplayOptions;
    adapter?: AutomationTargetAdapter;
  },
): AutomationSessionStatus & { done: Promise<AutomationSessionStatus> } {
  if (byBot.has(bot.botId))
    throw new Error('This bot is already replaying an automation');
  const player =
    options.options.mode === 'ai'
      ? new BrainPlayer(bot, options.document)
      : new AutomationPlayer(
          options.document,
          options.adapter ?? new MineflayerAutomationAdapter(bot),
          options.options,
        );
  active.set(player.sessionId, player);
  byBot.set(bot.botId, player.sessionId);
  player.onStatus((status) => {
    global.send('AUTOMATION_STATUS', status);
    if (status.state === 'completed' || status.state === 'stopped' || status.state === 'failed') {
      active.delete(status.sessionId);
      byBot.delete(bot.botId);
    }
  });
  return Object.assign(player.snapshot, { done: player.done });
}

export async function controlBotAutomation(
  bot: Bot,
  options: {
    sessionId: string;
    action: 'pause' | 'resume' | 'stop';
  },
): Promise<AutomationSessionStatus> {
  const player = active.get(options.sessionId);
  if (!player || byBot.get(bot.botId) !== options.sessionId)
    throw new Error('Automation session not found');
  if (options.action === 'pause') await player.pause();
  if (options.action === 'resume') await player.resume();
  if (options.action === 'stop') await player.stop();
  return player.snapshot;
}

export async function stopBotAutomation(bot: Bot): Promise<void> {
  const sessionId = byBot.get(bot.botId);
  const player = sessionId ? active.get(sessionId) : undefined;
  if (player) await player.stop();
}
