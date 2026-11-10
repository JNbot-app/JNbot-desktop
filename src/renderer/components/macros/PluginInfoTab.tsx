import React, { useEffect, useState } from 'react';
import {
  Button,
  Descriptions,
  Dropdown,
  Flex,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  ApiOutlined,
  CaretRightOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  ExportOutlined,
  LinkOutlined,
  StopOutlined,
  PushpinFilled,
  PushpinOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { MacroInfo } from '../../../main/src/types';
import {
  SOURCE_LABELS,
  type ProfileScript,
} from '../../../common/profileScripts';
import {
  useSettingsStore,
  selectIsMacroActive,
  selectMacroById,
  selectSettings,
  updateScriptSettings,
} from '../../redux/settings';
import { usePluginActions, PluginView } from './usePluginActions';
import ScriptSettings from '../general/scriptSettings/ScriptSettings';
import PresetBar from '../general/scriptSettings/presets/PresetBar';
import LlmPrompt, { type LlmPromptProps } from '../llm/LlmPrompt';
import LlmOptionChanges from '../llm/LlmOptionChanges';
import type { LlmOptionsResult } from '../../../common/llm';
import RunningControls from './RunningControls';
import { selectedPresetId } from '../../../common/pluginPresets';
import BannerHero from './BannerHero';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import { openShareModal } from '../share/useShareTarget';
import { useShareUpdateAction } from '../share/useShareUpdateAction';

const iconFor = (p: MacroInfo) =>
  p.scriptType === 'action' ? (
    <ThunderboltOutlined />
  ) : p.language === 'recording' ? (
    <VideoCameraOutlined />
  ) : p.language !== 'components' ? (
    <CodeOutlined />
  ) : (
    <ApiOutlined />
  );

export type PanelData = {
  plugin: MacroInfo;
  view: PluginView;
  /**
   * When set, the panel is showing a *dashboard profile script*: run/save
   * use the profile-script path instead of the plugin-store path, and the
   * delete button is hidden (the script lives on a profile, not a plugin).
   */
  profileScript?: ProfileScript;
};

const getAuthorInfo = (
  plugin: MacroInfo,
  profileScript?: ProfileScript,
) => {
  const author =
    plugin.security?.publisherName ||
    plugin.security?.signature?.publisherName ||
    profileScript?.signature?.publisherName;

  const signature = plugin.security?.signature || profileScript?.signature;
  const signedAt = signature?.signedAt;
  const fingerprint = plugin.security?.fingerprint;
  const securityStatus = plugin.security?.status;
  const importOwner = plugin.security?.importSource?.ownerId;

  return {
    author,
    signature,
    signedAt,
    fingerprint,
    securityStatus,
    importOwner,
  };
};

const Header: React.FC<{
  plugin: MacroInfo;
  running: boolean;
  pinned: boolean;
  profileScript?: ProfileScript;
  onRun: () => Promise<void> | void;
}> = ({ plugin, running, pinned, profileScript, onRun }) => {
  const { token } = theme.useToken();
  const { author } = getAuthorInfo(plugin, profileScript);
  const actionBar = (
    <ActionBar
      plugin={plugin}
      running={running}
      pinned={pinned}
      profileScript={profileScript}
      onRun={onRun}
    />
  );

  if (plugin.banner) {
    return (
      <BannerHero
        src={plugin.banner}
        height={140}
        accent={plugin.theme?.primaryColor}
      >
        <div
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 14,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            color: '#fff',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            {iconFor(plugin)}
          </div>
          <div style={{ flex: '1 1 140px', minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
              }}
            >
              {plugin.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.85)',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
              }}
            >
              {plugin.language === 'js'
                ? 'JavaScript'
                : plugin.language === 'ts'
                  ? 'TypeScript'
                  : plugin.language === 'recording'
                    ? 'Recording'
                    : 'Components'}
              {' · '}
              {plugin.scriptType === 'action' ? 'Action' : 'Script'}
              {author && ` · by ${author}`}
              {running && ' · Running'}
            </div>
          </div>
          {actionBar}
        </div>
      </BannerHero>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          background: running ? token.colorSuccessBg : token.colorFillTertiary,
          color: running ? token.colorSuccess : token.colorTextSecondary,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
        }}
      >
        {iconFor(plugin)}
      </div>
      <div style={{ flex: '1 1 140px', minWidth: 0 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {plugin.name}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {plugin.language === 'js'
            ? 'JavaScript'
            : plugin.language === 'ts'
              ? 'TypeScript'
              : plugin.language === 'recording'
                ? 'Recording'
                : 'Components'}
          {' · '}
          {plugin.scriptType === 'action' ? 'Action' : 'Script'}
          {author && ` · by ${author}`}
        </Typography.Text>
      </div>
      {actionBar}
    </div>
  );
};

