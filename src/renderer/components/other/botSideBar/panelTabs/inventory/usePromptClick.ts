import { useChatClickHandler } from '../../../../bot/ChatMessage';
import type { ChatClick } from '../../../../bot/types';
import botEvents from '../../../../../utils/botEvents';

/** Click events in books/dialogs: commands go to this bot, the rest behave like chat clicks. */
export default function usePromptClick(botId: number) {
  const handleClick = useChatClickHandler(() => {}); // No chat bar to suggest into
  return (click: ChatClick) => {
    if (click.action === 'run_command')
      botEvents.action(botId, 'chatMessage', click.value);
    else handleClick(click);
  };
}
