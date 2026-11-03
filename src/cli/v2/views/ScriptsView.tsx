import React from 'react';
import { scheduleLabel } from '../../../common/cooldowns';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';
import type { RunItem, CliSnapshot, CooldownInfo } from '../types';

interface ScriptsViewProps {
  profileScripts: RunItem[];
  libraryPlugins: RunItem[];
  cooldowns: CooldownInfo[];
  snapshot: CliSnapshot;
  selectedScript: number;
  selectedPlugin: number;
  selectedCooldown: number;
  activeFocus: 'scripts' | 'plugins' | 'cooldowns';
  width: number;
  height: number;
  layout: 'compact' | 'standard' | 'wide';
}

function pageItems<T>(items: T[], selected: number, limit: number): { items: T[]; start: number } {
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), items.length - limit));
  return { items: items.slice(start, start + limit), start };
}

export const ScriptsView: React.FC<ScriptsViewProps> = ({
  profileScripts,
  libraryPlugins,
  cooldowns,
  selectedScript,
  selectedPlugin,
  selectedCooldown,
  activeFocus,
  height,
  layout,
}) => {
  const compact = layout === 'compact';
  const cardHeight = Math.max(compact ? 3 : 4, Math.floor((height - 14) / 3));

  const pScriptsPage = pageItems(profileScripts, selectedScript, cardHeight);
  const pluginsPage = pageItems(libraryPlugins, selectedPlugin, cardHeight);
  const cooldownsPage = pageItems(cooldowns, selectedCooldown, cardHeight);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Quick Built-in Tools Bar */}
      <Box justifyContent="space-between" marginBottom={1} paddingX={1}>
        <Text dimColor>
          Built-in tools: <Text color="cyan">[j] Join Bot</Text> · <Text color="cyan">[d] Discord Bot</Text> · <Text color="cyan">[x] JNbot Proxy</Text> · <Text color="yellow">[s] Stop All</Text>
        </Text>
        <Text dimColor>Tab switches sections</Text>
      </Box>

      {/* Profile Scripts Card */}
      <Section
        title="Profile Scripts"
        badge={profileScripts.length}
        focused={activeFocus === 'scripts'}
        flexGrow={1}
      >
        {profileScripts.length ? (
          pScriptsPage.items.map((item, index) => {
            const actualIdx = index + pScriptsPage.start;
            const isSelected = activeFocus === 'scripts' && actualIdx === selectedScript;
            return (
              <Box key={item.id} justifyContent="space-between">
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '› ' : '  '}
                  {clipText(item.name, compact ? 20 : 36)}
                </Text>
                <Text dimColor>
                  {clipText(item.detail, compact ? 12 : 24)}
                </Text>
              </Box>
            );
          })
        ) : (
          <Text dimColor>No profile scripts available for this server.</Text>
        )}
        {profileScripts.length > pScriptsPage.items.length ? (
          <Text dimColor>
            {pScriptsPage.start + 1}–{pScriptsPage.start + pScriptsPage.items.length} of {profileScripts.length}
          </Text>
        ) : null}
      </Section>

      {/* User & Library Plugins Card */}
      <Section
        title="Plugins"
        badge={libraryPlugins.length}
        focused={activeFocus === 'plugins'}
        flexGrow={1}
      >
        {libraryPlugins.length ? (
          pluginsPage.items.map((item, index) => {
            const actualIdx = index + pluginsPage.start;
            const isSelected = activeFocus === 'plugins' && actualIdx === selectedPlugin;
            return (
              <Box key={item.id} justifyContent="space-between">
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '› ' : '  '}
                  {clipText(item.name, compact ? 20 : 36)}
                </Text>
                <Text dimColor>
                  {clipText(item.detail, compact ? 12 : 24)}
                </Text>
              </Box>
            );
          })
        ) : (
          <Text dimColor>No plugins found in library.</Text>
        )}
        {libraryPlugins.length > pluginsPage.items.length ? (
          <Text dimColor>
            {pluginsPage.start + 1}–{pluginsPage.start + pluginsPage.items.length} of {libraryPlugins.length}
          </Text>
        ) : null}
      </Section>

      {/* Dedicated Cooldowns & Intervals Card */}
      <Section
        title="Script Cooldowns & Intervals"
        badge={cooldowns.length}
        focused={activeFocus === 'cooldowns'}
        flexGrow={1}
      >
        <Box justifyContent="space-between" marginBottom={0}>
          <Text dimColor>
            {activeFocus === 'cooldowns'
              ? 'Space toggle auto-run · [c] change cooldown · [r] reset timer · [d] remove'
              : 'Auto-generated script timers · Tab to focus'}
          </Text>
        </Box>
        {cooldowns.length ? (
          cooldownsPage.items.map((cd, index) => {
            const actualIdx = index + cooldownsPage.start;
            const isSelected = activeFocus === 'cooldowns' && actualIdx === selectedCooldown;
            return (
              <Box key={cd.id} justifyContent="space-between">
                <Box gap={1}>
                  <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                    {isSelected ? '› ' : '  '}
                    {clipText(cd.name, compact ? 14 : 26)}
                  </Text>
                  <Text color={cd.autoStart ? 'green' : 'gray'}>
                    {cd.autoStart ? '[X] Auto-run' : cd.kind === 'schedule' ? '[ ] Paused' : '[ ] Manual'}
                  </Text>
                </Box>
                <Box gap={1}>
                  <Text color={cd.ready ? 'green' : 'yellow'} bold={cd.ready}>
                    {cd.ready ? (cd.kind === 'schedule' ? 'Due' : 'Ready') : cd.remainingFormatted}
                  </Text>
                  <Text dimColor>
                    ({cd.kind === 'schedule' ? scheduleLabel(cd.repeat) : `${Math.round(cd.cooldown / 1000 / 60)}m`})
                  </Text>
                </Box>
              </Box>
            );
          })
        ) : (
          <Text dimColor>No script cooldowns active. Scripts register cooldowns when run.</Text>
        )}
        {cooldowns.length > cooldownsPage.items.length ? (
          <Text dimColor>
            {cooldownsPage.start + 1}–{cooldownsPage.start + cooldownsPage.items.length} of {cooldowns.length}
          </Text>
        ) : null}
      </Section>
    </Box>
  );
};
