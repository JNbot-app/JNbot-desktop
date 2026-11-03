import { useEffect, useState } from 'react';
import { Switch } from 'antd';
import useAppApi from '../../hooks/useAppApi';

export default function DesktopBackgroundSetting() {
  const { message } = useAppApi();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void window.ipcRenderer
      .invoke<boolean>('desktop:background:get')
      .then((value) => {
        if (mounted) setEnabled(value);
      })
      .catch(() => {
        if (mounted) message.error('Could not load the background setting.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [message]);

  const change = async (value: boolean) => {
    setLoading(true);
    try {
      setEnabled(
        await window.ipcRenderer.invoke<boolean>(
          'desktop:background:set',
          value,
        ),
      );
    } catch {
      message.error(
        'Could not change background mode. The current setting is unchanged.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Switch
      aria-label="Keep JNbot running when the window is closed"
      checked={enabled}
      loading={loading}
      disabled={loading}
      onChange={change}
    />
  );
}
