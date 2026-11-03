import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';

interface ResultViewProps {
  lines: string[];
  selectedIndex: number;
  width: number;
  height: number;
}

export const ResultView: React.FC<ResultViewProps> = ({
  lines,
  selectedIndex,
  width,
  height,
}) => {
  const limit = Math.max(5, height - 7);
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(limit / 2), lines.length - limit));
  const visible = lines.slice(start, start + limit);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Section title="Command Result" badge={lines.length} flexGrow={1} marginBottom={0}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text dimColor>
            Type <Text color="cyan" bold>/</Text> for next command · ↑↓ scroll · Esc close
          </Text>
        </Box>

        {visible.map((line, index) => {
          const actualIdx = start + index;
          const isSelected = selectedIndex === actualIdx;
          return (
            <Text
              key={`${start}-${index}`}
              color={isSelected ? 'cyan' : undefined}
            >
              {clipText(line, Math.max(20, width - 6))}
            </Text>
          );
        })}

        {lines.length > visible.length ? (
          <Text dimColor>
            Line {start + 1}–{start + visible.length} of {lines.length}
          </Text>
        ) : null}
      </Section>
    </Box>
  );
};
