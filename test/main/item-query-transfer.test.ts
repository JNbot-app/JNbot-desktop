import vm from 'vm';

jest.mock('../../src/main/src/workers/bot/extensions/itemInfo', () => ({
  name: (item: any) => item.customName ?? '',
  lore: (item: any) => item.lore ?? '',
}));
jest.mock('../../src/main/src/workers/bot/openWindow', () => jest.fn());
jest.mock('../../src/main/src/workers/bot/extensions/nbtParser', () => ({}));
jest.mock('../../src/main/src/workers/lib/MissingDataHandler', () => ({
  getOrAskTransferToUsername: async () => 'Asked',
}));
jest.mock('../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3', () => ({}));
jest.mock('../../src/main/src/workers/lib/workerScript', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/main/src/workers/bot/gamemode', () => ({ installGamemodeApi: () => {} }));
jest.mock('../../src/main/src/workers/bot/statemachines/BotMachine', () => {
  // Runs every task once, in order, then finishes.
  class FakeMachine {
    finished: (() => void) | null = null;
    constructor(private tasks: any[], private options: any) {}
    onFinish(callback: () => void) {
      this.finished = callback;
      return this;
    }
    start() {
      setImmediate(async () => {
        for (const task of this.tasks) await task.run({ ...this.options, machine: this });
        this.finished?.();
      });
      return this;
    }
    finish() {}
  }
  return { __esModule: true, default: FakeMachine };
});

const { ItemQuery } = require('../../src/main/src/workers/bot/usserPlugin');
const injectTransfer = require('../../src/main/src/workers/bot/itemTransferV2');
const { textMatches } = require('../../src/main/src/workers/bot/statemachines/transferItems/transferUtil');
const { cloneConfig, mergeConfig } = require('../../src/main/src/workers/bot/statemachines/transferItems/transferConfig');

/** A value created the way plugin code creates it: in its own VM context. */
const fromPlugin = (code: string) => vm.runInNewContext(`(${code})`);

function createBot(items: Record<number, object>) {
  const slots: any[] = [];
  for (const [slot, item] of Object.entries(items)) slots[+slot] = { slot: +slot, count: 1, ...item };
  const bot: any = { currentWindow: null, inventory: { inventoryStart: 9, inventoryEnd: 45, slots } };
  bot.items = (query: unknown) => new ItemQuery(bot, query);
  return bot;
}

const key = { name: 'tripwire_hook', displayName: 'Tripwire Hook', customName: '§6Vote Key', lore: '§7Keys Owned: §f5' };
const apple = { name: 'golden_apple', displayName: 'Golden Apple' };
const clock = { name: 'clock', displayName: 'Clock' };

describe('bot.items', () => {
  const bot = createBot({ 9: key, 10: apple, 11: clock });

  it('matches lore with a string and with a RegExp', () => {
    expect(bot.items({ lore: 'keys owned' }).has()).toBe(true);
    expect(bot.items({ lore: /keys owned/i }).has()).toBe(true);
    expect(bot.items({ lore: /keys missing/i }).has()).toBe(false);
  });

  it('matches RegExps created in a plugin VM context', () => {
    expect(bot.items({ lore: fromPlugin('/keys owned/i') }).has()).toBe(true);
    expect(bot.items(fromPlugin('/vote key/i')).first()?.name).toBe('tripwire_hook');
    expect(bot.items(fromPlugin('{ lore: /keys owned/i }')).has()).toBe(true);
  });

  it('gives the same answer every time for a global RegExp', () => {
    const query = bot.items({ lore: /keys owned/gi });
    expect([query.has(), query.has(), query.has()]).toEqual([true, true, true]);
  });

  it('falls back to the vanilla name for items that are not renamed', () => {
    expect(bot.items('golden apple').first()?.name).toBe('golden_apple');
    expect(bot.items('tripwire').has()).toBe(false); // renamed: only its custom name counts
  });
});

describe('bot.transfer', () => {
  const run = async (exclude: unknown) => {
    const bot = createBot({ 9: key, 10: apple, 11: clock });
    injectTransfer(bot);
    bot.transfer.addMode('drop', {
      tasks: [
        {
          name: 'drop',
          run: ({ state }: any) => {
            for (const item of state.items.all()) bot.inventory.slots[item.slot] = null;
          },
        },
      ],
    });
    return bot.transfer('drop', { exclude });
  };

  it('excludes a mixed list of filters, including plugin RegExps', async () => {
    const result = await run(fromPlugin("[{ type: 'clock' }, /vote/i]"));
    expect(result).toEqual({
      completed: true,
      count: 1,
      items: [{ name: 'golden_apple', displayName: 'Golden Apple', count: 1 }],
    });
  });

  it('treats a list of strings as names', async () => {
    const result = await run(['apple', 'clock']);
    expect(result.items.map((i: any) => i.name)).toEqual(['tripwire_hook']);
  });
});

describe('transfer config', () => {
  it('matches text against plugin RegExps', () => {
    expect(textMatches('§aSelect Items To Send', fromPlugin('/select items/i'))).toBe(true);
    expect(textMatches('Trash', fromPlugin('/select items/i'))).toBe(false);
  });

  it('keeps RegExp overrides from a plugin and merges plugin objects', () => {
    const config = cloneConfig();
    mergeConfig(config, fromPlugin("{ gift: { keysOwnedLore: /sleutels:\\s*(\\d+)/i } }"));
    expect(config.gift.keysOwnedLore.exec('sleutels: 7')?.[1]).toBe('7');
    expect(config.gift.command).toBe('/gift {username}');
  });

  it('reads the owned key count with the default pattern', () => {
    const { keysOwnedLore } = cloneConfig().gift;
    expect(keysOwnedLore.exec('keys owned: 5')?.[1]).toBe('5');
    expect(keysOwnedLore.exec('keys own: 3')?.[1]).toBe('3');
  });
});
