import React, { useState } from 'react';
import {
  Button,
  Card,
  Flex,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import useAppApi from '../../hooks/useAppApi';
import { updateScriptSettings } from '../../redux/settings';

const { Text } = Typography;

interface DiscordRoleManagerProps {
  savedRoles: string[];
  blockedRoles: string[];
}

const DiscordRoleManager: React.FC<DiscordRoleManagerProps> = ({
  savedRoles,
  blockedRoles,
}) => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [activeTab, setActiveTab] = useState<'roles' | 'blockedRoles'>('roles');
  const [draft, setDraft] = useState('');

  const isAllowed = activeTab === 'roles';
  const currentRoles = isAllowed ? savedRoles : blockedRoles;

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!/^\d+$/.test(trimmed)) {
      message.error('Role IDs must contain numbers only');
      return;
    }
    if (trimmed.length < 16 || trimmed.length > 21) {
      message.error('Role ID must be a 16–21 digit snowflake');
      return;
    }
    if (currentRoles.includes(trimmed)) {
      message.warning('Role is already in the list');
      return;
    }

    updateScriptSettings({
      scriptName: 'discord',
      optionId: activeTab,
      value: [trimmed, ...currentRoles],
    });
    setDraft('');
    message.success('Role added');
  };

  const handleRemove = (id: string) => {
    updateScriptSettings({
      scriptName: 'discord',
      optionId: activeTab,
      value: currentRoles.filter((r) => r !== id),
    });
    message.success('Role removed');
  };

  const copyRoleId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      message.success('Role ID copied');
    } catch {
      message.error('Failed to copy ID');
    }
  };

  return (
    <Card
      size="small"
      style={{
        height: '100%',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
      title={
        <Space size="small">
          <SafetyCertificateOutlined />
          <span>Role Permissions</span>
          <Tooltip
            title={
              isAllowed
                ? 'Allowed roles: Only members with these roles can execute commands. If empty, all members are allowed.'
                : 'Blocked roles: Members with these roles cannot execute commands.'
            }
          >
            <InfoCircleOutlined style={{ color: token.colorTextSecondary, cursor: 'pointer' }} />
          </Tooltip>
        </Space>
      }
      extra={
        <Segmented
          size="small"
          value={activeTab}
          onChange={(val) => {
            setActiveTab(val as 'roles' | 'blockedRoles');
            setDraft('');
          }}
          options={[
            {
              label: (
                <Space size={4}>
                  <span>Allowed</span>
                  <Tag  style={{ margin: 0, padding: '0 4px', fontSize: 11, lineHeight: '16px' }}>
                    {savedRoles.length}
                  </Tag>
                </Space>
              ),
              value: 'roles',
            },
            {
              label: (
                <Space size={4}>
                  <span>Blocked</span>
                  <Tag
                    color={blockedRoles.length > 0 ? 'error' : 'default'}
                    style={{ margin: 0, padding: '0 4px', fontSize: 11, lineHeight: '16px' }}
                  >
                    {blockedRoles.length}
                  </Tag>
                </Space>
              ),
              value: 'blockedRoles',
            },
          ]}
        />
      }
    >
      <Flex vertical gap={token.marginSM} style={{ minHeight: 180 }}>
        <Flex gap={token.marginSM}>
          <Input
            placeholder="Role ID (example: 627276425165398780)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={handleAdd}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            Add
          </Button>
        </Flex>

        {currentRoles.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            style={{
              flex: 1,
              padding: token.paddingMD,
              border: `1px dashed ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
              backgroundColor: token.colorFillAlter,
            }}
          >
            <Text type="secondary" style={{ fontSize: token.fontSizeSM, textAlign: 'center' }}>
              {isAllowed
                ? 'No role restrictions (all server members can run commands)'
                : 'No blocked roles configured'}
            </Text>
          </Flex>
        ) : (
          <div
            style={{
              maxHeight: 180,
              overflowY: 'auto',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
            }}
          >
            {currentRoles.map((roleId, idx) => (
              <Flex
                key={roleId}
                align="center"
                justify="space-between"
                style={{
                  padding: '6px 12px',
                  borderBottom:
                    idx !== currentRoles.length - 1
                      ? `1px solid ${token.colorBorderSecondary}`
                      : undefined,
                  backgroundColor: token.colorBgContainer,
                }}
              >
                <Text code copyable={false} style={{ fontSize: token.fontSizeSM }}>
                  {roleId}
                </Text>
                <Space size={2}>
                  <Tooltip title="Copy ID">
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyRoleId(roleId)}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="Remove this role?"
                    onConfirm={() => handleRemove(roleId)}
                    okText="Remove"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </Flex>
            ))}
          </div>
        )}
      </Flex>
    </Card>
  );
};

export default DiscordRoleManager;
