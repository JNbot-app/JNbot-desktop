import React, { memo, useState } from 'react';
import { Button, Tag, Tooltip, Typography, theme } from 'antd';
import {
  ApiOutlined,
  CaretRightOutlined,
  CloseOutlined,
  CodeOutlined,
  EditOutlined,
  SettingOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { MacroInfo } from '../../../main/src/types';
import {
  useSettingsStore,
  selectIsMacroActive,
  selectPluginMetadata,
} from '../../redux/settings';
import { usePluginActions } from './usePluginActions';
import BannerHero from './BannerHero';

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

const Badges: React.FC<{ p: MacroInfo; running: boolean }> = memo(
  ({ p, running }) => (
    <>
      {running && <Tag color="success">Running</Tag>}
      {p.scriptType === 'action' && <Tag color="purple">Action</Tag>}
      {p.language === 'js' && <Tag color="gold">JS</Tag>}
      {p.language === 'ts' && <Tag color="geekblue">TS</Tag>}
      {p.language === 'recording' && <Tag color="cyan">Recording</Tag>}
     
    </>
  ),
);

type Props = {
  plugin: MacroInfo;
  viewMode: 'grid' | 'list';
  updateAvailable: boolean;
};

const PluginCard: React.FC<Props> = ({ plugin, viewMode, updateAvailable }) => {
  const { token } = theme.useToken();
  const running = useSettingsStore(selectIsMacroActive(plugin.pluginId));
  const folder = useSettingsStore(
    (state) => selectPluginMetadata(state)[plugin.pluginId]?.folder,
  );
  const actions = usePluginActions();
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);

  const onRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    await actions.toggleRun(plugin);
    setBusy(false);
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const cv = {
    contentVisibility: 'auto',
    containIntrinsicSize:
      viewMode === 'list' ? '0 48px' : plugin.banner ? '0 240px' : '0 160px',
  } as React.CSSProperties;

  const ActionBtns = (
    <div
      style={{
        display: 'flex',
        gap: 2,
        opacity: hover ? 1 : 0.55,
        transition: 'opacity .15s',
      }}
      onClick={stop}
    >
      <Tooltip title={running ? 'Stop' : 'Run'}>
        <Button
          size="small"
          type="text"
          loading={busy}
          icon={running ? <CloseOutlined /> : <CaretRightOutlined />}
          onClick={onRun}
        />
      </Tooltip>
      <Button
        size="small"
        type="text"
        icon={<EditOutlined />}
        onClick={() => actions.editCode(plugin)}
      />
      <Button
        size="small"
        type="text"
        icon={<SettingOutlined />}
        onClick={() => actions.selectPlugin(plugin, 'options')}
      />
    </div>
  );

  if (viewMode === 'list') {
    return (
      <div
        draggable
        onDragStart={(e) =>
          e.dataTransfer.setData('text/plain', plugin.pluginId)
        }
        onClick={() => actions.selectPlugin(plugin)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          ...cv,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          background: hover ? token.colorFillTertiary : 'transparent',
          border: `1px solid ${running ? token.colorSuccessBorder : 'transparent'}`,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 6,
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: running
              ? token.colorSuccessBg
              : token.colorFillTertiary,
            color: running ? token.colorSuccess : token.colorTextSecondary,
          }}
        >
          {plugin.banner ? (
            <img
              src={plugin.banner}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            iconFor(plugin)
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text
            strong
            ellipsis
            style={{ fontSize: 13, display: 'block' }}
          >
            {plugin.name}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            ellipsis
            style={{ fontSize: 11.5, display: 'block' }}
          >
            {plugin.description || 'No description'}
          </Typography.Text>
        </div>
        <Badges p={plugin} running={running} />
        {ActionBtns}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', plugin.pluginId)}
      onClick={() => actions.selectPlugin(plugin)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...cv,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 150,
        cursor: 'pointer',
        background: token.colorBgContainer,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${running ? token.colorSuccessBorder : token.colorBorderSecondary}`,
        boxShadow: hover ? token.boxShadow : token.boxShadowTertiary,
        overflow: 'hidden',
        position: 'relative',
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      {running && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: token.colorSuccess,
            zIndex: 1,
          }}
        />
      )}
      {plugin.banner ? (
        <BannerHero
          src={plugin.banner}
          height={84}
          accent={plugin.theme?.primaryColor}
        >
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: '#fff',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              {iconFor(plugin)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
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
                  fontSize: 11.5,
                  color: 'rgba(255,255,255,0.85)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                }}
              >
                {folder ?? ''}
              </div>
            </div>
          </div>
        </BannerHero>
      ) : null}
      <div style={{ padding: '12px 14px 10px', flex: 1 }}>
        {!plugin.banner && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: running
                  ? token.colorSuccessBg
                  : token.colorFillTertiary,
                color: running ? token.colorSuccess : token.colorTextSecondary,
                fontSize: 16,
              }}
            >
              {iconFor(plugin)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text
                strong
                ellipsis={{ tooltip: plugin.name }}
                style={{ fontSize: 14, display: 'block' }}
              >
                {plugin.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                {folder ?? ''}
              </Typography.Text>
            </div>
          </div>
        )}
        <Typography.Paragraph
          type="secondary"
          ellipsis={{ rows: 2 }}
          style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}
        >
          {plugin.description || 'No description available.'}
        </Typography.Paragraph>
      </div>
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          gap: 8,
          minHeight: 40,
        }}
      >
        {updateAvailable ? (
          <Button
            size="small"
            type="link"
            icon={<SyncOutlined />}
            onClick={(e) => {
              stop(e);
              actions.updatePlugin(plugin.pluginId);
            }}
            style={{ paddingInline: 0 }}
          >
            Update available
          </Button>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
            }}
          >
            <Badges p={plugin} running={running} />
          </div>
        )}
        {ActionBtns}
      </div>
    </div>
  );
};

export default memo(PluginCard);
