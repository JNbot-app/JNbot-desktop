import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { clipText } from '../components/Header';
import type { CliRuntime } from '../types';
import { joinBot } from '../actions';

interface JoinBotModalProps {
  runtime: CliRuntime;
  width: number;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export const JoinBotModal: React.FC<JoinBotModalProps> = ({
  runtime,
  width,
  onClose,
  onSuccess,
}) => {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const alts = runtime.handler.settings.getAltsWithDataForProfile(profileKey).map((a) => a.username);
  const versions = runtime.handler.settings.JNdata.versions?.length
    ? runtime.handler.settings.JNdata.versions
    : ['1.8.9'];

  const [username, setUsername] = useState('');
  const [version, setVersion] = useState(versions[0] || '1.8.9');
  const [field, setField] = useState<'username' | 'version'>('username');
  const [error, setError] = useState<string | null>(null);

  const filteredAlts = alts.filter((name) =>
    name.toLowerCase().includes(username.toLowerCase()),
  );

  const handleStart = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Username cannot be empty.');
      return;
    }
    const res = await joinBot(runtime, trimmed, version);
    if (res.ok) {
      onSuccess(`Started bot ${trimmed} (${version}).`);
      onClose();
    } else {
      setError(res.error || 'Failed to start bot.');
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.tab) {
      setField((f) => (f === 'username' ? 'version' : 'username'));
      return;
    }

    if (key.return) {
      void handleStart();
      return;
    }

    if (field === 'username') {
      if (key.downArrow && filteredAlts.length > 0) {
        const idx = filteredAlts.indexOf(username);
        setUsername(filteredAlts[(idx + 1 + filteredAlts.length) % filteredAlts.length]);
        return;
      }
      if (key.upArrow && filteredAlts.length > 0) {
        const idx = filteredAlts.indexOf(username);
        setUsername(filteredAlts[(idx - 1 + filteredAlts.length) % filteredAlts.length]);
        return;
      }
      if (key.backspace || key.delete) {
        setUsername((v) => v.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setUsername((v) => v + input);
      }
    } else if (field === 'version') {
      if (key.downArrow || key.rightArrow) {
        const idx = versions.indexOf(version);
        setVersion(versions[(idx + 1) % versions.length]);
      } else if (key.upArrow || key.leftArrow) {
        const idx = versions.indexOf(version);
        setVersion(versions[(idx - 1 + versions.length) % versions.length]);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Join Bot Session
        </Text>
        <Text dimColor>Tab switches field · Enter starts · Esc cancels</Text>
      </Box>

      {error ? (
        <Box marginBottom={1}>
          <Text color="red">! {error}</Text>
        </Box>
      ) : null}

      <Box justifyContent="space-between" marginBottom={0}>
        <Text color={field === 'username' ? 'cyan' : undefined} bold={field === 'username'}>
          {field === 'username' ? '› ' : '  '}Username:
        </Text>
        <Text color="white">
          {username}
          {field === 'username' ? <Text inverse> </Text> : null}
        </Text>
      </Box>

      <Box justifyContent="space-between" marginBottom={0}>
        <Text color={field === 'version' ? 'cyan' : undefined} bold={field === 'version'}>
          {field === 'version' ? '› ' : '  '}Minecraft Version:
        </Text>
        <Text color="yellow">← {version} →</Text>
      </Box>

      {filteredAlts.length > 0 && field === 'username' ? (
        <Box marginTop={1}>
          <Text dimColor>
            Alts (↑↓ auto-fill): {clipText(filteredAlts.join(', '), Math.max(20, width - 25))}
          </Text>
        </Box>
      ) : null}

      <Box justifyContent="space-around" marginTop={1}>
        <Text bold color="green">[ Start Bot (Enter) ]</Text>
        <Text color="gray">[ Cancel (Esc) ]</Text>
      </Box>
    </Box>
  );
};
