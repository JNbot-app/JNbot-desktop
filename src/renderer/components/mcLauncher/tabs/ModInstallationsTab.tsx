import React, { useMemo, useCallback } from 'react';
import {
  Card,
  Space,
  Typography,
  Empty,
  Spin,
  Row,
  Col,
  Divider,
  theme as antTheme,
} from 'antd';
import { FolderOutlined, TagOutlined } from '@ant-design/icons';
import { ModInfo, ModpackInfo } from '../../../../main/src/types';
import ModCard from './ModCard';
import { SearchProjectOptions } from '@xmcl/modrinth';
import ModSearch from './ModSearch';
import { useModsManager } from '../../../hooks/useModsManager';
import { MinecraftLauncherTypes } from '../../../../common/CommonEnums';
import { usePanelContext } from '../../other/botSideBar/SidePanelContextProvider';
import { MINECRAFT_PROJECT_TAB } from 'renderer/components/other/botSideBar/panelTabs';

const { Title } = Typography;

interface InstallationsTabProps {
  canManageMods: boolean;
  mcVersion: string;
  loader: MinecraftLauncherTypes;
}

const InstallationsTab: React.FC<InstallationsTabProps> = ({
  canManageMods,
  mcVersion,
  loader,
}) => {
  const {
    mods,
    modsLoading,
    handleAddMods,
    handleRemoveMod,
    featuredMods,
    getFeaturedMods,
    activeMods,
  } = useModsManager({
    selectedVersionId: mcVersion,
    selectedLoader: loader,
  });

  const { token } = antTheme.useToken();
  const { setPanel } = usePanelContext();

  React.useEffect(() => {
    if (
      mcVersion &&
      featuredMods.mods.length === 0 &&
      featuredMods.modpacks.length === 0
    ) {
      getFeaturedMods();
    }
  }, [
    mcVersion,
    featuredMods.mods.length,
    featuredMods.modpacks.length,
    getFeaturedMods,
  ]);

  const activeModsSet = useMemo(
    () => new Set(activeMods.activeMods),
    [activeMods.activeMods],
  );
  const activeModPacksSet = useMemo(
    () => new Set(activeMods.activeModPacks),
    [activeMods.activeModPacks],
  );

  const allFeaturedMods = useMemo(() => {
    return [...featuredMods.mods, ...featuredMods.modpacks];
  }, [featuredMods]);

  const isModActive = useCallback(
    (modId: string, type: 'mod' | 'modpack') => {
      if (type === 'modpack') {
        if (activeModPacksSet.has(modId)) return true;
        return mods.modpacks.some(
          (m) =>
            (m.projectId === modId || m.id === modId) &&
            activeModPacksSet.has(m.id),
        );
      }
      if (activeModsSet.has(modId)) return true;
      return mods.mods.some(
        (m) =>
          (m.projectId === modId || m.id === modId) &&
          activeModsSet.has(m.id),
      );
    },
    [activeModsSet, activeModPacksSet, mods.mods, mods.modpacks],
  );

  const handleModClick = useCallback(
    (modInfo: ModInfo | ModpackInfo, type: 'mod' | 'modpack') => {
      setPanel({
        active: true,
        tab: MINECRAFT_PROJECT_TAB,
        data: {
          kind: 'launcher',
          title: modInfo.name,
          modInfo,
          type,
          isActive: isModActive(modInfo.id, type),
          canManage: canManageMods,
          onAdd: () => handleAddMods(modInfo.id, type, false),
          onRemove: () => handleRemoveMod(modInfo.id, type, false),
        },
      });
    },
    [canManageMods, handleAddMods, handleRemoveMod, isModActive, setPanel],
  );

  const queryMods = useCallback(async (searchTerm: SearchProjectOptions) => {
    return await window.ipcRenderer.get('SEARCH_MINECRAFT_MODS', searchTerm);
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        {/* Installed Mods Section */}
        <div>
          <Title level={4} style={{ marginBottom: 16 }}>
            <FolderOutlined /> Active Mods & Modpacks
          </Title>
          {modsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
            </div>
          ) : activeMods.activeMods.length === 0 &&
            activeMods.activeModPacks.length === 0 ? (
            <Card
              style={{
                backgroundColor: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Empty
                description="No active mods"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Card>
          ) : (
            <Row gutter={[16, 16]}>
              {mods.mods
                .filter((mod) => isModActive(mod.id, 'mod'))
                .map((mod) => (
                  <Col xs={24} sm={12} lg={8} xl={6} key={mod.id}>
                    <ModCard
                      modInfo={mod}
                      type="mod"
                      isActive={true}
                      onAdd={(modId, type) => handleAddMods(modId, type, false)}
                      onRemove={(modId, type) =>
                        handleRemoveMod(modId, type, false)
                      }
                      onClick={() => handleModClick(mod, 'mod')}
                      canManage={canManageMods}
                    />
                  </Col>
                ))}
              {mods.modpacks
                .filter((modpack) => isModActive(modpack.id, 'modpack'))
                .map((modpack) => (
                  <Col xs={24} sm={12} lg={8} xl={6} key={modpack.id}>
                    <ModCard
                      modInfo={modpack}
                      type="modpack"
                      isActive={true}
                      onAdd={(modId, type) => handleAddMods(modId, type, false)}
                      onRemove={(modId, type) =>
                        handleRemoveMod(modId, type, false)
                      }
                      onClick={() => handleModClick(modpack, 'modpack')}
                      canManage={canManageMods}
                    />
                  </Col>
                ))}
            </Row>
          )}
        </div>

        <Divider />

        {/* Featured Mods Section */}
        <div>
          <Title level={4} style={{ marginBottom: 16 }}>
            <TagOutlined /> Featured Mods & Modpacks
          </Title>
          {modsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
            </div>
          ) : allFeaturedMods.length === 0 ? (
            <Card
              style={{
                backgroundColor: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Empty
                description="No featured mods available"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Card>
          ) : (
            <Row gutter={[16, 16]}>
              {featuredMods.mods.map((mod) => (
                <Col xs={24} sm={12} lg={8} xl={6} key={mod.id}>
                  <ModCard
                    modInfo={mod}
                    type="mod"
                    isActive={isModActive(mod.id, 'mod')}
                    onAdd={(modId, type) => handleAddMods(modId, type, false)}
                    onRemove={(modId, type) =>
                      handleRemoveMod(modId, type, false)
                    }
                    onClick={() => handleModClick(mod, 'mod')}
                    canManage={canManageMods}
                  />
                </Col>
              ))}
              {featuredMods.modpacks.map((modpack) => (
                <Col xs={24} sm={12} lg={8} xl={6} key={modpack.id}>
                  <ModCard
                    modInfo={modpack}
                    type="modpack"
                    isActive={isModActive(modpack.id, 'modpack')}
                    onAdd={(modId, type) => handleAddMods(modId, type, false)}
                    onRemove={(modId, type) =>
                      handleRemoveMod(modId, type, false)
                    }
                    onClick={() => handleModClick(modpack, 'modpack')}
                    canManage={canManageMods}
                  />
                </Col>
              ))}
            </Row>
          )}
        </div>
      </Space>

      <Divider />

      {/* Search Mods Section */}
      <ModSearch
        onAddMod={(modId, type) => handleAddMods(modId, type, true)}
        onRemoveMod={(modId, type) => handleRemoveMod(modId, type, true)}
        canManageMods={canManageMods}
        activeMods={activeMods}
        isModActive={isModActive}
        mcVersion={mcVersion}
        queryMods={queryMods}
      />
    </div>
  );
};

export default InstallationsTab;
