import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';

interface ProfileItem {
  server: string;
  data: {
    name?: string;
    shortName?: string;
  };
}

interface ProfilesViewProps {
  profiles: ProfileItem[];
  activeProfileKey: string;
  selectedProfile: number;
  width: number;
  height: number;
}

export const ProfilesView: React.FC<ProfilesViewProps> = ({
  profiles,
  activeProfileKey,
  selectedProfile,
  width,
  height,
}) => {
  const limit = Math.max(5, height - 7);
  const start = Math.max(0, Math.min(selectedProfile - Math.floor(limit / 2), profiles.length - limit));
  const visible = profiles.slice(start, start + limit);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Section title="Installed Profiles" badge={profiles.length} flexGrow={1} marginBottom={0}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text dimColor>↑↓ choose · Enter switch · [m] / [n] marketplace &amp; new profile</Text>
        </Box>

        {visible.map((profile, index) => {
          const actualIdx = start + index;
          const isSelected = selectedProfile === actualIdx;
          const isActive = profile.server === activeProfileKey;
          const name = profile.data.name ?? profile.data.shortName ?? profile.server;

          return (
            <Box key={profile.server} justifyContent="space-between">
              <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                {isSelected ? '› ' : '  '}
                {clipText(name, Math.max(16, Math.floor(width * 0.5)))}
              </Text>
              <Text color={isActive ? 'green' : 'gray'}>
                {isActive ? '[active]' : profile.server}
              </Text>
            </Box>
          );
        })}

        {profiles.length > visible.length ? (
          <Text dimColor>
            {start + 1}–{start + visible.length} of {profiles.length}
          </Text>
        ) : null}
      </Section>
    </Box>
  );
};
