import type { AltWithData } from '../../../../../main/src/types';
import type {
  ProfileUiJson,
  ProfileUiSection,
} from '../../../../../common/profileUiSchema';

interface FallbackInput {
  username: string;
  server: string;
  alt: AltWithData | null | undefined;
}

/**
 * Minimal profile UI for servers/players that don't have a custom action
 * wired up. Pulls everything from the local alt data — no network calls.
 */
export function buildFallbackProfile({
  username,
  alt,
}: FallbackInput): ProfileUiJson {
  const serverInfo = alt?.data;
  const ranks = Object.entries(serverInfo?.ranks ?? {})
    .filter(([, name]) => !!name)
    .map(([gm, name]) => ({ name, server: gm }));
  const gkitGroups = Object.entries(serverInfo?.gkits ?? {})
    .filter(([, items]) => items.length)
    .map(([gamemode, items]) => ({ gamemode, items }));

  const sections: ProfileUiSection[] = [
    {
      id: 'identity',
      type: 'identity',
      column: 'left',
      visible: true,
      data: {
        counts: [
          { label: 'ranks', value: ranks.length },
          {
            label: 'gkits',
            value: gkitGroups.reduce((n, g) => n + g.items.length, 0),
          },
        ],
      },
    },
  ];

  if (ranks.length) {
    sections.push({
      id: 'ranks',
      type: 'ranks',
      column: 'right',
      visible: true,
      data: { items: ranks },
    });
  }

  if (gkitGroups.length) {
    sections.push({
      id: 'gkits',
      type: 'gkits',
      column: 'left',
      visible: true,
      data: { groups: gkitGroups },
    });
  }

  return {
    player: {
      username,
      skinUrl: `https://crafthead.net/armor/body/${username}`,
      displayName: username,
    },
    sections,
  };
}
