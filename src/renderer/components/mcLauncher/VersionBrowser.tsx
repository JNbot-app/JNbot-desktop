import React, { useMemo, useState } from 'react';
import { Col, Collapse, Drawer, Row, Space, Typography } from 'antd';

import VersionCard from './VersionCard';
import {
  inferUpdateKey,
  launcherLabel,
  sortVersionGroupKey,
} from './versionUtils';
import { MinecraftLauncherTypes } from '../../../common/CommonEnums';

export type VersionItem = {
  id: string;
  version: string;
  type: 'release' | 'snapshot' | 'legacy';
  imageUrl?: string;
  backgroundImage?: string;
  updateKey?: string;
  launcherType: MinecraftLauncherTypes;
};

interface VersionBrowserProps {
  versions: VersionItem[];
  selectedVersion: { id: string; launcherFlags: number } | null;
  onSelect: (selection: { versionId: string; launcherFlags: number }) => void;
}

type VersionGroup = {
  key: string;
  imageUrl?: string;
  latestVersion: string;
};

const parseReleaseId = (id: string): { major: number; minor: number; patch: number } | null => {
  const match = id.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1] ?? 0),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
};

const compareMinecraftIdsDesc = (a: string, b: string): number => {
  const aRel = parseReleaseId(a);
  const bRel = parseReleaseId(b);
  if (aRel && bRel) {
    if (aRel.major !== bRel.major) return bRel.major - aRel.major;
    if (aRel.minor !== bRel.minor) return bRel.minor - aRel.minor;
    if (aRel.patch !== bRel.patch) return bRel.patch - aRel.patch;
    return b.localeCompare(a);
  }

  const aSnap = a.match(/^(\d{2})w(\d{2})([a-z])$/i);
  const bSnap = b.match(/^(\d{2})w(\d{2})([a-z])$/i);
  if (aSnap && bSnap) {
    const ay = Number(aSnap[1]);
    const by = Number(bSnap[1]);
    if (ay !== by) return by - ay;
    const aw = Number(aSnap[2]);
    const bw = Number(bSnap[2]);
    if (aw !== bw) return bw - aw;
    return (bSnap[3] ?? '').localeCompare(aSnap[3] ?? '');
  }

  return b.localeCompare(a);
};



