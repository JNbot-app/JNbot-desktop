import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CliRuntime } from '../types';
import { getServerMeta } from '../../../common/serverInfo';
import { addAlt } from '../actions';
import { accountAuthenticationError } from '../../../common/serverAuthentication';

interface AltFormModalProps {
  runtime: CliRuntime;
  width: number;
  height: number;
  initialAlt?: {
    username: string;
    email?: string | null;
    data?: { premium?: boolean; password?: string };
  };
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export const AltFormModal: React.FC<AltFormModalProps> = ({
  runtime,
  initialAlt,
  onClose,
  onSuccess,
}) => {
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const serverMeta = getServerMeta(runtime.handler.settings.JNdata, profileKey);
  const onlineMode = Boolean(serverMeta.onlineMode);

  const [username, setUsername] = useState(initialAlt?.username ?? '');
  const [isPremium, setIsPremium] = useState(
    initialAlt?.data?.premium ?? onlineMode,
  );
  const [password, setPassword] = useState(initialAlt?.data?.password ?? '');
  const [error, setError] = useState<string | null>(null);

  const fields = onlineMode ? ['username'] : ['username', 'type', 'password'];
  fields.push('save', 'cancel');

  const [fieldIndex, setFieldIndex] = useState(0);
  const currentField = fields[fieldIndex] || 'username';

  const handleSubmit = () => {
    const trimmedUser = username.trim();
    if (!trimmedUser) {
      setError('Username cannot be empty.');
      return;
    }
    const authenticationError = accountAuthenticationError(
      { premium: onlineMode || isPremium, password }, onlineMode,
    );
    if (authenticationError) {
      setError(authenticationError);
      return;
    }

    if (initialAlt) {
      // Editing existing alt
      const alts = runtime.handler.settings.getAltsWithDataForProfile(profileKey);
      const existingIdx = alts.findIndex(
        (a) => a.username.toLowerCase() === initialAlt.username.toLowerCase(),
      );
      const updatedItem = {
        username: trimmedUser,
        email: initialAlt.email || undefined,
        data: {
          ...(existingIdx >= 0 ? alts[existingIdx].data : {}),
          premium: onlineMode || isPremium,
          password: password.trim() || undefined,
        },
      };
      if (existingIdx >= 0) {
        alts[existingIdx] = updatedItem;
      } else {
        alts.push(updatedItem);
      }
      runtime.handler.settings.setAltsForProfile(profileKey, alts);
      onSuccess(`Updated alt ${trimmedUser}.`);
      onClose();
      return;
    }

    const result = addAlt(runtime, trimmedUser, {
      premium: onlineMode || isPremium,
      password: password.trim() || undefined,
    });

    if (result.ok) {
      onSuccess(`Added ${trimmedUser}.`);
      onClose();
    } else {
      setError(result.error || 'Failed to add alt.');
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.tab || key.downArrow) {
      setFieldIndex((idx) => (idx + 1) % fields.length);
      setError(null);
      return;
    }
    if (key.upArrow) {
      setFieldIndex((idx) => (idx - 1 + fields.length) % fields.length);
      setError(null);
      return;
    }

    // Toggle account type
    if (currentField === 'type') {
      if (input === ' ' || key.return || key.leftArrow || key.rightArrow) {
        setIsPremium((val) => !val);
      }
      return;
    }

    // Submit / cancel button
    if (currentField === 'save') {
      if (key.return) handleSubmit();
      return;
    }
    if (currentField === 'cancel') {
      if (key.return) onClose();
      return;
    }

    // Enter on final input submits
    if (key.return) {
      handleSubmit();
      return;
    }

    // Text editing for username and password
    if (currentField === 'username') {
      if (key.backspace || key.delete) setUsername((v) => v.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setUsername((v) => v + input);
    } else if (currentField === 'password') {
      if (key.backspace || key.delete) setPassword((v) => v.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setPassword((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Add Alt · {serverMeta.name || profileKey}
        </Text>
        <Text dimColor>{onlineMode ? 'Online Server' : 'Cracked Server'}</Text>
      </Box>

      {error ? (
        <Box marginBottom={1}>
          <Text color="red">! {error}</Text>
        </Box>
      ) : null}

      {/* Username Field */}
      <Box justifyContent="space-between" marginBottom={0}>
        <Text color={currentField === 'username' ? 'cyan' : undefined} bold={currentField === 'username'}>
          {currentField === 'username' ? '› ' : '  '}Minecraft Username:
        </Text>
        <Text color="white">
          {username}
          {currentField === 'username' ? <Text inverse> </Text> : null}
        </Text>
      </Box>

      {/* Account Type Toggle (if cracked server) */}
      {!onlineMode ? (
        <Box justifyContent="space-between" marginBottom={0}>
          <Text color={currentField === 'type' ? 'cyan' : undefined} bold={currentField === 'type'}>
            {currentField === 'type' ? '› ' : '  '}Account Type:
          </Text>
          <Text color={isPremium ? 'cyan' : 'yellow'}>
            {isPremium ? '[● Premium]' : '[○ Cracked]'} (Space toggles)
          </Text>
        </Box>
      ) : null}

      {!onlineMode && (
        <Box justifyContent="space-between" marginBottom={0}>
          <Text color={currentField === 'password' ? 'cyan' : undefined} bold={currentField === 'password'}>
            {currentField === 'password' ? '› ' : '  '}Server Password (optional):
          </Text>
          <Text color="white">
            {'*'.repeat(password.length)}
            {currentField === 'password' ? <Text inverse> </Text> : null}
          </Text>
        </Box>
      )}

      {/* Buttons */}
      <Box justifyContent="space-around" marginTop={1}>
        <Text
          color={currentField === 'save' ? 'black' : 'green'}
          backgroundColor={currentField === 'save' ? 'green' : undefined}
          bold
        >
          [ Add Alt (Enter) ]
        </Text>
        <Text
          color={currentField === 'cancel' ? 'black' : 'gray'}
          backgroundColor={currentField === 'cancel' ? 'gray' : undefined}
        >
          [ Cancel (Esc) ]
        </Text>
      </Box>

      <Box marginTop={0}>
        <Text dimColor>Tab switches fields · Enter submits · Esc cancels</Text>
      </Box>
    </Box>
  );
};
