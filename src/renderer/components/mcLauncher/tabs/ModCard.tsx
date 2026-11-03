import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  AppstoreOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Button,
  Card,
  Flex,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import type { ModInfo, ModpackInfo } from '../../../../main/src/types';

export interface MinecraftContentCardProps {
  title: string;
  description?: string;
  iconUrl?: string;
  category: string;
  metadata?: ReactNode;
  status?: ReactNode;
  actionLabel?: string;
  actionIcon?: ReactNode;
  actionDanger?: boolean;
  actionPrimary?: boolean;
  actionLoading?: boolean;
  actionDisabled?: boolean;
  onAction?: () => void | Promise<void>;
  onClick: () => void;
}

export const MinecraftContentCard = ({
  title,
  description,
  iconUrl,
  category,
  metadata,
  status,
  actionLabel,
  actionIcon,
  actionDanger,
  actionPrimary,
  actionLoading,
  actionDisabled,
  onAction,
  onClick,
}: MinecraftContentCardProps) => {
  const { token } = theme.useToken();

  const handleAction = async (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    await onAction?.();
  };

  return (
    <Card
      hoverable
      role="button"
      tabIndex={0}
      aria-label={`View details for ${title}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        height: '100%',
        minHeight: 190,
        borderColor: token.colorBorderSecondary,
      }}
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: token.paddingLG,
        },
      }}
    >
      <Flex vertical gap="middle" style={{ height: '100%' }}>
        <Flex align="flex-start" gap="middle">
          <Avatar
            shape="square"
            size={token.controlHeightLG + token.sizeSM}
            src={iconUrl}
            icon={<AppstoreOutlined />}
            style={{
              flexShrink: 0,
              background: token.colorFillSecondary,
              color: token.colorTextSecondary,
            }}
          />
          <Flex vertical gap={token.marginXXS} style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong ellipsis title={title}>
              {title}
            </Typography.Text>
            <Space size="small" wrap>
              <Tag variant="filled">{category}</Tag>
              {status}
            </Space>
          </Flex>
        </Flex>

        <Typography.Paragraph
          type="secondary"
          ellipsis={{ rows: 2 }}
          style={{ margin: 0, minHeight: token.fontSize * 3 }}
        >
          {description || 'Open to view project details.'}
        </Typography.Paragraph>

        <Flex
          align="center"
          justify="space-between"
          gap="small"
          style={{ marginTop: 'auto' }}
        >
          <Typography.Text type="secondary" ellipsis style={{ minWidth: 0 }}>
            {metadata}
          </Typography.Text>
          {actionLabel ? (
            <Button
              size="small"
              danger={actionDanger}
              type={actionPrimary ? 'primary' : 'text'}
              icon={actionIcon}
              loading={actionLoading}
              disabled={actionDisabled}
              onClick={(event) => void handleAction(event)}
            >
              {actionLabel}
            </Button>
          ) : (
            <Typography.Text type="secondary">View details</Typography.Text>
          )}
        </Flex>
      </Flex>
    </Card>
  );
};

interface ModCardProps {
  modInfo: ModInfo | ModpackInfo;
  type: 'mod' | 'modpack';
  isActive: boolean;
  onAdd: (modId: string, type: 'mod' | 'modpack') => Promise<void>;
  onRemove: (modId: string, type: 'mod' | 'modpack') => Promise<void>;
  onClick: () => void;
  canManage: boolean;
}

const ModCard = ({
  modInfo,
  type,
  isActive,
  onAdd,
  onRemove,
  onClick,
  canManage,
}: ModCardProps) => {
  const [actionLoading, setActionLoading] = useState(false);

  const handleAction = async () => {
    setActionLoading(true);
    try {
      if (isActive) await onRemove(modInfo.id, type);
      else await onAdd(modInfo.id, type);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <MinecraftContentCard
      title={modInfo.name}
      iconUrl={modInfo.iconUrl}
      category={type === 'modpack' ? 'Modpack' : 'Mod'}
      metadata={`Minecraft ${modInfo.mcVersion}`}
      status={isActive ? <Tag color="success">Active</Tag> : undefined}
      actionLabel={canManage ? (isActive ? 'Deactivate' : 'Use') : undefined}
      actionIcon={
        canManage ? isActive ? <DeleteOutlined /> : <PlusOutlined /> : undefined
      }
      actionDanger={isActive}
      actionPrimary={!isActive}
      actionLoading={actionLoading}
      onAction={handleAction}
      onClick={onClick}
    />
  );
};

export default ModCard;
