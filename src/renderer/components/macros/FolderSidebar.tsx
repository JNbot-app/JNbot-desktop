import React, { useMemo, useState } from 'react';
import { Button, Dropdown, Input, Modal, theme } from 'antd';
import {
  AppstoreOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  selectMacros,
  selectPluginMetadata,
  selectPluginsUi,
} from '../../redux/settings';
import { usePluginActions } from './usePluginActions';
import { shareUpdateAvailable } from '../../../common/share';
import { useShares } from '../../redux/shares';
import { openShareModal, useOpenShareLink } from '../share/useShareTarget';

const FolderRow: React.FC<{
  label: string;
  icon: React.ReactNode;
  count?: number;
  active: boolean;
  onClick: () => void;
  onDrop?: (e: React.DragEvent) => void;
  extra?: React.ReactNode;
}> = ({ label, icon, count, active, onClick, onDrop, extra }) => {
  const { token } = theme.useToken();
  const [over, setOver] = useState(false);
  return (
    <div
      onClick={onClick}
      onDragOver={
        onDrop
          ? (e) => {
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={() => setOver(false)}
      onDrop={
        onDrop
          ? (e) => {
              setOver(false);
              onDrop(e);
            }
          : undefined
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        marginBottom: 2,
        background: active
          ? token.colorPrimaryBg
          : over
            ? token.colorFillTertiary
            : 'transparent',
        color: active ? token.colorPrimary : token.colorTextSecondary,
        border: `1px solid ${over ? token.colorPrimary : 'transparent'}`,
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          fontWeight: active ? 600 : 400,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      {count && (
        <span
          style={{
            fontSize: 11,
            color: token.colorTextTertiary,
            background: token.colorFillTertiary,
            padding: '0 6px',
            borderRadius: 10,
            flexShrink: 0,
          }}
        >
          {count}
        </span>
      )}
      {extra}
    </div>
  );
};

const FolderSidebar: React.FC = () => {
  const { token } = theme.useToken();
  const { list: plugins } = useSettingsStore(selectMacros);
  const pluginMetadata = useSettingsStore(selectPluginMetadata);
  const ui = useSettingsStore(selectPluginsUi);
  const actions = usePluginActions();
  const installedShares = useShares((state) => state.installed);
  const appVersion = useShares((state) => state.appVersion);
  const openShareLink = useOpenShareLink();
  const bundleUpdateItem = (folder: string) => {
    const share = Object.values(installedShares).find(
      (item) => item.kind === 'bundle' && item.localRef === folder,
    );
    return share && shareUpdateAvailable(share, appVersion)
      ? [{ key: 'share-update', label: `Update from ${share.ownerName}`, onClick: () => openShareLink(share.id) }]
      : [];
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const { folders, unorganized } = useMemo(() => {
    const counts: Record<string, number> = {};
    ui.extraFolders.forEach((f) => (counts[f] = 0));
    let unorganized = 0;
    plugins.forEach((p) => {
      const folder = pluginMetadata[p.pluginId]?.folder;
      if (folder) counts[folder] = (counts[folder] ?? 0) + 1;
      else unorganized++;
    });
    return { folders: Object.keys(counts), counts, unorganized };
  }, [pluginMetadata, plugins, ui.extraFolders]);

  const onDrop = (target: string | null) => (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/plain');
    if (id) actions.movePlugin(id, target);
  };

  const submit = (fn: () => void) => () => {
    if (input.trim()) fn();
  };

  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '12px 10px 6px',
          fontSize: 11,
          fontWeight: 700,
          color: token.colorTextTertiary,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        Folders
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
        <FolderRow
          label="All Plugins"
          icon={<AppstoreOutlined />}
          count={plugins.length}
          active={ui.folder === '__all__'}
          onClick={() => actions.setUi({ folder: '__all__' })}
        />
        <FolderRow
          label="Unorganized"
          icon={<InboxOutlined />}
          count={unorganized}
          active={ui.folder === '__none__'}
          onClick={() => actions.setUi({ folder: '__none__' })}
          onDrop={onDrop(null)}
        />
        {folders.length > 0 && (
          <div
            style={{
              height: 1,
              background: token.colorBorderSecondary,
              margin: '8px 4px',
            }}
          />
        )}
        {folders.map((f) => (
          <FolderRow
            key={f}
            label={f}
            icon={ui.folder === f ? <FolderOpenOutlined /> : <FolderOutlined />}
            active={ui.folder === f}
            onClick={() => actions.setUi({ folder: f })}
            onDrop={onDrop(f)}
            extra={
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'rename',
                      label: 'Rename',
                      onClick: () => {
                        setRenameTarget(f);
                        setInput(f);
                      },
                    },
                    {
                      key: 'share',
                      label: 'Share as bundle',
                      onClick: () => openShareModal({ kind: 'bundle', ref: f, title: f }),
                    },
                    ...bundleUpdateItem(f),
                    {
                      key: 'delete',
                      label: 'Delete',
                      danger: true,
                      onClick: () => actions.deleteFolder(f),
                    },
                  ],
                }}
              >
                <Button
                  size="small"
                  type="text"
                  icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Dropdown>
            }
          />
        ))}
      </div>
      <div
        style={{
          padding: 8,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Button
          block
          size="small"
          type="text"
          icon={<PlusOutlined />}
          onClick={() => {
            setInput('');
            setCreateOpen(true);
          }}
        >
          New Folder
        </Button>
      </div>

      <Modal
        title="New Folder"
        open={createOpen}
        okText="Create"
        destroyOnHidden
        onCancel={() => setCreateOpen(false)}
        onOk={submit(() => {
          actions.createFolder(input.trim());
          setCreateOpen(false);
        })}
      >
        <Input
          autoFocus
          placeholder="Folder name"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={submit(() => {
            actions.createFolder(input.trim());
            setCreateOpen(false);
          })}
        />
      </Modal>

      <Modal
        title="Rename Folder"
        open={!!renameTarget}
        okText="Rename"
        destroyOnHidden
        onCancel={() => setRenameTarget(null)}
        onOk={submit(() => {
          if (renameTarget) actions.renameFolder(renameTarget, input.trim());
          setRenameTarget(null);
        })}
      >
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={submit(() => {
            if (renameTarget) actions.renameFolder(renameTarget, input.trim());
            setRenameTarget(null);
          })}
        />
      </Modal>
    </div>
  );
};

export default FolderSidebar;
