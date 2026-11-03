import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DeleteOutlined,
  DownloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Col,
  Empty,
  Flex,
  Input,
  Pagination,
  Row,
  Skeleton,
  Tabs,
  Tag,
  theme,
} from 'antd';
import type {
  MinecraftServerDetail,
  MinecraftServerPlugin,
  MinecraftServerPluginSearchPage,
} from '../../../common/minecraftServers';
import useAppApi from '../../hooks/useAppApi';
import { MinecraftContentCard } from '../mcLauncher/tabs/ModCard';
import { MINECRAFT_PROJECT_TAB } from 'renderer/components/other/botSideBar/panelTabs';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';

interface ServerPluginsProps {
  server: MinecraftServerDetail;
  restarting: boolean;
  onRestart: () => Promise<void>;
}

const PAGE_SIZE = 20;

const ServerPlugins = ({
  server,
  restarting,
  onRestart,
}: ServerPluginsProps) => {
  const { message, modal } = useAppApi();
  const { token } = theme.useToken();
  const { setPanel } = usePanelContext();
  const [view, setView] = useState<'installed' | 'discover'>('installed');
  const [plugins, setPlugins] = useState<MinecraftServerPlugin[]>([]);
  const [page, setPage] = useState<MinecraftServerPluginSearchPage>();
  const [installedQuery, setInstalledQuery] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string>();

  const loadInstalled = useCallback(async () => {
    setLoading(true);
    try {
      setPlugins(
        await window.ipcRenderer.get('MC_SERVER_PLUGINS_LIST', {
          id: server.id,
        }),
      );
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [message, server.id]);

  const search = useCallback(async () => {
    setSearching(true);
    try {
      setPage(
        await window.ipcRenderer.get('MC_SERVER_PLUGINS_SEARCH', {
          id: server.id,
          query,
          offset,
          limit: PAGE_SIZE,
        }),
      );
    } catch (error) {
      message.error(errorText(error));
      setPage(undefined);
    } finally {
      setSearching(false);
    }
  }, [message, offset, query, server.id]);

  useEffect(() => {
    void loadInstalled();
    const dispose = window.ipcRenderer.on(
      'MC_SERVER_PLUGINS_UPDATE',
      ({
        id,
        plugins: next,
      }: {
        id: string;
        plugins: MinecraftServerPlugin[];
      }) => {
        if (id === server.id) setPlugins(next);
      },
    );
    return () => dispose?.();
  }, [loadInstalled, server.id]);

  useEffect(() => {
    if (view !== 'discover') return;
    const timer = window.setTimeout(() => void search(), 300);
    return () => window.clearTimeout(timer);
  }, [search, view]);

  const install = useCallback(
    async (projectId: string, versionId?: string) => {
      setBusy(projectId);
      try {
        const next = await window.ipcRenderer.get('MC_SERVER_PLUGIN_INSTALL', {
          id: server.id,
          projectId,
          versionId,
        });
        setPlugins(next);
        message.success(
          server.state === 'online'
            ? 'Plugin prepared. Restart the server to apply it.'
            : 'Plugin installed',
        );
      } catch (error) {
        message.error(errorText(error));
        throw error;
      } finally {
        setBusy(undefined);
      }
    },
    [message, server.id, server.state],
  );

  const remove = useCallback(
    (plugin: MinecraftServerPlugin) => {
      modal.confirm({
        title: `Uninstall ${plugin.name}?`,
        content:
          server.state === 'online'
            ? 'The plugin will remain active until the server is restarted.'
            : 'JNbot will remove this plugin and unused managed dependencies.',
        okText: 'Uninstall',
        okButtonProps: { danger: true },
        onOk: async () => {
          setBusy(plugin.projectId);
          try {
            setPlugins(
              await window.ipcRenderer.get('MC_SERVER_PLUGIN_REMOVE', {
                id: server.id,
                projectId: plugin.projectId,
              }),
            );
            message.success(
              server.state === 'online'
                ? 'Plugin scheduled for removal'
                : 'Plugin uninstalled',
            );
          } catch (error) {
            message.error(errorText(error));
            throw error;
          } finally {
            setBusy(undefined);
          }
        },
      });
    },
    [message, modal, server.id, server.state],
  );

  const roots = useMemo(
    () => plugins.filter((plugin) => !plugin.dependency),
    [plugins],
  );
  const filteredRoots = useMemo(() => {
    const normalized = installedQuery.trim().toLocaleLowerCase();
    if (!normalized) return roots;
    return roots.filter(
      (plugin) =>
        plugin.name.toLocaleLowerCase().includes(normalized) ||
        plugin.description?.toLocaleLowerCase().includes(normalized) ||
        plugin.versionNumber.toLocaleLowerCase().includes(normalized),
    );
  }, [installedQuery, roots]);
  const installedIds = useMemo(
    () =>
      new Set(
        plugins
          .filter((plugin) => plugin.pendingChange !== 'remove')
          .map((plugin) => plugin.projectId),
      ),
    [plugins],
  );

  const openProject = useCallback(
    (projectId: string, title: string) => {
      const installed = roots.find((plugin) => plugin.projectId === projectId);
      setPanel({
        active: true,
        tab: MINECRAFT_PROJECT_TAB,
        data: {
          kind: 'server-plugin',
          title,
          serverId: server.id,
          projectId,
          installedVersionId: installed?.versionId,
          onInstall: (versionId?: string) => install(projectId, versionId),
        },
      });
    },
    [install, roots, server.id, setPanel],
  );

  const installedContent = loading ? (
    <Skeleton active paragraph={{ rows: 8 }} />
  ) : roots.length === 0 ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="No server plugins installed"
    >
      <Button type="primary" onClick={() => setView('discover')}>
        Discover plugins
      </Button>
    </Empty>
  ) : (
    <Flex vertical gap="middle">
      <Input
        allowClear
        size="large"
        prefix={<SearchOutlined />}
        value={installedQuery}
        placeholder="Search installed plugins"
        onChange={(event) => setInstalledQuery(event.target.value)}
      />
      {filteredRoots.length ? (
        <Row gutter={[token.marginMD, token.marginMD]}>
          {filteredRoots.map((plugin) => (
            <Col xs={24} md={12} xl={8} key={plugin.projectId}>
              <MinecraftContentCard
                title={plugin.name}
                description={plugin.description}
                iconUrl={plugin.iconUrl}
                category="Server plugin"
                metadata={`Version ${plugin.versionNumber}`}
                status={
                  plugin.pendingChange ? (
                    <Tag color="processing">Pending {plugin.pendingChange}</Tag>
                  ) : undefined
                }
                actionLabel={plugin.updateVersionId ? 'Update' : 'Uninstall'}
                actionIcon={
                  plugin.updateVersionId ? <SyncOutlined /> : <DeleteOutlined />
                }
                actionPrimary={Boolean(plugin.updateVersionId)}
                actionDanger={!plugin.updateVersionId}
                actionLoading={busy === plugin.projectId}
                actionDisabled={plugin.pendingChange === 'remove'}
                onAction={() =>
                  plugin.updateVersionId
                    ? install(plugin.projectId, plugin.updateVersionId)
                    : remove(plugin)
                }
                onClick={() => openProject(plugin.projectId, plugin.name)}
              />
            </Col>
          ))}
        </Row>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`No installed plugins match “${installedQuery}”`}
        />
      )}
    </Flex>
  );

  const discoverContent = (
    <Flex vertical gap="middle">
      <Input
        allowClear
        size="large"
        prefix={<SearchOutlined />}
        value={query}
        placeholder="Search server-compatible Fabric plugins"
        onChange={(event) => {
          setQuery(event.target.value);
          setOffset(0);
        }}
      />
      {searching ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : page?.hits.length ? (
        <>
          <Row gutter={[token.marginMD, token.marginMD]}>
            {page.hits.map((hit) => {
              const installed = installedIds.has(hit.projectId);
              return (
                <Col xs={24} md={12} xl={8} key={hit.projectId}>
                  <MinecraftContentCard
                    title={hit.name}
                    description={hit.description}
                    iconUrl={hit.iconUrl}
                    category="Server plugin"
                    metadata={`${hit.author} · ${hit.downloads.toLocaleString()} downloads`}
                    status={
                      installed ? (
                        <Tag color="success">Installed</Tag>
                      ) : undefined
                    }
                    actionLabel={installed ? undefined : 'Install'}
                    actionIcon={<DownloadOutlined />}
                    actionPrimary
                    actionLoading={busy === hit.projectId}
                    onAction={() => install(hit.projectId)}
                    onClick={() => openProject(hit.projectId, hit.name)}
                  />
                </Col>
              );
            })}
          </Row>
          <Pagination
            current={Math.floor(page.offset / page.limit) + 1}
            pageSize={page.limit}
            total={page.total}
            showSizeChanger={false}
            onChange={(next) => setOffset((next - 1) * page.limit)}
          />
        </>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No compatible server plugins found"
        />
      )}
    </Flex>
  );

  return (
    <Flex vertical gap="middle">
      {server.restartRequired && (
        <Alert
          showIcon
          type="warning"
          title="Plugin changes need a restart"
          description="All pending installs, updates, and removals will be applied together."
          action={
            <Button
              icon={<SyncOutlined />}
              loading={restarting}
              onClick={() => void onRestart()}
            >
              Restart now
            </Button>
          }
        />
      )}
      <Tabs
        activeKey={view}
        onChange={(next) => setView(next as 'installed' | 'discover')}
        items={[
          {
            key: 'installed',
            label: `Installed (${roots.length})`,
            children: installedContent,
          },
          {
            key: 'discover',
            label: 'Discover',
            children: discoverContent,
          },
        ]}
      />
    </Flex>
  );
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default ServerPlugins;
