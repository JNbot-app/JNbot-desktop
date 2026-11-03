import { useSettingsStore } from '../../redux/settings';

async function botActionHandler(
  type: string,
  data?: any,
  shouldReturnValue = false,
) {
  const selectedBot = useSettingsStore.getState().selectedBot;
  const botId = selectedBot?.botId;
  const address = selectedBot?.MESSAGE_ADDRESS;
  if (!botId || !address) return;
  const payload = { action: type, data: [data] };
  if (shouldReturnValue)
    return window.messenger.request('BOT_ACTION', address as any, payload);
  window.messenger.send('BOT_ACTION', address as any, payload);
}

export default botActionHandler;
