import type { Bot } from '../../workerTypes';
import { getRecipeEvent } from '../../../../../common/recipeCatalog';

export function getRuntimeEvent(eventId: string): string {
  const event = getRecipeEvent(eventId);
  if (!event) throw new Error(`Unknown event: ${eventId}`);
  return event.runtimeEvent;
}

export function readEventValues(
  eventId: string,
  args: any[],
  bot: Bot,
): Record<string, any> {
  const first = args[0];
  const position = bot.entity?.position;
  switch (eventId) {
    case 'chat':
      return { message: first };
    case 'move':
    case 'forcedMove':
      return { x: position?.x, y: position?.y, z: position?.z };
    case 'kicked':
      return {
        reason: typeof first === 'string' ? first : JSON.stringify(first ?? ''),
      };
    case 'health':
      return { health: bot.health };
    case 'playerJoin':
    case 'playerLeave':
      return {
        username: first?.username,
        x: first?.entity?.position?.x,
        y: first?.entity?.position?.y,
        z: first?.entity?.position?.z,
      };
    case 'windowOpen':
      return { windowType: first?.type, windowTitle: first?.title };
    case 'blockUpdate': {
      const block = args[1];
      return {
        blockType: block?.type,
        blockName: block?.name,
        x: block?.position?.x,
        y: block?.position?.y,
        z: block?.position?.z,
      };
    }
    case 'entitySpawn':
      return {
        entityType: first?.displayName ?? first?.name ?? first?.mobType ?? '',
        x: first?.position?.x,
        y: first?.position?.y,
        z: first?.position?.z,
      };
    default:
      return {};
  }
}