/** Compact action bar: Run button + Pin toggle + More dropdown. */
const ActionBar: React.FC<{
  plugin: MacroInfo;
  running: boolean;
  pinned: boolean;
  profileScript?: ProfileScript;
  onRun: () => Promise<void> | void;
}> = ({ plugin, running, pinned, profileScript, onRun }) => {
  const actions = usePluginActions();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const shareUpdate = useShareUpdateAction('plugin', plugin.pluginId);

  const moreMenuItems: NonNullable<
    React.ComponentProps<typeof Dropdown>['menu']
  >['items'] = [];

  if (!profileScript) {
    moreMenuItems.push(
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: 'Edit Code',
        onClick: () => actions.editCode(plugin),
      },
      {
        key: 'duplicate',
        icon: <CopyOutlined />,
        label: 'Duplicate',
        onClick: () => actions.duplicatePlugin(plugin),
      },
      {
        key: 'export',
        icon: <ExportOutlined />,
        label: 'Export',
        onClick: () => actions.exportPlugin(plugin),
      },
      {
        key: 'share',
        icon: <LinkOutlined />,
        label: 'Share',
        onClick: () =>
          openShareModal({ kind: 'plugin', ref: plugin.pluginId, title: plugin.name }),
      },
      ...(shareUpdate
        ? [
            {
              key: 'share-update',
              icon: <SyncOutlined />,
              label: shareUpdate.label,
              onClick: shareUpdate.run,
            },
          ]
        : []),
      {
        key: 'pin',
        icon: pinned ? <PushpinFilled /> : <PushpinOutlined />,
        label: pinned ? 'Unpin' : 'Pin to dashboard',
        onClick: () => actions.togglePin(plugin.pluginId),
      },
      { type: 'divider' },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: 'Delete Plugin',
        danger: true,
        onClick: () => setDeleteConfirm(true),
      },
    );
  }

  return (
    <Popconfirm
      title={`Delete "${plugin.name}"?`}
      description="This will permanently remove the plugin."
      okText="Delete"
      okButtonProps={{ danger: true }}
      cancelText="Cancel"
      placement="bottom"
      open={deleteConfirm}
      onConfirm={() => {
        setDeleteConfirm(false);
        actions.deletePlugin(plugin);
      }}
      onCancel={() => setDeleteConfirm(false)}
    >
      {/* Space.Compact doesn't forward refs, so Popconfirm needs a DOM anchor. */}
      <span>
        <Space.Compact>
          {running ? (
            <RunningControls
              pluginId={plugin.pluginId}
              name={plugin.name}
              stopLabel={plugin.scriptType === 'action' ? 'Stop Action' : 'Stop Plugin'}
              stopIcon={<StopOutlined />}
            />
          ) : (
            <Button type="primary" icon={<CaretRightOutlined />} onClick={() => onRun()}>
              {plugin.scriptType === 'action' ? 'Run Action' : 'Run Plugin'}
            </Button>
          )}
          {moreMenuItems.length > 0 && (
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{ items: moreMenuItems }}
            >
              <Button
                type={running ? 'default' : 'primary'}
                icon={<EllipsisOutlined />}
              />
            </Dropdown>
          )}
        </Space.Compact>
      </span>
    </Popconfirm>
  );
};

