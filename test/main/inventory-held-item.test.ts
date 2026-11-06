import { EventEmitter } from 'events';

jest.mock('axios', () => ({ get: jest.fn(async () => ({ status: 404 })) }));
jest.mock('../../src/main/src/workers/bot/pathFinderPlugin', () => jest.fn());
jest.mock('../../src/main/src/workers/compiler/scriptActions', () => jest.fn());
jest.mock('../../src/main/src/workers/bot/extensions/nbtParser', () => ({
  getItemText: (item: { displayName: string }) => ({ name: item.displayName, lore: '' }),
  toAnsi: (text: string) => text,
}));
jest.mock('../../src/main/src/workers/bot/extensions/runBotCode', () => jest.fn());
jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: { onMessage: () => () => {}, onceMessage: () => () => {} },
}));
jest.mock('../../src/main/src/workers/bot/automation', () => ({
  startBotAutomation: jest.fn(),
  controlBotAutomation: jest.fn(),
  stopBotAutomation: jest.fn(),
}));
jest.mock('../../src/main/src/workers/bot/plugin/RecipeActions', () => ({
  getRecipeActionHandler: jest.fn(),
}));

const inject = require('../../src/main/src/workers/bot/botActions');
const scriptActionRunner = require('../../src/main/src/workers/compiler/scriptActions');

function createBot(triggers: unknown[] = []) {
  global.settings = { triggers } as any;
  const bot = new EventEmitter() as any;
  bot.username = 'Tester';
  bot._client = new EventEmitter();
  bot.inventory = Object.assign(new EventEmitter(), {
    type: 'minecraft:inventory',
    inventoryStart: 9,
    slots: Array(46).fill(null),
    selectedItem: null,
  });
  bot.currentWindow = null;
  bot.quickBarSlot = 0;
  bot.getWindowTitle = () => 'Inventory';
  bot.openInventory = jest.fn();
  bot.closeInventory = jest.fn();
  bot.messenger = {
    hasSubscribers: (channel: string) => channel === 'inventory',
    publish: jest.fn(),
    onSubscription: () => () => {},
    onAdditionalSubscription: () => () => {},
    onUnsubscription: () => () => {},
  };
  inject(bot);
  return bot;
}

const item = { name: 'stone', displayName: 'Stone', count: 1 };

describe('inventory held item', () => {
  it('keeps the inventory open while a crafting slot contains an item', async () => {
    const bot = createBot();
    bot.inventory.selectedItem = item;
    bot.clickWindow = jest.fn(async () => {
      bot.inventory.slots[1] = item;
      bot.inventory.selectedItem = null;
    });

    await bot.actions.inventoryClick({ slot: 1 });

    expect(bot.closeInventory).not.toHaveBeenCalled();
    expect(bot.messenger.publish).toHaveBeenCalledWith(
      'inventory',
      expect.objectContaining({ selectedItem: null }),
    );

    bot.actions.closeWindow();
    expect(bot.closeInventory).toHaveBeenCalledTimes(1);
  });

  it('clears the held item when the game changes', () => {
    const bot = createBot();
    bot.inventory.selectedItem = item;
    bot.currentWindow = { ...bot.inventory, selectedItem: item };

    bot.emit('gamemodeChanged', 'creative');

    expect(bot.inventory.selectedItem).toBeNull();
    expect(bot.currentWindow.selectedItem).toBeNull();
    expect(bot.messenger.publish).toHaveBeenCalledWith(
      'inventory',
      expect.objectContaining({ selectedItem: null }),
    );
  });

  it('clears the held item when a window closes', () => {
    const bot = createBot();
    const window = { selectedItem: item };
    bot.inventory.selectedItem = item;

    bot.emit('windowClose', window);

    expect(window.selectedItem).toBeNull();
    expect(bot.inventory.selectedItem).toBeNull();
    expect(bot.messenger.publish).toHaveBeenCalledWith(
      'inventory',
      expect.objectContaining({ selectedItem: null }),
    );
  });
});

describe('trigger actions', () => {
  it('passes the bot and event data in their respective action arguments', () => {
    scriptActionRunner.mockResolvedValue(undefined);
    const bot = createBot([
      {
        id: 'chat-trigger',
        event: 'chat',
        enabled: true,
        actions: [{ type: 'scriptAction', id: 'chat-action' }],
      },
    ]);

    bot.emit('messagestr', 'Hello');

    expect(scriptActionRunner).toHaveBeenCalledWith({
      id: 'chat-action',
      bot,
      args: { message: 'Hello', bot: 'Tester', event: 'on_public_message' },
    });
  });

  it('runs the action on the preset the trigger picked', () => {
    scriptActionRunner.mockResolvedValue(undefined);
    const bot = createBot([
      {
        id: 'chat-trigger',
        event: 'chat',
        enabled: true,
        actions: [{ type: 'scriptAction', id: 'chat-action', preset: 'second' }],
      },
    ]);

    bot.emit('messagestr', 'Hello');

    expect(scriptActionRunner).toHaveBeenCalledWith(
      expect.objectContaining({ optionOverrides: { $preset: 'second' } }),
    );
  });
});
