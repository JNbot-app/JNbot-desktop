import type { MenuProps } from 'antd';
import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  AppstoreAddOutlined,
  CheckCircleFilled,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  GlobalOutlined,
  LinkOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  useSettingsStore,
  deleteCustomProfile,
  selectAppSettings,
  selectCustomProfiles,
  selectInstalledServers,
  selectJNdata,
  switchServer,
  upsertCustomProfile,
} from '../../redux/settings';
import {
  CustomProfile,
  generateProfileId,
  profileFromJNdata,
} from '../../../common/profiles';
import { getAllServerMeta, ServerMeta } from '../../../common/serverInfo';
import { withAlpha } from '../intro/introUtils';
import ServerMarketplace from '../marketplace/ServerMarketplace';
import { useServerInstall } from '../marketplace/useServerInstall';
import useAppApi from '../../hooks/useAppApi';
import promptPublisherName from '../share/promptPublisherName';
import ImportButton from '../share/ImportButton';
import { openShareModal, useOpenShareLink } from '../share/useShareTarget';
import { initShares, useShareUpdate } from '../../redux/shares';
import type { ProfileRuntimeSummary } from '../../../common/profileRuntime';
import useProfileRuntimeSummaries from '../../hooks/useProfileRuntimeSummaries';

const { Title, Text } = Typography;

interface SyncedCopyValues {
  name: string;
}

type ProfileKind = 'marketplace' | 'custom' | 'synced';

const KIND_LABEL: Record<ProfileKind, string> = {
  marketplace: 'Marketplace',
  custom: 'Custom',
  synced: 'Synced copy',
};

interface ProfileRowProps {
  meta: ServerMeta;
  kind: ProfileKind;
  featured?: boolean;
  runtime?: ProfileRuntimeSummary;
  onSelect: () => void;
  onEdit?: () => void;
  onClone?: () => void;
  onSyncClone?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
}

