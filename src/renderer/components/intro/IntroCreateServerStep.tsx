import { Button, Flex, Form, Input, Switch, Typography, theme } from 'antd';
import { LeftOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import IntroStepHeader from './IntroStepHeader';
import useAppApi from '../../hooks/useAppApi';
import {
  useSettingsStore,
  switchServer,
  upsertCustomProfile,
} from '../../redux/settings';
import { createCustomProfile } from '../../../common/createCustomProfile';
import type { CreateProfileInput } from '../../../common/mobileClientContract';
import ServerAddressField from '../profiles/ServerAddressField';
import { guessServerName, iconColor } from '../profiles/wizardUtils';

const { Text } = Typography;

interface IntroCreateServerStepProps {
  onBack: () => void;
  onCreated: () => void;
}

const IntroCreateServerStep = ({ onBack, onCreated }: IntroCreateServerStepProps) => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { message } = useAppApi();
  const [draft, setDraft] = useState<CreateProfileInput>({
    name: '',
    host: '',
    port: 25565,
    onlineMode: false,
  });
  const [showErrors, setShowErrors] = useState(false);
  const nameAuto = useRef(true);
  const patch = (next: Partial<CreateProfileInput>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  const fillFromServer = async (favicon?: string) => {
    if (nameAuto.current) patch({ name: guessServerName(draft.host) });
    if (!favicon) return;
    const color = await iconColor(favicon);
    patch({ advanced: { icon: favicon, ...(color && { color }) } });
  };

  const create = () => {
    if (!draft.name.trim() || !draft.host) return setShowErrors(true);
    const { JNdata, customProfiles } = useSettingsStore.getState();
    const reservedIds = [
      ...(JNdata?.serverList ?? []),
      ...customProfiles.map((p) => p.id),
    ];
    try {
      const profile = createCustomProfile(draft, reservedIds, []);
      upsertCustomProfile(profile);
      switchServer(profile.id);
      onCreated();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Unable to add this server.');
    }
  };

  const openAdvanced = () =>
    navigate('/profiles/new', { state: { onboardingDraft: draft } });

  return (
    <Flex vertical gap={token.marginLG}>
      <IntroStepHeader
        icon={<PlusOutlined />}
        title="Add your server"
        subtitle="Enter the Minecraft server your bots should join."
      />

      <Form layout="vertical" requiredMark={false} onFinish={create}>
        <ServerAddressField
          host={draft.host}
          port={draft.port}
          autoFocus
          error={showErrors && !draft.host ? 'Enter the server address' : undefined}
          onChange={(host, port) => patch({ host, port })}
          onOnline={(status) => void fillFromServer(status.favicon)}
        />
        <Form.Item
          label="Name"
          required
          validateStatus={showErrors && !draft.name.trim() ? 'error' : undefined}
          help={showErrors && !draft.name.trim() ? 'Give the server a name' : undefined}
        >
          <Input
            value={draft.name}
            placeholder="My server"
            onChange={(e) => {
              nameAuto.current = false;
              patch({ name: e.target.value });
            }}
          />
        </Form.Item>
        <Flex justify="space-between" align="center" gap={token.margin}>
          <div>
            <Text>Premium server</Text>
            <br />
            <Text type="secondary">Only paid Minecraft accounts can join</Text>
          </div>
          <Switch
            checked={draft.onlineMode}
            onChange={(onlineMode) => patch({ onlineMode })}
          />
        </Flex>
      </Form>

      <Flex justify="space-between" gap={token.marginSM}>
        <Button icon={<LeftOutlined />} onClick={onBack}>
          Back
        </Button>
        <Flex gap={token.marginSM}>
          <Button icon={<SettingOutlined />} onClick={openAdvanced}>
            More options
          </Button>
          <Button type="primary" onClick={create}>
            Add server
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default IntroCreateServerStep;
