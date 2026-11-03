import React from 'react';
import { Button, Tag, Typography, theme } from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import type { AltTag } from '../../../../main/src/types';

interface TagBarProps {
  tags: AltTag[];
  activeTagId: string | null;
  totalAltCount: number;
  onSelect: (tagId: string | null) => void;
  onManage: () => void;
}

const TagBar: React.FC<TagBarProps> = ({
  tags,
  activeTagId,
  totalAltCount,
  onSelect,
  onManage,
}) => {
  const {
    token: { colorBorderSecondary, colorTextSecondary, colorBgElevated },
  } = theme.useToken();

  const isAllActive = activeTagId === null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 0 4px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: colorTextSecondary,
        }}
      >
        <TagsOutlined />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Tags
        </Typography.Text>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          flex: 1,
          minWidth: 0,
        }}
      >
        <Tag.CheckableTag
          checked={isAllActive}
          onChange={() => onSelect(null)}
          style={{
            borderRadius: 999,
            padding: '2px 12px',
            border: `1px solid ${colorBorderSecondary}`,
          }}
        >
          All alts <span style={{ opacity: 0.6 }}>· {totalAltCount}</span>
        </Tag.CheckableTag>

        {tags.length > 0 && (
          tags.map((tag) => {
            const isActive = tag.id === activeTagId;
            return (
              <Tag.CheckableTag
                key={tag.id}
                checked={isActive}
                onChange={() => onSelect(isActive ? null : tag.id)}
                style={{
                  borderRadius: 999,
                  padding: '2px 12px',
                  border: `1px solid ${isActive ? tag.color : colorBorderSecondary}`,
                  backgroundColor: isActive ? tag.color : colorBgElevated,
                  color: isActive ? '#fff' : 'inherit',
                  fontWeight: 500,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: tag.color,
                    marginRight: 6,
                    verticalAlign: 'middle',
                    border: isActive ? '1px solid #fff' : 'none',
                  }}
                />
                {tag.name}
                <span style={{ opacity: 0.65, marginLeft: 6 }}>
                  {tag.alts.length}
                </span>
              </Tag.CheckableTag>
            );
          })
        )}
      </div>

      <Button size="small" icon={<TagsOutlined />} onClick={onManage}>
        Manage tags
      </Button>
    </div>
  );
};

export default TagBar;
