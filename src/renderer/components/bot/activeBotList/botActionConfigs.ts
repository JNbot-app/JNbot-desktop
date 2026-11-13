import type { ActiveBot } from './types';

export const SCRIPT_ACTION_BUTTONS: Record<string, Record<string, boolean>> = {
  'kit collector': {
    next: true,
    prev: true,
    relog: true,
    pause: true,
  },
  'gkit upgrader': {
    next: true,
    prev: true,
    relog: true,
    pause: true,
  },
  'gkit collector': {
    next: true,
    prev: true,
    relog: true,
    pause: true,
  },
  chain: {
    next: true,
    prev: true,
    relog: true,
  },
  'gkit opener': {
    relog: true,
  },
  afk: {
    relog: true,
  },
  altScanner: {
    relog: true,
    pause: true,
  },
};

/** Skip the join delay for a queued bot (it has no bot messenger yet). */
export const joinBotNow = (bot: ActiveBot): void => {
  if (bot.RUNTIME_PROFILE_ID === undefined) return;
  window.messenger.profileAction(bot.RUNTIME_PROFILE_ID, 'JOIN_BOT_NOW', {
    botId: bot.botId,
  });
};

export const stopBot = (bot: ActiveBot): void => {
  if (!bot.MESSAGE_ADDRESS) return;
  window.messenger.send('STOP_BOT', bot.MESSAGE_ADDRESS as any, {
    botId: bot.botId,
  });
};

export const nextBot = (bot: ActiveBot): void => {
  if (!bot.MESSAGE_ADDRESS) return;
  window.messenger.send('NEXT_BOT', bot.MESSAGE_ADDRESS as any, {
    botId: bot.botId,
  });
};

export const relogBot = (bot: ActiveBot): void => {
  if (!bot.MESSAGE_ADDRESS) return;
  window.messenger.send('RELOG_BOT', bot.MESSAGE_ADDRESS as any, {
    botId: bot.botId,
  });
};

export const prevBot = (bot: ActiveBot): void => {
  if (!bot.MESSAGE_ADDRESS) return;
  window.messenger.send('PREV_BOT', bot.MESSAGE_ADDRESS as any, {
    botId: bot.botId,
  });
};

export const resumeBot = (bot: ActiveBot): void => {
  if (!bot.MESSAGE_ADDRESS) return;
  window.messenger.send('RESUME_BOT', bot.MESSAGE_ADDRESS as any, {
    botId: bot.botId,
  });
};

export const pauseBot = (bot: ActiveBot): void => {
  if (!bot.MESSAGE_ADDRESS) return;
  window.messenger.send('PAUSE_BOT', bot.MESSAGE_ADDRESS as any, {
    botId: bot.botId,
  });
};
