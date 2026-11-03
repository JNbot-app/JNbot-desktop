import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationButton } from '../../common/mobileClientContract';
import { setSelectedBot, useSettingsStore } from '../redux/settings';

/** Opens the page a notification button points at. */
const useNotificationButton = () => {
  const navigate = useNavigate();
  return useCallback(
    (button: NotificationButton) => {
      if (button.action === 'openSettings') {
        navigate(`/settings?tab=${button.tab ?? 'general'}`);
        return;
      }
      const bot = useSettingsStore
        .getState()
        .activeBots.find((item) => item.botId === button.botId);
      if (bot) setSelectedBot(bot);
      navigate('/bot');
    },
    [navigate],
  );
};

export default useNotificationButton;
