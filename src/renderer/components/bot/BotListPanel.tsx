import React, { useRef, useState } from 'react';
import {
  AutoComplete,
  Button,
  Form,
  Select,
  Typography,
  theme as antTheme,
} from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import {
  useSettingsStore,
  setSelectedBot,
  selectAlts,
  selectJNdata,
  selectScripts,
  selectSettings,
  updateScriptSettings,
} from '../../redux/settings';
import type { ActiveBotsType, Alt } from '../../../main/src/types';
import { ActiveBotsList } from './activeBotList';
import OnboardingHint from '../intro/OnboardingHint';

interface BotListPanelProps {
  selectedBot: ActiveBotsType[number] | null;
}

export const JoinBotCard: React.FC = () => {
  const settings = useSettingsStore(selectSettings);
  const alts = useSettingsStore(selectAlts);
  const scripts = useSettingsStore(selectScripts);
  const JNdata = useSettingsStore(selectJNdata);
  const [isLoading, setIsLoading] = useState(false);
  const [form] = Form.useForm<{ username: string; version: string }>();
  const cardRef = useRef<HTMLDivElement>(null);

  const scriptSettings = settings.scripts?.chat || {};

  const startScript = async () => {
    const values = form.getFieldsValue();
    if (!values.username) return;
    updateScriptSettings({
      optionId: 'username',
      value: values.username,
      scriptName: 'chat',
    });
    updateScriptSettings({
      optionId: 'version',
      value: values.version,
      scriptName: 'chat',
    });
    setIsLoading(true);
    await scripts.startScript({
      script: 'chat',
      arguments: { username: values.username, version: values.version },
    });
    setIsLoading(false);
  };

  const versionOptions = JNdata.versions.map((v) => ({ label: v, value: v }));

  return (
    <div ref={cardRef} style={{ padding: 16 }}>
      <OnboardingHint
        id="join"
        steps={[
          {
            title: 'Join the server',
            description:
              "Pick your alt and press Join server. Your bot shows up under Active bots once it's online.",
            target: () => cardRef.current,
          },
        ]}
      />
      <Typography.Text
        strong
        style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        Join with alt
      </Typography.Text>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          username: scriptSettings.username || '',
          version: scriptSettings.version || '1.8.9',
        }}
        style={{ marginTop: 12 }}
        requiredMark={false}
      >
        <Form.Item
          label="Username"
          name="username"
          style={{ marginBottom: 12 }}
        >
          <AutoComplete
            placeholder="Pick from alts or type a username"
            options={(alts ?? []).map((a: Alt) => ({ value: a.username }))}
            showSearch
          />
        </Form.Item>
        <Form.Item
          label="Minecraft version"
          name="version"
          style={{ marginBottom: 12 }}
        >
          <Select options={versionOptions} />
        </Form.Item>
      </Form>
      <Button
        type="primary"
        block
        loading={isLoading}
        icon={<PlayCircleOutlined />}
        onClick={startScript}
      >
        Join server
      </Button>
    </div>
  );
};

const BotListPanel: React.FC<BotListPanelProps> = ({ selectedBot }) => {
  const { token } = antTheme.useToken();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography.Text strong style={{ fontSize: 13 }}>
          Active bots
        </Typography.Text>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        <ActiveBotsList
          selectedBotId={selectedBot?.botId}
          onSelectBot={(bot) => setSelectedBot(bot)}
          compact
        />
      </div>
    </div>
  );
};

export default BotListPanel;
