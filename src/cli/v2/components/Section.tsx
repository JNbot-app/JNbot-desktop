import React from 'react';
import { Box, Text } from 'ink';

interface SectionProps {
  title: string;
  badge?: string | number;
  focused?: boolean;
  dimColor?: boolean;
  children: React.ReactNode;
  marginBottom?: number;
  flexGrow?: number;
  height?: number | string;
}

export const Section: React.FC<SectionProps> = ({
  title,
  badge,
  focused = false,
  dimColor = false,
  children,
  marginBottom = 1,
  flexGrow,
  height,
}) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
      marginBottom={marginBottom}
      flexGrow={flexGrow}
      height={height}
    >
      <Box justifyContent="space-between" marginBottom={0}>
        <Text bold color={focused ? 'cyan' : 'white'} dimColor={dimColor && !focused}>
          {focused ? '› ' : ''}{title}
        </Text>
        {badge !== undefined ? (
          <Text dimColor>({badge})</Text>
        ) : null}
      </Box>
      {children}
    </Box>
  );
};
