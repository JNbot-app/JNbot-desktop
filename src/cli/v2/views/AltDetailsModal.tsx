import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { clipText } from '../components/Header';

interface AltDetailsModalProps {
  alt: {
    username: string;
    email?: string | null;
    data?: {
      premium?: boolean;
      password?: string;
      ranks?: Record<string, string>;
      gkits?: Record<string, any>;
    };
  };
  serverName: string;
  width: number;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export const AltDetailsModal: React.FC<AltDetailsModalProps> = ({
  alt,
  serverName,
  width,
  onEdit,
  onRemove,
  onClose,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [selectedButton, setSelectedButton] = useState<'edit' | 'remove' | 'close'>('edit');

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === 'e') {
      onEdit();
      return;
    }
    if (input === 'd') {
      onRemove();
      return;
    }
    if (input === 'p') {
      setShowPassword((v) => !v);
      return;
    }

    if (key.leftArrow) {
      if (selectedButton === 'close') setSelectedButton('remove');
      else if (selectedButton === 'remove') setSelectedButton('edit');
    } else if (key.rightArrow || key.tab) {
      if (selectedButton === 'edit') setSelectedButton('remove');
      else if (selectedButton === 'remove') setSelectedButton('close');
      else setSelectedButton('edit');
    }

    if (key.return) {
      if (selectedButton === 'edit') onEdit();
      else if (selectedButton === 'remove') onRemove();
      else onClose();
    }
  });

  const passwordVal = alt.data?.password;
  const ranks = alt.data?.ranks ? Object.entries(alt.data.ranks) : [];
  const gkits = alt.data?.gkits ? Object.keys(alt.data.gkits) : [];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Alt Details · {alt.username}
        </Text>
        <Text color={alt.data?.premium ? 'green' : 'yellow'}>
          {alt.data?.premium ? 'Microsoft Premium' : 'Cracked Account'}
        </Text>
      </Box>

      <Box flexDirection="column" marginY={0}>
        <Box justifyContent="space-between">
          <Text dimColor>Username:</Text>
          <Text color="white" bold>{alt.username}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor>Server:</Text>
          <Text color="white">{serverName}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor>Server Password:</Text>
          <Text color="white">
            {passwordVal ? (showPassword ? passwordVal : '********') : '(none)'}{' '}
            {passwordVal ? <Text dimColor>([p] toggle)</Text> : null}
          </Text>
        </Box>
        {ranks.length > 0 ? (
          <Box justifyContent="space-between">
            <Text dimColor>Ranks:</Text>
            <Text color="cyan">{ranks.map(([gm, rk]) => `${gm}: ${rk}`).join(', ')}</Text>
          </Box>
        ) : null}
        {gkits.length > 0 ? (
          <Box justifyContent="space-between">
            <Text dimColor>GKits:</Text>
            <Text color="cyan">{gkits.join(', ')}</Text>
          </Box>
        ) : null}
      </Box>

      {/* Action Buttons */}
      <Box justifyContent="space-around" marginTop={1}>
        <Text
          color={selectedButton === 'edit' ? 'black' : 'cyan'}
          backgroundColor={selectedButton === 'edit' ? 'cyan' : undefined}
          bold
        >
          [ Edit Alt (e) ]
        </Text>
        <Text
          color={selectedButton === 'remove' ? 'black' : 'red'}
          backgroundColor={selectedButton === 'remove' ? 'red' : undefined}
          bold
        >
          [ Remove Alt (d) ]
        </Text>
        <Text
          color={selectedButton === 'close' ? 'black' : 'gray'}
          backgroundColor={selectedButton === 'close' ? 'gray' : undefined}
        >
          [ Close (Esc) ]
        </Text>
      </Box>

      <Box marginTop={0}>
        <Text dimColor>← → select button · Enter confirm · Esc close</Text>
      </Box>
    </Box>
  );
};
