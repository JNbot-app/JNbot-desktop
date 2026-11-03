import { useEffect } from 'react';
import { useSettingsStore } from '../../redux/settings';
import useNotificationButton from '../../hooks/useNotificationButton';

/** Mirrors new notifications to the OS while JNbot is not focused. */
function SystemNotifications(): null {
  const openButton = useNotificationButton();

  useEffect(
    () =>
      useSettingsStore.subscribe((state, prev) => {
        if (state.notifications.unread <= prev.notifications.unread) return;
        if (document.hasFocus() || !(state.appSettings.notification_on ?? true))
          return;
        if (
          typeof Notification === 'undefined' ||
          Notification.permission !== 'granted'
        )
          return;
        const item = state.notifications.notifications[0];
        const notification = new Notification(item.title, {
          body: item.message,
        });
        notification.onclick = () => {
          if (window.web) window.focus();
          else void window.ipcRenderer.invoke('desktop:show');
          const button = item.buttons?.[0];
          if (button) openButton(button);
        };
      }),
    [openButton],
  );

  return null;
}

export default SystemNotifications;
