import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  ColorPicker,
  Empty,
  Input,
  InputRef,
  Modal,
  Popconfirm,
  Space,
  Transfer,
  Typography,
  theme,
} from 'antd';
import { DeleteOutlined, PlusOutlined, EditOutlined } from '@ant-design/icons';
import {
  useSettingsStore,
  selectAlts,
  selectAltTags,
  setAltTags,
} from '../../../redux/settings';
import { TAG_COLOR_PALETTE, DEFAULT_TAG_COLOR, newTagId } from './tagConstants';
import type { Alt, AltTag } from '../../../../main/src/types';

interface TagManagerProps {
  open: boolean;
  initialTagId?: string | null;
  /** When true, a fresh tag is created and selected as soon as the modal opens. */
  createOnOpen?: boolean;
  onClose: () => void;
}

/**
 * Sanitises the working tag list before persisting:
 *  - tags with a blank name fall back to the matching stored name (if any),
 *    otherwise "New tag" — guaranteeing at least one character.
 *  - alt lists are de-duplicated while preserving order.
 */
const sanitizeTags = (working: AltTag[], stored: AltTag[]): AltTag[] => {
  return working.map((t) => {
    const name = t.name.trim();
    if (name.length > 0) return { ...t, alts: Array.from(new Set(t.alts)) };
    const fallback = stored.find((s) => s.id === t.id)?.name ?? 'New tag';
    return { ...t, name: fallback, alts: Array.from(new Set(t.alts)) };
  });
};

const tagsEqual = (a: AltTag[], b: AltTag[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.name !== y.name || x.color !== y.color) return false;
    if (x.alts.length !== y.alts.length) return false;
    for (let j = 0; j < x.alts.length; j++) {
      if (x.alts[j] !== y.alts[j]) return false;
    }
  }
  return true;
};