const ProfileRow: React.FC<ProfileRowProps> = ({
  meta,
  kind,
  featured,
  runtime,
  onSelect,
  onEdit,
  onClone,
  onSyncClone,
  onDelete,
  onExport,
}) => {
  const { token } = theme.useToken();
  const installedShare = useShareUpdate('profile', meta.id);
  const openShareLink = useOpenShareLink();
  const scriptCount = runtime?.scripts ?? 0;
  const botCount = runtime?.bots ?? 0;
  const accent = meta.color || token.colorPrimary;

  const running = [
    scriptCount > 0 &&
      `${scriptCount} ${scriptCount === 1 ? 'script' : 'scripts'}`,
    botCount > 0 && `${botCount} ${botCount === 1 ? 'bot' : 'bots'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const remove = {
    key: 'delete',
    label: kind === 'marketplace' ? 'Uninstall' : 'Delete',
    icon: <DeleteOutlined />,
    danger: true,
    onClick: onDelete,
  };
  const divider = { type: 'divider' as const };
  const menuItems: MenuProps['items'] =
    kind === 'marketplace'
      ? [
          {
            key: 'synced',
            label: 'Create synced copy',
            icon: <SyncOutlined />,
            onClick: onSyncClone,
          },
          {
            key: 'editable',
            label: 'Create editable copy',
            icon: <CopyOutlined />,
            onClick: onClone,
          },
          divider,
          remove,
        ]
      : kind === 'synced'
        ? [
            {
              key: 'clone',
              label: 'Create editable copy',
              icon: <CopyOutlined />,
              onClick: onClone,
            },
            divider,
            remove,
          ]
        : [
            {
              key: 'edit',
              label: 'Edit',
              icon: <EditOutlined />,
              onClick: onEdit,
            },
            {
              key: 'clone',
              label: 'Duplicate',
              icon: <CopyOutlined />,
              onClick: onClone,
            },
            {
              key: 'export',
              label: 'Export',
              icon: <DownloadOutlined />,
              onClick: onExport,
            },
            {
              key: 'share',
              label: 'Share',
              icon: <LinkOutlined />,
              onClick: () =>
                openShareModal({
                  kind: 'profile',
                  ref: meta.id,
                  title: meta.name,
                }),
            },
            ...(installedShare
              ? [
                  {
                    key: 'share-update',
                    label: `Update from ${installedShare.ownerName}`,
                    icon: <SyncOutlined />,
                    onClick: () => openShareLink(installedShare.id),
                  },
                ]
              : []),
            divider,
            remove,
          ];

  return (
    <Flex
      align="center"
      gap={token.marginSM}
      role="button"
      tabIndex={featured ? -1 : 0}
      onClick={featured ? undefined : onSelect}
      onKeyDown={(e) => {
        if (!featured && e.key === 'Enter') onSelect();
      }}
      style={{
        padding: featured
          ? token.paddingMD
          : `${token.paddingSM}px ${token.padding}px`,
        borderRadius: token.borderRadiusLG,
        cursor: featured ? 'default' : 'pointer',
        background: featured
          ? withAlpha(accent, 0.1)
          : token.colorFillQuaternary,
        border: `1px solid ${featured ? withAlpha(accent, 0.45) : token.colorBorderSecondary}`,
      }}
    >
      <Avatar
        src={meta.icon || undefined}
        shape="square"
        size={featured ? 52 : 40}
        icon={!meta.icon ? <GlobalOutlined /> : undefined}
        style={{
          flexShrink: 0,
          background: meta.color
            ? withAlpha(meta.color, 0.25)
            : token.colorFillSecondary,
          color: meta.color || token.colorText,
          border: `1px solid ${meta.color ? withAlpha(meta.color, 0.4) : token.colorBorderSecondary}`,
        }}
      />

      <div style={{ minWidth: 0, flex: 1 }}>
        <Flex align="center" gap={token.marginXS} wrap="wrap">
          <Text
            strong
            ellipsis={{ tooltip: meta.name }}
            style={{
              fontSize: featured ? token.fontSizeLG : token.fontSize,
              maxWidth: '100%',
            }}
          >
            {meta.name}
          </Text>
          {featured && (
            <Tag
              color="success"
              icon={<CheckCircleFilled />}
              variant="filled"
              style={{ margin: 0 }}
            >
              Active
            </Tag>
          )}
          <Tag variant="filled" style={{ margin: 0 }}>
            {KIND_LABEL[kind]}
          </Tag>
        </Flex>
        <Text
          type="secondary"
          ellipsis
          style={{ display: 'block', fontSize: token.fontSizeSM }}
        >
          {meta.defaultIp
            ? `${meta.defaultIp}:${meta.defaultPort}`
            : 'No address set'}{' '}
          · {(meta.gamemodes ?? []).length} gamemodes
        </Text>
        {running && (
          <Badge
            status="processing"
            color={token.colorSuccess}
            text={
              <Text style={{ fontSize: token.fontSizeSM }}>
                Running {running}
              </Text>
            }
          />
        )}
      </div>

      <Dropdown
        menu={{ items: menuItems }}
        trigger={['click']}
        placement="bottomRight"
      >
        <Button
          type="text"
          aria-label={`More actions for ${meta.name}`}
          icon={<EllipsisOutlined />}
          onClick={(e) => e.stopPropagation()}
        />
      </Dropdown>
    </Flex>
  );
};

interface ProfilesTabProps {
  onNavigate?: () => void;
}

const ProfilesTab: React.FC<ProfilesTabProps> = ({ onNavigate }) => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const jndata = useSettingsStore(selectJNdata);
  const appSettings = useSettingsStore(selectAppSettings);
  const customProfiles = useSettingsStore(selectCustomProfiles);
  const installedServers = useSettingsStore(selectInstalledServers);
  const appApi = useAppApi();
  const { uninstall } = useServerInstall();
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [syncSourceId, setSyncSourceId] = useState<string | null>(null);
  const [syncForm] = Form.useForm<SyncedCopyValues>();
  const runtimeSummaries = useProfileRuntimeSummaries();
  useEffect(initShares, []);

  const allMeta = getAllServerMeta(jndata);
  const activeId = appSettings.server;
  // Official profiles come from the marketplace and are read-only.
  const installedMarketplace = installedServers.filter((m) => !m.custom);
  const editableProfiles = customProfiles.filter((p) => !p.share?.official);

  const handleClone = (sourceId: string) => {
    onNavigate?.();
    navigate(`/profiles/${sourceId}/edit?action=clone`);
  };

  const openSyncedCopy = (sourceId: string) => {
    const source = allMeta.find((meta) => meta.id === sourceId);
    syncForm.setFieldsValue({
      name: `${source?.name ?? sourceId} (synced)`,
    });
    setSyncSourceId(sourceId);
  };

  const createSyncedCopy = async () => {
    if (!syncSourceId) return;
    const values = await syncForm.validateFields();
    const id = generateProfileId([
      ...allMeta.map((meta) => meta.id),
      ...customProfiles.map((profile) => profile.id),
    ]);
    const profile = profileFromJNdata(jndata, syncSourceId, id, values.name);
    upsertCustomProfile({ ...profile, sourceProfileId: syncSourceId });
    setSyncSourceId(null);
    appApi.message.success('Synced copy created');
  };

  const handleDelete = (profile: CustomProfile) => {
    appApi.modal.confirm({
      title: `Delete ${profile.data.name || profile.id}?`,
      content:
        'This removes the profile from this device. Per-server settings, ranks tracked on alts, and stats stay where they are.',
      okText: 'Delete',
      okType: 'danger',
      onOk: () => {
        if (profile.id === activeId) {
          const fallback = installedServers.find((m) => m.id !== profile.id);
          if (fallback) switchServer(fallback.id);
        }
        deleteCustomProfile(profile.id);
        appApi.message.success('Profile deleted');
      },
    });
  };

  const handleExport = async (id: string) => {
    const result = await window.ipcRenderer.invoke<{
      ok: boolean;
      error?: string;
      publisherNameRequired?: boolean;
      fingerprint?: string;
    }>('profile-export', id);
    if (result?.publisherNameRequired) {
      const configured = await promptPublisherName(
        appApi,
        result.fingerprint,
        'Save and export',
      );
      if (configured) await handleExport(id);
    } else if (result?.ok) appApi.message.success('Profile exported');
    else if (result?.error) appApi.message.error(result.error);
  };

  const handleImport = async () => {
    const result = await window.ipcRenderer.invoke<{
      ok: boolean;
      error?: string;
      profile?: CustomProfile;
    }>('profile-import');
    if (!result?.ok) {
      if (result?.error) appApi.message.error(result.error);
      return;
    }
    const profile = result.profile as CustomProfile;
    const existing = new Set([
      ...allMeta.map((m) => m.id),
      ...customProfiles.map((p) => p.id),
    ]);
    let { id } = profile;
    if (existing.has(id)) {
      let i = 2;
      while (existing.has(`${profile.id}-${i}`)) i += 1;
      id = `${profile.id}-${i}`;
      appApi.message.info(`Imported as "${id}" to avoid a collision`);
    }

    upsertCustomProfile({
      ...profile,
      id,
      predefined: false,
      data: { ...profile.data, id },
    });

    appApi.message.success('Profile imported');
  };

  const goNew = () => {
    onNavigate?.();
    navigate('/profiles/new');
  };

  const entries = [
    ...installedMarketplace.map((meta) => ({
      meta,
      kind: 'marketplace' as ProfileKind,
      props: {
        onClone: () => handleClone(meta.id),
        onSyncClone: () => openSyncedCopy(meta.id),
        onDelete: () => uninstall(meta),
      },
    })),
    ...editableProfiles.flatMap((profile) => {
      const meta = allMeta.find((m) => m.id === profile.id);
      if (!meta) return [];
      const synced = !!profile.sourceProfileId;
      return [
        {
          meta,
          kind: (synced ? 'synced' : 'custom') as ProfileKind,
          props: {
            onEdit: () => {
              onNavigate?.();
              navigate(`/profiles/${profile.id}/edit`);
            },
            onClone: () => handleClone(profile.id),
            onDelete: () => handleDelete(profile),
            onExport: () => handleExport(profile.id),
          },
        },
      ];
    }),
  ];
  const renderRow = (
    { meta, kind, props }: (typeof entries)[number],
    featured?: boolean,
  ) => (
    <ProfileRow
      key={meta.id}
      meta={meta}
      kind={kind}
      featured={featured}
      runtime={runtimeSummaries[meta.id]}
      onSelect={() => switchServer(meta.id)}
      {...props}
    />
  );
  const active = entries.find((e) => e.meta.id === activeId);
  const others = entries.filter((e) => e !== active);

  return (
    <div style={{ width: '100%' }}>
      <Flex
        justify="space-between"
        align="center"
        gap={token.marginSM}
        wrap="wrap"
        style={{ marginBottom: token.marginLG, paddingRight: token.sizeXL }}
      >
        <div style={{ minWidth: 0 }}>
          <Title level={4} style={{ margin: 0 }}>
            Profiles
          </Title>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Pick the server JNbot runs against. Click a profile to switch.
          </Text>
        </div>
        <Flex gap={token.marginXS} wrap="wrap">
          <Button
            icon={<AppstoreAddOutlined />}
            onClick={() => setMarketplaceOpen(true)}
          >
            Marketplace
          </Button>
          <ImportButton onImportFile={handleImport} />
          <Button type="primary" icon={<PlusOutlined />} onClick={goNew}>
            New profile
          </Button>
        </Flex>
      </Flex>

      {entries.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No profiles yet. Add one from the marketplace or create your own."
        />
      ) : (
        <Flex vertical gap={token.marginLG}>
          {active && renderRow(active, true)}
          {others.length > 0 && (
            <Flex vertical gap={token.marginXS}>
              {active && (
                <Text
                  type="secondary"
                  strong
                  style={{ fontSize: token.fontSizeSM }}
                >
                  Other profiles
                </Text>
              )}
              {others.map((entry) => renderRow(entry))}
            </Flex>
          )}
        </Flex>
      )}

      <ServerMarketplace
        open={marketplaceOpen}
        onClose={() => setMarketplaceOpen(false)}
      />

      <Modal
        title="Create synced copy"
        open={!!syncSourceId}
        okText="Create"
        onOk={createSyncedCopy}
        onCancel={() => setSyncSourceId(null)}
        destroyOnHidden
      >
        <Text type="secondary">
          Scripts and server metadata stay synchronized with the built-in
          profile. The name, generated ID, and per-profile settings remain
          separate.
        </Text>
        <Form<SyncedCopyValues>
          form={syncForm}
          layout="vertical"
          preserve={false}
          style={{ marginTop: token.margin }}
        >
          <Form.Item
            label="Profile name"
            name="name"
            rules={[{ required: true, message: 'Please enter a name' }]}
          >
            <Input maxLength={48} autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProfilesTab;