const VersionBrowser: React.FC<VersionBrowserProps> = ({
  versions,
  selectedVersion,
  onSelect,
}) => {
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);

  const jnbotVersions = useMemo(() => {
    return versions
      .filter((v) => v.launcherType === MinecraftLauncherTypes.JNBOT_CLIENT)
      .slice()
      .sort((a, b) => compareMinecraftIdsDesc(a.id, b.id));
  }, [versions]);

  const normalVersions = useMemo(() => {
    return versions.filter((v) => v.launcherType !== MinecraftLauncherTypes.JNBOT_CLIENT);
  }, [versions]);

  const groups = useMemo((): VersionGroup[] => {
    const groupsByKey = new Map<string, VersionGroup>();

    const seed = normalVersions.some((v) => v.launcherType === MinecraftLauncherTypes.VANILLA)
      ? normalVersions.filter((v) => v.launcherType === MinecraftLauncherTypes.VANILLA)
      : normalVersions;

    seed.forEach((v) => {
      const key = v.updateKey ?? inferUpdateKey(v.id, v.type);

      const existing = groupsByKey.get(key);

      if (!existing) {
        groupsByKey.set(key, {
          key,
          imageUrl: v.imageUrl,
          latestVersion: v.version,
        });
        return;
      }

      existing.imageUrl = existing.imageUrl ?? v.imageUrl;
    });

    return Array.from(groupsByKey.values()).sort((a, b) => {
      return sortVersionGroupKey(a.key, b.key);
    });
  }, [normalVersions]);

  const selectedUpdateKey = useMemo(() => {
    if (!selectedVersion?.id) return null;
    if (selectedVersion.launcherFlags === MinecraftLauncherTypes.JNBOT_CLIENT) return null;

    const selected = normalVersions.find(
      (v) =>
        v.id === selectedVersion.id &&
        v.launcherType === (selectedVersion.launcherFlags as MinecraftLauncherTypes),
    );
    if (!selected) return null;
    return selected.updateKey ?? inferUpdateKey(selected.id, selected.type);
  }, [selectedVersion?.id, selectedVersion?.launcherFlags, normalVersions]);

  const openGroupVersions = useMemo(() => {
    if (!openGroupKey) return [] as VersionItem[];
    const filtered = normalVersions.filter((v) => {
      const key = v.updateKey ?? inferUpdateKey(v.id, v.type);
      return key === openGroupKey;
    });

    return filtered.sort((a, b) => compareMinecraftIdsDesc(a.id, b.id));
  }, [openGroupKey, normalVersions]);

  const openGroupByLauncher = useMemo(() => {
    const map = new Map<MinecraftLauncherTypes, VersionItem[]>();
    for (const v of openGroupVersions) {
      const list = map.get(v.launcherType) ?? [];
      list.push(v);
      map.set(v.launcherType, list);
    }

    for (const [key, list] of map) {
      map.set(key, list.slice().sort((a, b) => compareMinecraftIdsDesc(a.id, b.id)));
    }

    return map;
  }, [openGroupVersions]);

  const openGroupFeatured = useMemo(() => {
    const launchers = Array.from(openGroupByLauncher.keys())
      .filter((l) => l !== MinecraftLauncherTypes.JNBOT_CLIENT)
      .sort((a, b) => a - b);

    return launchers
      .map((launcherType) => {
        const list = openGroupByLauncher.get(launcherType);
        return list && list.length ? list[0] : null;
      })
      .filter((v): v is VersionItem => Boolean(v));
  }, [openGroupByLauncher]);

  const collapseItems = useMemo(() => {
    const launchers = Array.from(openGroupByLauncher.keys())
      .filter((l) => l !== MinecraftLauncherTypes.JNBOT_CLIENT)
      .sort((a, b) => a - b);

    return launchers.map((launcherType) => {
      const list = openGroupByLauncher.get(launcherType) ?? [];
      return {
        key: String(launcherType),
        label: launcherLabel(launcherType),
        children: (
          <Row gutter={[12, 12]}>
            {list.map((v) => (
              <Col xs={24} sm={12} md={8} lg={6} key={`${launcherType}:${v.id}`}>
                <VersionCard
                  version={v.version}
                  selected={
                    selectedVersion?.id === v.id &&
                    selectedVersion?.launcherFlags === v.launcherType
                  }
                  onClick={() => {
                    onSelect({ versionId: v.id, launcherFlags: v.launcherType });
                    setOpenGroupKey(null);
                  }}
                  imageUrl={v.imageUrl}
                  launcherType={v.launcherType}
                />
              </Col>
            ))}
          </Row>
        ),
      };
    });
  }, [openGroupByLauncher, onSelect, selectedVersion?.id, selectedVersion?.launcherFlags]);

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">

      {jnbotVersions.length > 0 && (
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Typography.Title level={4} style={{ margin: 0 }}>
            JNbot Client
          </Typography.Title>
          <Row gutter={[12, 12]}>
            {jnbotVersions.map((v) => (
              <Col xs={24} sm={12} md={8} lg={6} key={v.id}>
                <VersionCard
                  version={v.version}
                  selected={
                    selectedVersion?.id === v.id &&
                    selectedVersion?.launcherFlags === MinecraftLauncherTypes.JNBOT_CLIENT
                  }
                  onClick={() =>
                    onSelect({ versionId: v.id, launcherFlags: v.launcherType })
                  }
                  imageUrl={v.imageUrl}
                  launcherType={v.launcherType}
                />
              </Col>
            ))}
          </Row>
        </Space>
      )}

      <Typography.Title level={4} style={{ margin: 0 }}>
        Minecraft Versions
      </Typography.Title>
      
      <Row gutter={[12, 12]}>
        {groups.map((g) => (
          <Col xs={24} sm={12} md={8} lg={6} key={g.key}>
            <VersionCard
              version={g.key}
              selected={selectedUpdateKey === g.key}
              onClick={() => setOpenGroupKey(g.key)}
              imageUrl={g.imageUrl}
            />
          </Col>
        ))}
      </Row>

      <Drawer
        open={!!openGroupKey}
        title={openGroupKey ?? ''}
        size="large"
        onClose={() => setOpenGroupKey(null)}
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">

          {openGroupFeatured.length > 0 && (
            <>

              <Row gutter={[12, 12]}>
                {openGroupFeatured.map((v) => (
                  <Col xs={24} sm={12} md={8} lg={6} key={`featured:${v.launcherType}:${v.id}`}>
                    <VersionCard
                      version={v.version}
                      selected={
                        selectedVersion?.id === v.id &&
                        selectedVersion?.launcherFlags === v.launcherType
                      }
                      onClick={() => {
                        onSelect({ versionId: v.id, launcherFlags: v.launcherType });
                        setOpenGroupKey(null);
                      }}
                      imageUrl={v.imageUrl}
                      launcherType={v.launcherType}
                    />
                  </Col>
                ))}
              </Row>
            </>
          )}

          <Typography.Title level={5} style={{ margin: 0 }}>
            All versions
          </Typography.Title>
          <Collapse items={collapseItems} defaultActiveKey={[]} />
        </Space>
      </Drawer>

    </Space>
  );
};

export default VersionBrowser;
