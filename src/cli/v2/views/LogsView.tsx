import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';
import type { OutputEvent } from '../types';

interface LogsViewProps {
  events: readonly OutputEvent[];
  width: number;
  height: number;
}

const colorMap: Record<OutputEvent['severity'], string> = {
  debug: 'gray',
  info: 'cyan',
  success: 'green',
  warn: 'yellow',
  error: 'red',
};

export const LogsView: React.FC<LogsViewProps> = ({
  events,
  width,
  height,
}) => {
  const limit = Math.max(8, height - 7);
  const recent = events.slice(-Math.max(20, height * 2)).reverse();
  const visible = recent.slice(0, limit);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Section title="Activity Logs" badge={events.length} flexGrow={1} marginBottom={0}>
        {visible.length ? (
          visible.map((event, index) => (
            <Text key={`${event.timestamp}-${index}`} color={colorMap[event.severity]}>
              {clipText(`[${event.severity.toUpperCase()}] ${event.message}`, Math.max(20, width - 6))}
            </Text>
          ))
        ) : (
          <Text dimColor>No logs recorded yet.</Text>
        )}
      </Section>
    </Box>
  );
};
