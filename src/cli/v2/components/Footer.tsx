import React from 'react';
import { Box, Text } from 'ink';

interface FooterProps {
  screen: string;
  width: number;
  paletteOpen?: boolean;
}

export const Footer: React.FC<FooterProps> = ({
  screen,
  width,
  paletteOpen = false,
}) => {
  const compact = width < 75;

  if (paletteOpen) {
    return (
      <Box marginTop={0}>
        <Text dimColor>
          ↑↓ select · Tab complete · Enter run · Esc close
        </Text>
      </Box>
    );
  }

  if (compact) {
    return (
      <Box marginTop={0}>
        <Text dimColor>
          1-4 · p a r · / cmd · ? help · q quit
        </Text>
      </Box>
    );
  }

  return (
    <Box marginTop={0}>
      <Text dimColor>
        1 Dashboard · 2 Scripts · 3 Bots · 4 Logs · p Profiles · a Alts · r Remote · / Commands · ? Help · q Quit
      </Text>
    </Box>
  );
};
