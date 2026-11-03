import type { MinecraftProjectPanelData } from 'renderer/components/other/botSideBar/panelTabs';
import { useEffect, useMemo, useState } from 'react';
import {
  BookOutlined,
  BugOutlined,
  DeleteOutlined,
  DownloadOutlined,
  GithubOutlined,
  GlobalOutlined,
  HeartOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Avatar,
  Button,
  Divider,
  Empty,
  Flex,
  Image,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import type { Project } from '@xmcl/modrinth';
import ReactMarkdown from 'react-markdown';
import type {
  MinecraftServerPluginProject,
  MinecraftServerPluginVersion,
} from '../../../../common/minecraftServers';
import useAppApi from '../../../hooks/useAppApi';

const MinecraftProjectPanel = ({
  data,
}: {
  data: MinecraftProjectPanelData;
}) => {
  const { message } = useAppApi();
  const { token } = theme.useToken();
  const [project, setProject] = useState<
    Project | MinecraftServerPluginProject
  >();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [active, setActive] = useState(
    data.kind === 'launcher' ? data.isActive : Boolean(data.installedVersionId),
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string>();

  useEffect(() => {
    setActive(
      data.kind === 'launcher'
        ? data.isActive
        : Boolean(data.installedVersionId),
    );
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const request =
      data.kind === 'launcher'
        ? window.ipcRenderer.get('GET_MOD_PROJECT', data.modInfo.projectId)
        : window.ipcRenderer.get('MC_SERVER_PLUGIN_PROJECT', {
            id: data.serverId,
            projectId: data.projectId,
          });

    void request
      .then((next: Project | MinecraftServerPluginProject) => {
        if (cancelled) return;
        setProject(next);
        if ('versions' in next && Array.isArray(next.versions)) {
          const versions = next.versions as MinecraftServerPluginVersion[];
          setSelectedVersionId(
            data.kind === 'server-plugin' && data.installedVersionId
              ? data.installedVersionId
              : versions.find((version) => version.versionType === 'release')
                  ?.id ?? versions[0]?.id,
          );
        }
      })
      .catch((error) => {
        if (!cancelled) message.error(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, message]);

  const view = useMemo(() => normalizeProject(project), [project]);
  const selectedVersion =
    data.kind === 'server-plugin' && project && 'versions' in project
      ? (project.versions as MinecraftServerPluginVersion[]).find(
          (version) => version.id === selectedVersionId,
        )
      : undefined;

  const runLauncherAction = async () => {
    if (data.kind !== 'launcher') return;
    setActionLoading(true);
    try {
      if (active) await data.onRemove();
      else await data.onAdd();
      setActive((current) => !current);
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setActionLoading(false);
    }
  };

  const installPlugin = async () => {
    if (data.kind !== 'server-plugin') return;
    setActionLoading(true);
    try {
      await data.onInstall(selectedVersionId);
      setActive(true);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <Skeleton active avatar paragraph={{ rows: 12 }} />;
  if (!view) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Project details could not be loaded"
      />
    );
  }

  const requiredDependencies =
    selectedVersion?.dependencies.filter(
      (dependency) => dependency.type === 'required',
    ).length ?? 0;

  return (
    <Flex vertical gap="middle">
      {view.featuredImage && (
        <Image
          preview={false}
          src={view.featuredImage}
          alt=""
          height={180}
          style={{
            width: '100%',
            objectFit: 'cover',
            borderRadius: token.borderRadiusLG,
          }}
        />
      )}

      <Flex align="center" gap="middle">
        <Avatar
          shape="square"
          size={64}
          src={view.iconUrl}
          style={{ background: token.colorFillSecondary }}
        >
          {view.title.slice(0, 1)}
        </Avatar>
        <Flex vertical gap="small" style={{ minWidth: 0 }}>
          <Typography.Title level={4} ellipsis style={{ margin: 0 }}>
            {view.title}
          </Typography.Title>
          <Space wrap size="small">
            <Tag>{view.typeLabel}</Tag>
            {active && <Tag color="success">Installed</Tag>}
          </Space>
        </Flex>
      </Flex>

      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        {view.description}
      </Typography.Paragraph>

      <Flex gap="large" wrap>
        {typeof view.downloads === 'number' && (
          <Space size="small">
            <DownloadOutlined style={{ color: token.colorPrimary }} />
            <Typography.Text>
              {view.downloads.toLocaleString()} downloads
            </Typography.Text>
          </Space>
        )}
        {typeof view.followers === 'number' && (
          <Space size="small">
            <HeartOutlined style={{ color: token.colorError }} />
            <Typography.Text>
              {view.followers.toLocaleString()} followers
            </Typography.Text>
          </Space>
        )}
      </Flex>

      {data.kind === 'server-plugin' && project && 'versions' in project && (
        <Flex vertical gap="small">
          <Typography.Text strong>Version</Typography.Text>
          <Select
            value={selectedVersionId}
            onChange={setSelectedVersionId}
            options={(project.versions as MinecraftServerPluginVersion[]).map(
              (version) => ({
                value: version.id,
                label: `${version.versionNumber} · ${version.versionType}`,
              }),
            )}
          />
          {requiredDependencies > 0 && (
            <Alert
              type="info"
              showIcon
              title={`${requiredDependencies} required ${
                requiredDependencies === 1 ? 'dependency' : 'dependencies'
              } will be managed automatically`}
            />
          )}
        </Flex>
      )}

      {(view.categories.length > 0 || view.versions.length > 0) && (
        <Space wrap size="small">
          {view.categories.map((category) => (
            <Tag key={category} variant="filled">
              {category}
            </Tag>
          ))}
          {view.versions.slice(0, 6).map((version) => (
            <Tag key={version}>{version}</Tag>
          ))}
          {view.versions.length > 6 && (
            <Typography.Text type="secondary">
              +{view.versions.length - 6} versions
            </Typography.Text>
          )}
        </Space>
      )}

      {view.links.length > 0 && (
        <Space wrap>
          {view.links.map((link) => (
            <Button
              key={link.url}
              type="text"
              size="small"
              icon={link.icon}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
            </Button>
          ))}
        </Space>
      )}

      <Divider style={{ margin: `${token.marginXS}px 0` }} />

      {view.body ? (
        <div style={{ overflowWrap: 'anywhere' }}>
          <ReactMarkdown>{view.body}</ReactMarkdown>
        </div>
      ) : (
        <Typography.Text type="secondary">
          This project has no extended description.
        </Typography.Text>
      )}

      {view.gallery.length > 0 && (
        <Image.PreviewGroup>
          <Flex wrap gap="small">
            {view.gallery.map((image) => (
              <Image
                key={image}
                src={image}
                width="calc(50% - 4px)"
                height={100}
                style={{
                  objectFit: 'cover',
                  borderRadius: token.borderRadius,
                }}
              />
            ))}
          </Flex>
        </Image.PreviewGroup>
      )}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: `${token.paddingSM}px 0`,
          background: token.colorBgContainer,
        }}
      >
        {data.kind === 'launcher' && data.canManage && (
          <Button
            block
            type={active ? 'default' : 'primary'}
            danger={active}
            icon={active ? <DeleteOutlined /> : <PlusOutlined />}
            loading={actionLoading}
            onClick={() => void runLauncherAction()}
          >
            {active
              ? `Deactivate ${data.type}`
              : `Install ${data.type === 'modpack' ? 'modpack' : 'mod'}`}
          </Button>
        )}
        {data.kind === 'server-plugin' && (
          <Button
            block
            type="primary"
            icon={<DownloadOutlined />}
            loading={actionLoading}
            disabled={
              !selectedVersionId ||
              (active && data.installedVersionId === selectedVersionId)
            }
            onClick={() => void installPlugin()}
          >
            {active ? 'Update version' : 'Install plugin'}
          </Button>
        )}
      </div>
    </Flex>
  );
};

const normalizeProject = (project?: Project | MinecraftServerPluginProject) => {
  if (!project) return undefined;
  if ('projectId' in project) {
    return {
      title: project.name,
      description: project.description,
      body: project.body,
      iconUrl: project.iconUrl,
      typeLabel: 'Server plugin',
      downloads: project.downloads,
      followers: undefined,
      categories: [] as string[],
      versions: project.versions.map((version) => version.versionNumber),
      featuredImage: undefined,
      gallery: [] as string[],
      links: [] as Array<{ url: string; label: string; icon: JSX.Element }>,
    };
  }

  const links = [
    project.source_url
      ? {
          url: project.source_url,
          label: 'Source',
          icon: <GithubOutlined />,
        }
      : undefined,
    project.issues_url
      ? { url: project.issues_url, label: 'Issues', icon: <BugOutlined /> }
      : undefined,
    project.wiki_url
      ? { url: project.wiki_url, label: 'Wiki', icon: <BookOutlined /> }
      : undefined,
    project.discord_url
      ? {
          url: project.discord_url,
          label: 'Discord',
          icon: <GlobalOutlined />,
        }
      : undefined,
  ].filter(
    (
      link,
    ): link is {
      url: string;
      label: string;
      icon: JSX.Element;
    } => Boolean(link),
  );

  return {
    title: project.title,
    description: project.description,
    body: project.body,
    iconUrl: project.icon_url,
    typeLabel: project.project_type,
    downloads: project.downloads,
    followers: project.followers,
    categories: [...project.categories, ...project.loaders],
    versions: project.game_versions,
    featuredImage: project.gallery?.find((item) => item.featured)?.url,
    gallery: project.gallery?.map((item) => item.url) ?? [],
    links,
  };
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default MinecraftProjectPanel;
