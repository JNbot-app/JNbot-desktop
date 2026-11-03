import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';

interface PaletteItem {
  label: string;
  description: string;
}

interface CommandPaletteProps {
  query: string;
  matches: PaletteItem[];
  selectedIndex: number;
  width: number;
  height: number;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  query,
  matches,
  selectedIndex,
  width,
  height,
}) => {
  const limit = Math.max(3, Math.min(7, height - 8));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(limit / 2), matches.length - limit));
  const visible = matches.slice(start, start + limit);

  return (
    <Box flexDirection="column">
      <Section title="Command Palette" focused>
        <Box marginBottom={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">&gt; </Text>
          <Text color="white">{query}</Text>
          <Text inverse> </Text>
        </Box>

        <Box justifyContent="space-between" marginBottom={1}>
          <Text dimColor>Tab completes · ↑↓ select · Enter runs · Esc cancels</Text>
        </Box>

        {visible.map((item, index) => {
          const actualIdx = start + index;
          const isSelected = selectedIndex === actualIdx;
          return (
            <Box key={`${item.label}-${actualIdx}`} justifyContent="space-between">
              <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                {isSelected ? '› ' : '  '}
                {clipText(item.label, Math.max(16, Math.floor(width * 0.55)))}
              </Text>
              <Text dimColor>— {clipText(item.description, Math.max(12, Math.floor(width * 0.35)))}</Text>
            </Box>
          );
        })}

        {!matches.length ? (
          <Text dimColor>No suggestion; Enter still runs the typed command.</Text>
        ) : null}

        {matches.length > visible.length ? (
          <Text dimColor>
            {start + 1}–{start + visible.length} of {matches.length}
          </Text>
        ) : null}
      </Section>
    </Box>
  );
};
