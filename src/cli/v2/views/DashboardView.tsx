import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';
import type { CliSnapshot, CooldownInfo, OutputEvent } from '../types';

interface DashboardViewProps {
  snapshot: CliSnapshot;
  cooldowns: CooldownInfo[];
  recentLogs: readonly OutputEvent[];
  width: number;
  height: number;
  layout: 'compact' | 'standard' | 'wide';
}

const colorMap: Record<OutputEvent['severity'], string> = {
  debug: 'gray',
  info: 'cyan',
  success: 'green',
  warn: 'yellow',
  error: 'red',
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  snapshot,
  cooldowns,
  recentLogs,
  width,
  height,
  layout,
}) => {
  const compact = layout === 'compact';
  const itemLimit = compact ? 3 : Math.max(4, Math.floor((height - 16) / 4));
  const [scrollOffset, setScrollOffset] = useState<number | null>(null);

  const colWidth = Math.max(20, Math.floor(width * 0.6) - 4);
  const limit = Math.max(4, height - 7);

  const lines = layout === 'wide'
    ? recentLogs.flatMap((event, i) =>
        event.message.split(/\r?\n/).map((line, j) => ({
          key: `${event.timestamp}-${i}-${j}`,
          severity: event.severity,
          text: clipText(line, colWidth),
        }))
      )
    : [];

  const maxOffset = Math.max(0, lines.length - limit);

  useInput((input, key) => {
    if (layout !== 'wide') return;
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, (prev ?? maxOffset) - 1));
    } else if (key.downArrow) {
      setScrollOffset((prev) => {
        if (prev === null) return null;
        const next = prev + 1;
        return next >= maxOffset ? null : next;
      });
    } else if (key.pageUp) {
      setScrollOffset((prev) => Math.max(0, (prev ?? maxOffset) - Math.max(1, limit - 2)));
    } else if (key.pageDown) {
      setScrollOffset((prev) => {
        if (prev === null) return null;
        const next = prev + Math.max(1, limit - 2);
        return next >= maxOffset ? null : next;
      });
    } else if (input === 'g') {
      setScrollOffset(0);
    } else if (input === 'G') {
      setScrollOffset(null);
    }
  });

  const cards = (
    <Box flexDirection="column" flexGrow={1}>
      <Section title="Session" flexGrow={1}>
        <Text>
          Profile:{' '}
          <Text color="green" bold>
            {clipText(snapshot.profile.name, compact ? 22 : 40)}
          </Text>
        </Text>
        <Text dimColor>ID: {snapshot.profile.id}</Text>
        <Text>
          Remote:{' '}
          <Text color={snapshot.remote.active ? 'green' : 'gray'}>
            {snapshot.remote.active ? '● online' : '○ offline'}
          </Text>{' '}
          · {snapshot.remote.connections} connected
        </Text>
      </Section>

      <Section title="Running scripts" badge={snapshot.scripts.length} flexGrow={1}>
        {snapshot.scripts.length ? (
          snapshot.scripts.slice(0, itemLimit).map((script) => (
            <Text key={script.id}>
              • {clipText(script.name, compact ? 18 : 34)}{' '}
              <Text dimColor>
                {script.elapsed}
                {script.progress ? ` · ${script.progress}` : ''}
              </Text>
            </Text>
          ))
        ) : (
          <Text dimColor>Nothing is running. Press 2 for scripts.</Text>
        )}
      </Section>

      <Section title="Connected bots" badge={snapshot.bots.length} flexGrow={1}>
        {snapshot.bots.length ? (
          snapshot.bots.slice(0, itemLimit).map((bot) => (
            <Text key={bot.id}>
              • <Text color="green">{clipText(bot.username, compact ? 12 : 20)}</Text>{' '}
              <Text dimColor>{clipText(bot.server, compact ? 16 : 30)}</Text>
            </Text>
          ))
        ) : (
          <Text dimColor>No bots connected. Press 2 → j to join.</Text>
        )}
      </Section>

      <Section title="Cooldowns & Intervals" badge={cooldowns.length} flexGrow={1}>
        {cooldowns.length ? (
          cooldowns.slice(0, itemLimit).map((cd) => (
            <Text key={cd.id}>
              • {clipText(cd.name, compact ? 14 : 26)}{' '}
              <Text color={cd.ready ? 'green' : 'yellow'}>
                {cd.ready ? 'Ready' : cd.remainingFormatted}
              </Text>
              {cd.autoStart ? <Text color="cyan"> [auto]</Text> : <Text dimColor> [manual]</Text>}
            </Text>
          ))
        ) : (
          <Text dimColor>No script intervals configured.</Text>
        )}
      </Section>
    </Box>
  );

  if (layout === 'wide') {
    const start = scrollOffset === null ? maxOffset : Math.min(scrollOffset, maxOffset);
    const visible = lines.slice(start, start + limit);
    const badge = scrollOffset !== null && scrollOffset < maxOffset
      ? `${start + 1}-${Math.min(start + limit, lines.length)} of ${lines.length}`
      : lines.length > limit
      ? `${lines.length} · Live`
      : lines.length;

    return (
      <Box gap={1} flexGrow={1}>
        <Box width="40%" flexDirection="column" flexGrow={1}>
          {cards}
        </Box>
        <Box width="60%" flexDirection="column" flexGrow={1}>
          <Section title="Recent activity logs" badge={badge} flexGrow={1} marginBottom={0}>
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              {visible.length ? (
                visible.map((line) => (
                  <Text key={line.key} color={colorMap[line.severity]} wrap="truncate">
                    {line.text}
                  </Text>
                ))
              ) : (
                <Text dimColor>No logs yet.</Text>
              )}
            </Box>
          </Section>
        </Box>
      </Box>
    );
  }

  return cards;
};
