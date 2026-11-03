import React, { useEffect, useState } from 'react';
import { Flex, Input, Modal, Typography } from 'antd';
import ProfileSelector from '../ProfileSelector';
import {
  selectActiveServerId,
  selectInstalledServers,
  useSettingsStore,
} from '../../redux/settings';

const { Text } = Typography;

interface McpConnectModalProps {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConnect: (name: string, profiles: string[]) => void;
}

const McpConnectModal: React.FC<McpConnectModalProps> = ({
  open,
  busy,
  onCancel,
  onConnect,
}) => {
  const activeProfileId = useSettingsStore(selectActiveServerId);
  const profiles = useSettingsStore(selectInstalledServers);

  const [name, setName] = useState('My AI Client');
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setName('My AI Client');
      if (activeProfileId) {
        setSelectedProfiles([activeProfileId]);
      } else if (profiles.length > 0) {
        setSelectedProfiles([profiles[0].id]);
      } else {
        setSelectedProfiles([]);
      }
    }
  }, [open, activeProfileId, profiles]);

  const handleSubmit = () => {
    if (!name.trim() || !selectedProfiles.length) return;
    onConnect(name.trim(), selectedProfiles);
  };

  return (
    <Modal
      open={open}
      title="Connect AI Client"
      okText="Create access key"
      confirmLoading={busy}
      okButtonProps={{
        disabled: !name.trim() || !selectedProfiles.length,
      }}
      onOk={handleSubmit}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Flex vertical gap={16} style={{ paddingTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Create an MCP access key for Claude, ChatGPT, or Cursor to connect.
        </Text>

        <Flex vertical gap={6}>
          <Text strong style={{ fontSize: 13 }}>
            Client Name
          </Text>
          <Input
            autoFocus
            value={name}
            placeholder="e.g. Claude Desktop"
            onChange={(e) => setName(e.target.value)}
          />
        </Flex>

        <Flex vertical gap={6}>
          <Text strong style={{ fontSize: 13 }}>
            Accessible Profiles
          </Text>
          <ProfileSelector
            value={selectedProfiles}
            style={{ width: '100%' }}
            onChange={setSelectedProfiles}
            placeholder="Select profiles"
          />
        </Flex>
      </Flex>
    </Modal>
  );
};

export default McpConnectModal;