const DetailsView: React.FC<{
  plugin: MacroInfo;
  running: boolean;
  profileScript?: ProfileScript;
}> = ({ plugin, running, profileScript }) => {
  const {
    author,
    signedAt,
    fingerprint,
    securityStatus,
    importOwner,
  } = getAuthorInfo(plugin, profileScript);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Descriptions
        size="small"
        column={1}
        bordered
        styles={{
          label: { width: 90, fontSize: 12 },
          content: { fontSize: 12 },
        }}
      >
        {plugin.description && (
          <Descriptions.Item label="About">
            {plugin.description}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Type">
          <Flex wrap gap={4}>
            {running && <Tag color="success">Running</Tag>}
            {plugin.scriptType === 'action' && <Tag color="purple">Action</Tag>}
            {plugin.language === 'js' && <Tag color="gold">JS</Tag>}
            {plugin.language === 'ts' && <Tag color="geekblue">TS</Tag>}
            {plugin.language === 'recording' && <Tag color="cyan">Recording</Tag>}
            {profileScript && (
              <Tag>{SOURCE_LABELS[profileScript.source.kind]}</Tag>
            )}
          </Flex>
        </Descriptions.Item>
        <Descriptions.Item label="Plugin ID">
          {plugin.pluginId}
        </Descriptions.Item>
        {author && (
          <Descriptions.Item label="Author">
            <Space size={6} wrap>
              <span>{author}</span>
              {securityStatus === 'trusted' && (
                <Tag color="success" style={{ marginInlineEnd: 0 }}>
                  Trusted
                </Tag>
              )}
            </Space>
          </Descriptions.Item>
        )}
        {securityStatus && (
          <Descriptions.Item label="Security">
            {securityStatus === 'trusted' ? (
              <Tag color="success">Trusted publisher</Tag>
            ) : securityStatus === 'accepted-once' ? (
              <Tag>Signed (accepted)</Tag>
            ) : securityStatus === 'modified' ? (
              <Tag color="warning">Modified</Tag>
            ) : securityStatus === 'unsigned' ? (
              <Tag color="warning">Unsigned</Tag>
            ) : securityStatus === 'local' ? (
              <Tag>Local</Tag>
            ) : (
              <Tag>{securityStatus}</Tag>
            )}
          </Descriptions.Item>
        )}
        {!securityStatus && profileScript?.signature && (
          <Descriptions.Item label="Security">
            <Tag color="success">Signed</Tag>
          </Descriptions.Item>
        )}
        {signedAt && (
          <Descriptions.Item label="Signed">
            {new Date(signedAt).toLocaleDateString()}
          </Descriptions.Item>
        )}
        {fingerprint && (
          <Descriptions.Item label="Fingerprint">
            <Typography.Text
              copyable={{ text: fingerprint }}
              style={{ fontSize: 11, fontFamily: 'monospace' }}
            >
              {fingerprint.match(/.{1,4}/g)?.join(' ')}
            </Typography.Text>
          </Descriptions.Item>
        )}
        {importOwner && (
          <Descriptions.Item label="Owner ID">
            <Typography.Text copyable style={{ fontSize: 12 }}>
              {importOwner}
            </Typography.Text>
          </Descriptions.Item>
        )}
        {profileScript?.source.kind === 'url' && (
          <Descriptions.Item label="URL">
            <Typography.Link
              href={profileScript.source.url}
              target="_blank"
              rel="noreferrer"
              ellipsis
              copyable
              style={{ fontSize: 12 }}
            >
              {profileScript.source.url}
            </Typography.Link>
          </Descriptions.Item>
        )}
        {plugin.createdAt && (
          <Descriptions.Item label="Created">
            {new Date(plugin.createdAt).toLocaleDateString()}
          </Descriptions.Item>
        )}
        {plugin.editedAt && (
          <Descriptions.Item label="Updated">
            {new Date(plugin.editedAt).toLocaleDateString()}
          </Descriptions.Item>
        )}
        {!!plugin.downloads && (
          <Descriptions.Item label="Downloads">
            {plugin.downloads}
          </Descriptions.Item>
        )}
      </Descriptions>
    </div>
  );
};

const OptionsView: React.FC<{
  plugin: MacroInfo;
  errors?: Record<string, string>;
  onClearError?: (field: string) => void;
}> = ({ plugin, errors, onClearError }) => {
  const presetId = useSettingsStore((state) =>
    selectedPresetId(state.settings.scripts?.[plugin.pluginId]),
  );
  // Bumped after the AI changes values, so the form re-reads them.
  const [revision, setRevision] = useState(0);
  const describeSettings: LlmPromptProps['onSubmit'] = async (description, run) => {
    const result = await run<LlmOptionsResult>('LLM_GENERATE', { kind: 'options', description, pluginId: plugin.pluginId });
    if (!result) return undefined;
    return (dismiss) => (
      <LlmOptionChanges
        result={result}
        onDiscard={dismiss}
        onApply={() => {
          for (const [optionId, value] of Object.entries(result.values))
            updateScriptSettings({ optionId, value, scriptName: plugin.pluginId });
          setRevision((current) => current + 1);
          dismiss();
        }}
      />
    );
  };
  if (!plugin.config || plugin.config.length === 0) {
    return (
      <Typography.Text type="secondary">
        This plugin has no configurable options.
      </Typography.Text>
    );
  }

  return (
    <Flex vertical gap={8}>
      <PresetBar pluginId={plugin.pluginId} />
      <LlmPrompt
        collapsedLabel="Suggest settings with AI"
        placeholder="Describe the settings, e.g. only farm wheat and go slower"
        button="Suggest"
        writingLabel="Choosing values"
        onSubmit={describeSettings}
      />
      {/* The form only reads its values on mount, so remount it per preset. */}
      <ScriptSettings
        key={`${presetId}-${revision}`}
        options={plugin.config}
        scriptName={plugin.pluginId}
        errors={errors}
        onClearError={onClearError}
      />
    </Flex>
  );
};

const PluginInfoTab: React.FC<{ data: PanelData }> = ({ data }) => {
  const { plugin: initialPlugin, view: initialView, profileScript } = data;
  const [view, setView] = useState<PluginView>(initialView);
  // Profile scripts and marketplace entries aren't in the macros list, so
  // fall back to the panel snapshot for those. For installed plugins the
  // selector keeps us in sync with edits made elsewhere (e.g. code editor).
  const livePlugin = useSettingsStore(selectMacroById(initialPlugin.pluginId));
  const plugin = !profileScript && livePlugin ? livePlugin : initialPlugin;
  const running = useSettingsStore(selectIsMacroActive(plugin.pluginId));
  const { pluginData } = useSettingsStore(selectSettings);
  const isPinned = pluginData?.[plugin.pluginId]?.pinned ?? false;

  const actions = usePluginActions();
  const { optionErrors, clearOptionError } = usePanelContext();

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const errors = optionErrors[plugin.pluginId];

  const onRun = () =>
    actions.run(
      profileScript ? { name: plugin.name, pluginId: plugin.pluginId } : plugin,
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header
        plugin={plugin}
        running={running}
        pinned={isPinned}
        profileScript={profileScript}
        onRun={onRun}
      />
      <Segmented
        block
        value={view}
        onChange={(v) => setView(v as PluginView)}
        options={[
          { value: 'details', label: 'Details' },
          { value: 'options', label: 'Options' },
        ]}
      />
      {view === 'details' ? (
        <DetailsView
          plugin={plugin}
          running={running}
          profileScript={profileScript}
        />
      ) : (
        <OptionsView
          plugin={plugin}
          errors={errors}
          onClearError={(field) => clearOptionError(plugin.pluginId, field)}
        />
      )}
    </div>
  );
};

export default PluginInfoTab;