const TagManager: React.FC<TagManagerProps> = ({
  open,
  initialTagId = null,
  createOnOpen = false,
  onClose,
}) => {
  const {
    token: {
      colorBgLayout,
      colorBgContainer,
      colorBorderSecondary,
      colorBgElevated,
      colorPrimary,
    },
  } = theme.useToken();
  const storedTags = useSettingsStore(selectAltTags);
  const alts = useSettingsStore(selectAlts);

  // Working copy held locally so settings only commit on close.
  const [workingTags, setWorkingTags] = useState<AltTag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [transferSelectedKeys, setTransferSelectedKeys] = useState<string[]>(
    [],
  );
  const nameInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!open) return;
    const snapshot = storedTags.map((t) => ({ ...t, alts: [...t.alts] }));
    if (createOnOpen || snapshot.length === 0) {
      const fresh: AltTag = {
        id: newTagId(),
        name: 'New tag',
        color:
          TAG_COLOR_PALETTE[snapshot.length % TAG_COLOR_PALETTE.length] ??
          DEFAULT_TAG_COLOR,
        alts: [],
      };
      setWorkingTags([...snapshot, fresh]);
      setSelectedTagId(fresh.id);
      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }, 50);
    } else {
      setWorkingTags(snapshot);
      setSelectedTagId(initialTagId ?? storedTags[0]?.id ?? null);
    }
    setTransferSelectedKeys([]);
    // Intentionally only reset when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setTransferSelectedKeys([]);
  }, [selectedTagId]);

  const selectedTag = workingTags.find((t) => t.id === selectedTagId) ?? null;

  const handleClose = () => {
    let tagsToSanitize = workingTags;
    // If the modal auto-created a single 'New tag' on open with 0 alts and no tags existed previously,
    // and the user didn't modify it, don't persist an empty dummy tag.
    if (storedTags.length === 0 && workingTags.length === 1) {
      const single = workingTags[0];
      if (single.name.trim() === 'New tag' && single.alts.length === 0) {
        tagsToSanitize = [];
      }
    }
    const sanitized = sanitizeTags(tagsToSanitize, storedTags);
    if (!tagsEqual(sanitized, storedTags)) {
      setAltTags(sanitized);
    }
    onClose();
  };

  const updateTag = (tagId: string, patch: Partial<AltTag>) => {
    setWorkingTags((prev) =>
      prev.map((t) => (t.id === tagId ? { ...t, ...patch } : t)),
    );
  };

  const handleCreateTag = () => {
    const tag: AltTag = {
      id: newTagId(),
      name: 'New tag',
      color:
        TAG_COLOR_PALETTE[workingTags.length % TAG_COLOR_PALETTE.length] ??
        DEFAULT_TAG_COLOR,
      alts: [],
    };
    setWorkingTags((prev) => [...prev, tag]);
    setSelectedTagId(tag.id);
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 50);
  };

  const handleDelete = () => {
    if (!selectedTag) return;
    const next = workingTags.filter((t) => t.id !== selectedTag.id);
    setWorkingTags(next);
    setSelectedTagId(next[0]?.id ?? null);
  };

  const handleTransferChange = (nextTargetKeys: React.Key[]) => {
    if (!selectedTag) return;
    const next = nextTargetKeys.map(String);
    // Preserve the order of the alts already in the tag (their position is
    // meaningful for features like gkit collection). Newly-added alts are
    // appended at the end in the order Transfer emits them.
    const existingOrder = selectedTag.alts.filter((u) => next.includes(u));
    const existingSet = new Set(existingOrder);
    const additions = next.filter((u) => !existingSet.has(u));
    updateTag(selectedTag.id, { alts: [...existingOrder, ...additions] });
  };

  const handleTransferSelectChange = (
    sourceSelectedKeys: React.Key[],
    targetSelectedKeys: React.Key[],
  ) => {
    setTransferSelectedKeys(
      [...sourceSelectedKeys, ...targetSelectedKeys].map(String),
    );
  };

  const transferDataSource = alts.map((a: Alt) => ({
    key: a.username,
    title: a.username,
  }));

  const renderTransferItem = (item: { key: string; title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <img
        src={`https://crafthead.net/avatar/${item.title}`}
        alt={item.title}
        width={20}
        height={20}
        style={{ borderRadius: 3, flexShrink: 0 }}
      />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.title}
      </span>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title="Manage tags"
      width={960}
      footer={null}
      destroyOnHidden
    >
      <div style={{ display: 'flex', gap: 16, minHeight: 480 }}>
        {/* Left: tag list */}
        <div
          style={{
            width: 240,
            background: colorBgLayout,
            border: `1px solid ${colorBorderSecondary}`,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: `1px solid ${colorBorderSecondary}`,
            }}
          >
            <Button
              block
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateTag}
            >
              New tag
            </Button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {workingTags.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No tags"
                style={{ marginTop: 32 }}
              />
            ) : (
              workingTags.map((tag) => {
                const active = tag.id === selectedTagId;
                return (
                  <div
                    key={tag.id}
                    onClick={() => setSelectedTagId(tag.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: active ? colorBgElevated : 'transparent',
                      border: `1px solid ${active ? colorPrimary : 'transparent'}`,
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: tag.color,
                        flexShrink: 0,
                      }}
                    />
                    <Typography.Text
                      ellipsis
                      style={{ flex: 1, fontWeight: active ? 600 : 400 }}
                    >
                      {tag.name || (
                        <span style={{ opacity: 0.5 }}>(unnamed)</span>
                      )}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {tag.alts.length}
                    </Typography.Text>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: detail */}
        <div
          style={{
            flex: 1,
            background: colorBgContainer,
            border: `1px solid ${colorBorderSecondary}`,
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {!selectedTag ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  workingTags.length === 0
                    ? 'No tags created yet. Create one to organize alts.'
                    : 'Select a tag on the left to edit.'
                }
              >
                {workingTags.length === 0 && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleCreateTag}
                  >
                    Create tag
                  </Button>
                )}
              </Empty>
            </div>
          ) : (
            <>
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <ColorPicker
                  value={selectedTag.color}
                  presets={[{ label: 'Palette', colors: TAG_COLOR_PALETTE }]}
                  onChange={(_, hex) =>
                    updateTag(selectedTag.id, { color: hex })
                  }
                />
                <Input
                  ref={nameInputRef}
                  value={selectedTag.name}
                  onChange={(e) =>
                    updateTag(selectedTag.id, { name: e.target.value })
                  }
                  onPressEnter={(e) => {
                    (e.target as HTMLInputElement).blur();
                  }}
                  prefix={<EditOutlined style={{ opacity: 0.45 }} />}
                  placeholder="Tag name"
                  style={{ flex: 1, fontWeight: 600 }}
                  maxLength={48}
                />
                <Popconfirm
                  title={`Delete tag "${selectedTag.name || 'unnamed'}"?`}
                  description="The alts will keep existing — only the tag is removed."
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={handleDelete}
                >
                  <Button danger icon={<DeleteOutlined />}>
                    Delete
                  </Button>
                </Popconfirm>
              </div>

              {/* Members — picked via Transfer */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', marginBottom: 8 }}
                >
                  Move alts from the left to the right to add them to this tag.
                </Typography.Text>
                {alts.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No alts to tag yet."
                    style={{ margin: '40px 0' }}
                  />
                ) : (
                  <Transfer
                    dataSource={transferDataSource}
                    targetKeys={selectedTag.alts}
                    selectedKeys={transferSelectedKeys}
                    onChange={handleTransferChange}
                    onSelectChange={handleTransferSelectChange}
                    render={renderTransferItem as any}
                    showSearch
                    filterOption={(input, item) =>
                      (item.title ?? '')
                        .toLowerCase()
                        .includes(input.toLowerCase())
                    }
                    titles={['All alts', 'In tag']}
                    locale={{
                      itemUnit: 'alt',
                      itemsUnit: 'alts',
                      searchPlaceholder: 'Search alts…',
                    }}
                    styles={{ section: { width: '50%', height: 360 } }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 16,
        }}
      >
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={handleClose}>
            Done
          </Button>
        </Space>
      </div>
    </Modal>
  );
};

export default TagManager;
