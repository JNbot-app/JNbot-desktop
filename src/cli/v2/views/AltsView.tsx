import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';

interface AltItem {
  username: string;
  data?: { premium?: boolean };
  email?: string | null;
}

interface AltsViewProps {
  alts: AltItem[];
  selectedAlt: number;
  confirmRemoval: boolean;
  width: number;
  height: number;
}

export const AltsView: React.FC<AltsViewProps> = ({
  alts,
  selectedAlt,
  confirmRemoval,
  width,
  height,
}) => {
  const limit = Math.max(6, height - 7);
  const start = Math.max(0, Math.min(selectedAlt - Math.floor(limit / 2), alts.length - limit));
  const visible = alts.slice(start, start + limit);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Section title="Profile Alts" badge={alts.length} flexGrow={1} marginBottom={0}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text dimColor>↑↓ select · Enter view/edit details · [n] add alt · [d] remove</Text>
          {confirmRemoval && alts[selectedAlt] ? (
            <Text color="yellow" bold>
              Remove {alts[selectedAlt].username}? Press [y] to confirm
            </Text>
          ) : null}
        </Box>

        {alts.length > 0 ? (
          visible.map((alt, index) => {
            const actualIdx = start + index;
            const isSelected = selectedAlt === actualIdx;
            return (
              <Box key={alt.username} justifyContent="space-between">
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '› ' : '  '}
                  {clipText(alt.username, Math.max(16, Math.floor(width * 0.4)))}
                </Text>
                <Text dimColor>
                  {alt.data?.premium ? (
                    <Text color="cyan">premium</Text>
                  ) : (
                    <Text color="gray">cracked</Text>
                  )}
                </Text>
              </Box>
            );
          })
        ) : (
          <Box flexDirection="column" marginY={1}>
            <Text dimColor>No alts configured in this profile.</Text>
            <Text color="cyan">Press [n] to add an alt.</Text>
          </Box>
        )}

        {alts.length > visible.length ? (
          <Text dimColor>
            {start + 1}–{start + visible.length} of {alts.length}
          </Text>
        ) : null}
      </Section>
    </Box>
  );
};
