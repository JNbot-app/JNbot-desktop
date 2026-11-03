import React from 'react';
import {
  PlusOutlined,
  DownloadOutlined,
  DeleteOutlined,
  TagsOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import {
  Button,
  Dropdown,
  Input,
  MenuProps,
  Space,
  Typography,
  theme,
  Popconfirm,
} from 'antd';
import {
  useSettingsStore,
  selectAlts,
  selectAltTags,
  addAltsToTag,
  removeAltsFromTag,
} from '../../redux/settings';
import ImportAlts from './ImportAlts';
import TagBar from './tags/TagBar';
import AltFilters, { AdvancedFilters } from './AltFilters';
import type { AltTag, AltWithData } from '../../../../src/main/src/types.d.ts';

const EXPORT_VERSION = 1;

const getJson = (alts: AltWithData[], profileId: string) => {
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      profileId,
      alts,
    },
    null,
    2,
  );
};

const exportBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

const exportJson = (alts: AltWithData[], profileId: string) => {
  const jsonString = getJson(alts, profileId);
  const blob = new Blob([jsonString], {
    type: 'application/json',
  });

  exportBlob(blob, `alts-${profileId}.json`);
};

const exportUsernamePassword = (alts: AltWithData[]) => {
  const altsData = alts.map(
    (alt) => `${alt.username} ${alt.data?.password || ''}`,
  );
  const blob = new Blob([altsData.join('\n')], {
    type: 'text/plain',
  });

  exportBlob(blob, 'alts.txt');
};

interface GridToolbarProps {
  onAddAlt: () => void;
  onFilterChange: (value: string) => void;
  selectedRowKeys: React.Key[];
  onBulkDelete: () => void;
  onClearSelection: () => void;
  activeTagId: string | null;
  onTagSelect: (tagId: string | null) => void;
  onManageTags: (tagId?: string | null) => void;
  advancedFilters: AdvancedFilters;
  onAdvancedFiltersChange: (value: AdvancedFilters) => void;
}

const GridToolbar: React.FC<GridToolbarProps> = ({
  onAddAlt,
  onFilterChange,
  selectedRowKeys,
  onBulkDelete,
  onClearSelection,
  activeTagId,
  onTagSelect,
  onManageTags,
  advancedFilters,
  onAdvancedFiltersChange,
}) => {
  const {
    token: {
      colorBgContainer,
      colorBorderSecondary,
      colorPrimaryBg,
      colorPrimaryBorder,
      colorPrimaryText,
    },
  } = theme.useToken();
  const alts = useSettingsStore(selectAlts);
  const tags = useSettingsStore(selectAltTags);
  const activeProfileId = useSettingsStore((state) => state.appSettings.server);
  const selectedUsernames = selectedRowKeys.map((k) => String(k));

  const getExportAlts = () => {
    if (selectedRowKeys.length > 0) {
      return alts.filter((alt) => selectedRowKeys.includes(alt.username));
    }
    return alts;
  };

  const exportMenu: MenuProps = {
    items: [
      {
        key: 'export-json',
        label:
          selectedRowKeys.length > 0
            ? 'Export Selected JSON'
            : 'Export All JSON',
        onClick: () => exportJson(getExportAlts(), activeProfileId!),
      },
      {
        key: 'export-username-password',
        label:
          selectedRowKeys.length > 0
            ? 'Export Selected Username & Password'
            : 'Export All Username & Password',
        onClick: () => exportUsernamePassword(getExportAlts()),
      },
    ],
  };

  // For the "Add to tag" menu, indicate which tags the current selection is
  // already fully contained in so we can flip those rows to "remove from tag".
  const fullyContained = new Map<string, boolean>();
  if (selectedUsernames.length > 0) {
    for (const tag of tags) {
      const set = new Set(tag.alts);
      fullyContained.set(
        tag.id,
        selectedUsernames.every((u) => set.has(u)),
      );
    }
  }

  const handleTagAction = (tag: AltTag) => {
    if (selectedUsernames.length === 0) return;
    if (fullyContained.get(tag.id)) {
      removeAltsFromTag({
        tagId: tag.id,
        usernames: selectedUsernames,
      });
    } else {
      addAltsToTag({
        tagId: tag.id,
        usernames: selectedUsernames,
      });
    }
  };

  const tagBulkMenu: MenuProps = {
    items: [
      ...(tags.length === 0
        ? [
            {
              key: '_empty',
              disabled: true,
              label: (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No tags yet
                </Typography.Text>
              ),
            } as any,
          ]
        : tags.map((tag) => {
            const inTag = !!fullyContained.get(tag.id);
            return {
              key: tag.id,
              label: (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minWidth: 180,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: tag.color,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ flex: 1 }}>{tag.name}</span>
                  {inTag && <CheckOutlined style={{ fontSize: 12 }} />}
                </div>
              ),
              onClick: () => handleTagAction(tag),
            };
          })),
      { type: 'divider' as const },
      {
        key: '_manage',
        icon: <TagsOutlined />,
        label: 'Manage tags…',
        onClick: () => onManageTags(),
      },
    ],
  };

  return (
    <div
      style={{
        width: '100%',
        backgroundColor: colorBgContainer,
        padding: '16px',
        borderBottom: `1px solid ${colorBorderSecondary}`,
        borderRadius: '8px 8px 0 0',
      }}
    >
      {/* Main toolbar row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        {/* Left side - Primary actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Button
            onClick={onAddAlt}
            type="primary"
            id="add-alt-tutorial-step"
            icon={<PlusOutlined />}
          >
            Add Alt
          </Button>

          <Space>
            <Dropdown
              menu={exportMenu}
              trigger={['click']}
              placement="bottomLeft"
            >
              <Button icon={<DownloadOutlined />} disabled={alts.length === 0}>
                Export
              </Button>
            </Dropdown>
            <ImportAlts />
          </Space>
        </div>

        {/* Right side - Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AltFilters
            alts={alts}
            value={advancedFilters}
            onChange={onAdvancedFiltersChange}
          />
          <Input.Search
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Search alt"
            style={{ width: 200 }}
          />
        </div>
      </div>

      {/* Tag bar */}
      <TagBar
        tags={tags}
        activeTagId={activeTagId}
        totalAltCount={alts.length}
        onSelect={onTagSelect}
        onManage={() => onManageTags(activeTagId)}
      />

      {/* Selection actions row - only shown when items are selected */}
      {selectedRowKeys.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            backgroundColor: colorPrimaryBg,
            borderRadius: '6px',
            border: '1px solid ' + colorPrimaryBorder,
            marginTop: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Typography.Text strong style={{ color: colorPrimaryText }}>
              {selectedRowKeys.length} alt
              {selectedRowKeys.length > 1 ? 's' : ''} selected
            </Typography.Text>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Dropdown menu={tagBulkMenu} trigger={['click']}>
              <Button icon={<TagsOutlined />} size="small">
                Tag
              </Button>
            </Dropdown>
            <Button onClick={onClearSelection} type="text" size="small">
              Clear Selection
            </Button>
            <Popconfirm
              title={`Delete ${selectedRowKeys.length} selected alt${selectedRowKeys.length > 1 ? 's' : ''}?`}
              description="Are you sure you want to delete the selected alts? This action cannot be undone."
              onConfirm={onBulkDelete}
              okText="Delete"
              okButtonProps={{ danger: true }}
              cancelText="Cancel"
            >
              <Button danger icon={<DeleteOutlined />} size="small">
                Delete selected alts
              </Button>
            </Popconfirm>
          </div>
        </div>
      )}
    </div>
  );
};

export default GridToolbar;
