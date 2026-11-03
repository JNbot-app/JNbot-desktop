import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';

export const COMMAND_GROUPS = [
  ['Runtime', ['status', 'serve [--profile <id>] [--remote-access]']],
  [
    'Navigate',
    [
      'dashboard',
      'scripts',
      'bots',
      'logs',
      'profiles',
      'alts',
      'remote',
      'help',
    ],
  ],
  [
    'Scripts & Plugins',
    [
      'script list',
      'script run <name>',
      'plugin list',
      'plugin run <id-or-name>',
      'plugin options <id-or-name>',
      'plugin options-set <id-or-name> <option> <json-value>',
    ],
  ],
  [
    'Bots',
    [
      'bot join <username> [--version <ver>]',
      'bot list',
      'bot status [idOrName]',
      'bot chat [idOrName] [message]',
      'bot inventory [idOrName]',
    ],
  ],
  [
    'Intervals & Cooldowns',
    [
      'cooldown list',
      'cooldown add <pluginId> <interval>',
      'cooldown remove <id>',
      'cooldown toggle <id>',
      'cooldown reset <id>',
    ],
  ],
  [
    'Profiles & Settings',
    [
      'profile current',
      'profile list',
      'profile marketplace',
      'profile install <id>',
      'profile use <id>',
      'profile import <file>',
      'profile export <id> <file>',
      'settings get [path]',
      'settings set <path> <json-value>',
    ],
  ],
  [
    'Alts',
    [
      'alt list',
      'alt add <username> [--premium] [--email <email>] [--password <pwd>]',
      'alt remove <username> --yes',
    ],
  ],
  [
    'Remote Access',
    [
      'remote start [--device <id>]',
      'remote qr [id]',
      'remote url [id]',
      'remote devices list',
      'remote devices add <name>',
      'remote devices remove <id> --yes',
    ],
  ],
  [
    'JNbot Cloud & Backups',
    [
      'cloud status',
      'cloud upload',
      'cloud import --user <id> --share-key <key> --yes',
      'data export <file>',
      'data import <file> --yes',
      'plugin import <files...>',
      'plugin export <id> <file>',
    ],
  ],
] as const;

interface HelpViewProps {
  selectedHelp: number;
  width: number;
  height: number;
}

export const HelpView: React.FC<HelpViewProps> = ({
  selectedHelp,
  width,
  height,
}) => {
  const helpLines = COMMAND_GROUPS.flatMap(([group, commands]) => [
    { text: group, group: true },
    ...commands.map((text) => ({ text, group: false })),
  ]);

  const limit = Math.max(5, height - 7);
  const start = Math.max(0, Math.min(selectedHelp - Math.floor(limit / 2), helpLines.length - limit));
  const visible = helpLines.slice(start, start + limit);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Section title="Help & Commands" badge={helpLines.length} flexGrow={1} marginBottom={0}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text dimColor>↑↓ scroll · Press / to open the command runner</Text>
        </Box>

        {visible.map((line, index) => {
          const actualIdx = start + index;
          const isSelected = selectedHelp === actualIdx;
          return (
            <Text
              key={`${start}-${index}`}
              bold={line.group}
              color={isSelected ? 'cyan' : line.group ? 'green' : undefined}
            >
              {line.group ? `[ ${line.text} ]` : `    ${clipText(line.text, Math.max(16, width - 10))}`}
            </Text>
          );
        })}

        {helpLines.length > visible.length ? (
          <Text dimColor>
            {start + 1}–{start + visible.length} of {helpLines.length}
          </Text>
        ) : null}
      </Section>
    </Box>
  );
};
