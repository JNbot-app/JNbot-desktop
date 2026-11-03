import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  screen: string;
  profileName: string;
  notice?: string;
  width: number;
}

export function clipText(value: unknown, width: number): string {
  const str = String(value ?? '');
  return str.length <= width
    ? str
    : `${str.slice(0, Math.max(0, width - 1))}…`;
}

export const Header: React.FC<HeaderProps> = ({
  screen,
  profileName,
  notice,
  width,
}) => {
  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1}>
          <Text bold color="cyan">
            JNbot
          </Text>
          <Text dimColor>│</Text>
          <Text color="green">
            {clipText(profileName, Math.max(16, Math.floor(width / 3)))}
          </Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>view:</Text>
          <Text bold color="cyan">
            {screen.toUpperCase()}
          </Text>
        </Box>
      </Box>
      {notice ? (
        <Box marginTop={0}>
          <Text color="yellow">
            › {clipText(notice, Math.max(20, width - 4))}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
