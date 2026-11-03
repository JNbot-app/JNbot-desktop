import type { Bot } from '../../workerTypes';
import workerScript from '../../lib/workerScript';
import { iterateAlts, iterateBots } from '../../scripts/iterateAlts';

export type CollectionContext = {
  bot: Bot | null;
  pluginOptions: Record<string, any>;
  usePluginFilters: boolean;
  showProgress: boolean;
  showControls: boolean;
};

export type CollectionItem = { value: any; bot?: Bot };

type CollectionProvider = (context: CollectionContext) => any[];

const requireBot = (bot: Bot | null) => {
  if (!bot) throw new Error('This collection needs a connected bot.');
  return bot;
};

const itemValues = (item: any, bot: Bot) => ({
  name: bot.itemInfo(item).name || item.displayName,
  count: item.count,
  slotId: item.slot,
});

export const recipeCollections: Record<string, CollectionProvider> = {
  players: ({ bot }) =>
    Object.values(requireBot(bot).players ?? {})
      .filter((player) => player.entity?.position)
      .map((player) => ({
        username: player.username,
        x: player.entity.position.x,
        y: player.entity.position.y,
        z: player.entity.position.z,
      })),

  entities: ({ bot }) =>
    Object.values(requireBot(bot).entities ?? {})
      .filter((entity) => entity.type !== 'player' && entity.position)
      .map((entity) => ({
        mobType: entity.displayName ?? entity.name ?? entity.mobType ?? '',
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
      })),

  inventory: ({ bot }) => {
    const activeBot = requireBot(bot);
    const window = activeBot.currentWindow ?? activeBot.inventory;
    return window.slots
      .slice(window.inventoryStart, window.inventoryEnd)
      .filter(Boolean)
      .map((item) => itemValues(item, activeBot));
  },

  windowItems: ({ bot }) => {
    const activeBot = requireBot(bot);
    const window = activeBot.currentWindow ?? activeBot.inventory;
    return window.slots
      .slice(0, window.inventoryStart)
      .filter(Boolean)
      .map((item) => itemValues(item, activeBot));
  },

  items: ({ bot }) => {
    const activeBot = requireBot(bot);
    const window = activeBot.currentWindow ?? activeBot.inventory;
    return window.slots
      .filter(Boolean)
      .map((item) => itemValues(item, activeBot));
  },
};

export function getRecipeCollectionItems(
  collectionId: string,
  context: CollectionContext,
): AsyncIterable<CollectionItem> {
  if (collectionId === 'alts' || collectionId === 'bots') {
    return accountItems(collectionId, context);
  }
  const provider = recipeCollections[collectionId];
  if (!provider) throw new Error(`Unknown collection: ${collectionId}`);
  return (async function* collection() {
    for (const value of provider(context)) yield { value };
  })();
}

async function* accountItems(
  collectionId: 'alts' | 'bots',
  context: CollectionContext,
): AsyncIterable<CollectionItem> {
  const alts = workerScript.getAlts({ fullAlts: true });
  const options = context.usePluginFilters ? context.pluginOptions : {};
  const iterationOptions = {
    filter: context.usePluginFilters,
    showProgress: context.showProgress,
    disableControls: !context.showControls,
  };

  if (collectionId === 'alts') {
    for await (const alt of iterateAlts(alts, options, iterationOptions)) {
      yield { value: alt };
    }
    return;
  }

  for await (const bot of iterateBots(alts, options, iterationOptions)) {
    yield { value: { bot, username: bot.username }, bot };
  }
}
