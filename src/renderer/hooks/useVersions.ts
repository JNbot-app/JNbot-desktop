import { useState, useEffect, useCallback } from 'react';
import { MinecraftLauncherTypes } from '../../common/CommonEnums';
import type { VersionItem } from '../components/mcLauncher/VersionBrowser';
import { VersionInfo } from '../../main/src/functions/minecraft/launcher/MinecraftLauncherTypes';
import { inferUpdateKey, SNAPSHOTS_GROUP_KEY } from '../components/mcLauncher/versionUtils';

const imageByUpdateKey: Record<string, string> = {
  '1.21': 'https://i.ibb.co/zTZW6WDc/1-21-Large.jpg',
  '1.20': 'https://i.ibb.co/2YNfnWDb/1-20-Large.jpg',
  '1.19': 'https://i.ibb.co/HpHjM76g/1-19-Large.jpg',
  '1.18': 'https://i.ibb.co/WvnhBCrq/1-18-Large.jpg',
  '1.17': 'https://i.ibb.co/TBYrPL2Y/1-17-Large.jpg',
  '1.16': 'https://i.ibb.co/ZR2zsm3v/1-16-Large.jpg',
  '1.15': 'https://i.ibb.co/RpPZPcp8/1-15-Large.jpg',
  '1.14': 'https://i.ibb.co/gHkYn2Y/1-14-Large.jpg',
  '1.13': 'https://i.ibb.co/tp6GD2N0/1-13-Large.jpg',
  '1.12': 'https://i.ibb.co/xS8mCV1G/1-12-Large.jpg',
  '1.11': 'https://i.ibb.co/PsL1SzXw/1-11-Large.jpg',
  '1.10': 'https://i.ibb.co/Rk4yFxHy/1-10-Large.jpg',
  '1.9': 'https://i.ibb.co/R4kyhZwK/1-9-Large.jpg',
  '1.8': 'https://i.ibb.co/QjmQQRQr/1-8-Large.jpg',
  '1.7': 'https://i.ibb.co/WNPp8N2Y/1-7-Large.jpg',
  '26': 'https://i.ibb.co/PzjXbcqb/banner-Minecraft26.jpg',
  [SNAPSHOTS_GROUP_KEY]: 'https://i.ibb.co/jPp57Z0D/snapshots-Large.jpg',
  other: 'https://i.ibb.co/nM1mSwYP/other-Large.jpg',
};

interface UseVersionsProps {
  selectedVersionId: string | undefined;
  selectedLauncherFlags: MinecraftLauncherTypes | undefined;
  onVersionSelect: (selection: { versionId: string; launcherFlags: number }) => void;
  message: any;
}

export const useVersions = ({
  selectedVersionId,
  selectedLauncherFlags,
  onVersionSelect,
  message,
}: UseVersionsProps) => {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const getVersionImage = (updateKey: string | undefined, type: VersionItem['type']): string => {
    if (type === 'snapshot') return imageByUpdateKey[SNAPSHOTS_GROUP_KEY] ?? imageByUpdateKey.other;
    if (!updateKey) return imageByUpdateKey.other;
    return imageByUpdateKey[updateKey] ?? imageByUpdateKey.other;
  };

  const mapVersionInfo = (version: VersionInfo): VersionItem => {
    const type = version.type as VersionItem['type']
    const updateKey = inferUpdateKey(version.id, type);
    const imageUrl = getVersionImage(updateKey, type);
    return {
      id: version.id,
      version: version.name ?? version.id,
      type ,
      updateKey,
      imageUrl,
      backgroundImage: imageUrl,
      launcherType: version.launcherType ?? MinecraftLauncherTypes.VANILLA,
    };
  };

  const fetchVersions = useCallback(async () => {
    try {
      setVersionsLoading(true);
      const allVersions = (await window.ipcRenderer.get('GET_MINECRAFT_VERSIONS')) as VersionInfo[];
      const baseItems = allVersions.map(mapVersionInfo);
      setVersions(baseItems);

      const hasSelected =
        selectedVersionId &&
        selectedLauncherFlags !== undefined &&
        baseItems.some(
          (v) => v.id === selectedVersionId && v.launcherType === selectedLauncherFlags,
        );

      if (!hasSelected) {
        const preferred =
          baseItems.find((v) => v.launcherType === MinecraftLauncherTypes.VANILLA) ??
          baseItems[0];

        if (preferred) {
          onVersionSelect({
            versionId: preferred.id,
            launcherFlags: preferred.launcherType,
          });
        }
      }
    } catch (err: unknown) {
      console.error('Failed to fetch Minecraft versions', err);
      message.error('Failed to fetch Minecraft versions');
    } finally {
      setVersionsLoading(false);
    }
  }, [selectedVersionId, selectedLauncherFlags, onVersionSelect, message]);

  // Fetch once on mount; fetchVersions changes with the selection and would refetch.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    fetchVersions();
  }, []);

  /* oxlint-enable react-hooks/exhaustive-deps */
  return { versions, versionsLoading };
};
