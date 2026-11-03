import React, { useEffect, useState } from 'react';
import MicrosoftLoginModal from '../mcLauncher/MicrosoftLoginModal';
import { useSettingsStore } from '../../redux/settings';

type MicrosoftDeviceCodePayload = {
  userCode?: string;
  verificationUri?: string;
  message?: string;
  expiresIn?: number;
  username?: string;
};

/**
 * App-wide listener for the unified `MC_MICROSOFT_DEVICE_CODE` event. Both the
 * Minecraft launcher (MinecraftAccountService) and bots (`join.js`) emit this
 * event when a Microsoft device-code sign-in is required, so mounting this once
 * at the app root gives a single login prompt regardless of which page is open.
 */
const MicrosoftLoginListener: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [userCode, setUserCode] = useState('');
  const [username, setUsername] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [expiresAt, setExpiresAt] = useState<number>();

  const joined = useSettingsStore(
    (state) =>
      open &&
      !!username &&
      state.activeBots.some(
        (bot) =>
          bot.status === 'connected' &&
          bot.username.toLowerCase() === username.toLowerCase(),
      ),
  );

  useEffect(() => {
    if (joined) setOpen(false);
  }, [joined]);

  useEffect(() => {
    const remove = window.ipcRenderer.on(
      'MC_MICROSOFT_DEVICE_CODE',
      (evt: unknown) => {
        const payload = evt as MicrosoftDeviceCodePayload;
        setUserCode(String(payload?.userCode ?? ''));
        setUsername(String(payload?.username ?? ''));
        setVerificationUri(String(payload?.verificationUri ?? ''));
        setExpiresAt(
          typeof payload?.expiresIn === 'number' &&
            Number.isFinite(payload.expiresIn)
            ? Date.now() + Math.max(0, payload.expiresIn) * 1000
            : undefined,
        );
        setOpen(true);
      },
    );
    return () => remove?.();
  }, []);

  return (
    <MicrosoftLoginModal
      open={open}
      userCode={userCode}
      verificationUri={verificationUri}
      expiresAt={expiresAt}
      onClose={() => setOpen(false)}
    />
  );
};

export default MicrosoftLoginListener;
