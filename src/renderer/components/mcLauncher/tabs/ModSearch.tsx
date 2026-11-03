import React, { useState, useCallback, useEffect } from 'react';
import {
  Card,
  Input,
  Space,
  Typography,
  Empty,
  Spin,
  Row,
  Col,
  theme as antTheme,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { SearchProjectOptions, SearchResultHit } from '@xmcl/modrinth';
import { ModInfo } from '../../../../main/src/types';
import ModCard from './ModCard';
import { usePanelContext } from '../../other/botSideBar/SidePanelContextProvider';
import { MINECRAFT_PROJECT_TAB } from 'renderer/components/other/botSideBar/panelTabs';

const { Title } = Typography;
const { Search } = Input;

interface ModSearchProps {
  onAddMod: (modId: string, type: 'mod' | 'modpack') => Promise<void>;
  onRemoveMod: (modId: string, type: 'mod' | 'modpack') => Promise<void>;
  canManageMods: boolean;
  activeMods: { activeMods: string[]; activeModPacks: string[] };
  isModActive?: (modId: string, type: 'mod' | 'modpack') => boolean;
  mcVersion: string;
  queryMods: (
    searchTerm: SearchProjectOptions,
  ) => Promise<{ hits: SearchResultHit[] }>;
}

const ModSearch: React.FC<ModSearchProps> = ({
  onAddMod,
  onRemoveMod,
  canManageMods,
  activeMods,
  isModActive: isModActiveProp,
  mcVersion,
  queryMods,
}) => {
  const { token } = antTheme.useToken();
  const { setPanel } = usePanelContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultHit[]>([]);
  const [loading, setLoading] = useState(false);

  const isModActive = useCallback(
    (modId: string, type: 'mod' | 'modpack') => {
      if (isModActiveProp) {
        return isModActiveProp(modId, type);
      }
      const activeSet =
        type === 'modpack'
          ? new Set(activeMods.activeModPacks)
          : new Set(activeMods.activeMods);
      return activeSet.has(modId);
    },
    [activeMods, isModActiveProp],
  );

  const performSearch = useCallback(
    async (query: string) => {
      if (!mcVersion) return;

      setLoading(true);
      try {
        const searchOptions: SearchProjectOptions = {
          query: query || undefined,
          limit: 20,
          index: query ? 'relevance' : 'downloads',
          facets: JSON.stringify([
            ['project_type:mod'],
            [`versions:${mcVersion}`],
          ]),
        };

        const results = await queryMods(searchOptions);
        setSearchResults(results.hits || []);
      } catch (error) {
        console.error('Failed to search mods:', error);
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    },
    [mcVersion, queryMods],
  );

  useEffect(() => {
    performSearch('');
  }, [performSearch]);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchTerm(value);
      performSearch(value);
    },
    [performSearch],
  );

  const convertToModInfo = useCallback(
    (hit: SearchResultHit): ModInfo => {
      return {
        id: hit.project_id,
        projectId: hit.project_id,
        name: hit.title,
        versionNumber: hit.latest_version || 'latest',
        mcVersion: hit.versions?.[0] || mcVersion,
        file: {
          id: '',
          filename: '',
          url: '',
        },
        iconUrl: hit.icon_url,
      };
    },
    [mcVersion],
  );

  const handleModClick = useCallback(
    (hit: SearchResultHit) => {
      const modInfo = convertToModInfo(hit);
      setPanel({
        active: true,
        tab: MINECRAFT_PROJECT_TAB,
        data: {
          kind: 'launcher',
          title: modInfo.name,
          modInfo,
          type: 'mod',
          isActive: isModActive(modInfo.id, 'mod'),
          canManage: canManageMods,
          onAdd: () => onAddMod(modInfo.id, 'mod'),
          onRemove: () => onRemoveMod(modInfo.id, 'mod'),
        },
      });
    },
    [
      canManageMods,
      convertToModInfo,
      isModActive,
      onAddMod,
      onRemoveMod,
      setPanel,
    ],
  );

  return (
    <div>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={4} style={{ marginBottom: 16 }}>
            <SearchOutlined /> Search Mods
          </Title>
          <Search
            placeholder="Search for mods..."
            allowClear
            enterButton="Search"
            size="large"
            onSearch={handleSearch}
            onChange={(e) => !e.target.value && handleSearch('')}
            style={{ marginBottom: 24 }}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : searchResults.length === 0 ? (
          <Card
            style={{
              backgroundColor: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Empty
              description={
                searchTerm
                  ? 'No mods found'
                  : 'Start searching to discover mods'
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {searchResults.map((hit) => {
              const modInfo = convertToModInfo(hit);
              return (
                <Col xs={24} sm={12} lg={8} xl={6} key={hit.project_id}>
                  <ModCard
                    modInfo={modInfo}
                    type="mod"
                    isActive={isModActive(hit.project_id, 'mod')}
                    onAdd={onAddMod}
                    onRemove={onRemoveMod}
                    onClick={() => handleModClick(hit)}
                    canManage={canManageMods}
                  />
                </Col>
              );
            })}
          </Row>
        )}
      </Space>
    </div>
  );
};

export default ModSearch;
