import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CliRuntime } from '../types';
import { createRemoteDevice } from '../actions';

interface DeviceFormModalProps {
  runtime: CliRuntime;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export const DeviceFormModal: React.FC<DeviceFormModalProps> = ({
  runtime,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Device name cannot be empty.');
      return;
    }
    const res = createRemoteDevice(runtime, trimmed);
    if (res.ok) {
      onSuccess(`Created access link "${trimmed}".`);
      onClose();
    } else {
      setError(res.error || 'Failed to create access link.');
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      handleCreate();
      return;
    }
    if (key.backspace || key.delete) {
      setName((v) => v.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setName((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Create Remote Access Link
        </Text>
        <Text dimColor>Enter creates · Esc cancels</Text>
      </Box>

      {error ? (
        <Box marginBottom={1}>
          <Text color="red">! {error}</Text>
        </Box>
      ) : null}

      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Device Name:{' '}
        </Text>
        <Text color="white">
          {name}
          <Text inverse> </Text>
        </Text>
      </Box>

      <Box justifyContent="space-around" marginTop={1}>
        <Text bold color="green">[ Create Link (Enter) ]</Text>
        <Text color="gray">[ Cancel (Esc) ]</Text>
      </Box>
    </Box>
  );
};
