import React, { useState } from 'react';
import {
  useSettingsStore,
  selectSettings,
  selectAlts,
  updateScriptSettings,
  selectScripts,
  selectJNdata,
} from '../../redux/settings';
import { Card, Select, Form, Button, AutoComplete } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { SelectProps } from 'antd/lib';
import type { Alt } from '../../../../src/main/src/types.d.ts';

const JoinServer: React.FC = () => {
  const settings = useSettingsStore(selectSettings);
  const alts = useSettingsStore(selectAlts);
  const scripts = useSettingsStore(selectScripts);
  const [isLoading, setIsLoading] = useState(false);
  const JNdata = useSettingsStore(selectJNdata);
  const [form] = Form.useForm<{ username: string; version: string }>();

  let currentBot = undefined;
  const options: SelectProps['options'] = JNdata.versions.map((version) => ({
    label: version,
    value: version,
  }));

  let scriptSettings = settings.scripts?.chat || {};
  const saveSetting = (key: string, val: any) => {
    updateScriptSettings({ optionId: key, value: val, scriptName: 'chat' });
  };

  const startScript = async () => {
   
      const values = form.getFieldsValue();

      if (values.username !== currentBot?.username) {
        saveSetting('username', values.username);
      }
      if (values.version !== currentBot?.version) {
        saveSetting('version', values.version);
      }

      setIsLoading(true);
      await scripts.startScript({
        script: 'chat',
        arguments: { username: values.username, version: values.version },
      });
      setIsLoading(false);
    
  };

  return (
    <Card title="Join with alt" size="small">
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          username: currentBot?.username || scriptSettings.username || '',
          version: currentBot?.version || scriptSettings.version || '1.8.9',
        }}
      >
        <Form.Item label="Username" name="username" style={{ marginBottom: 12 }}>
          <AutoComplete
            placeholder="Pick from alts or type a username"
            disabled={!!currentBot}
            options={(alts ?? []).map((a: Alt) => ({ value: a.username }))}
            showSearch
          />
        </Form.Item>

        <Form.Item label="Minecraft version" name="version" style={{ marginBottom: 12 }}>
          <Select disabled={!!currentBot} options={options} />
        </Form.Item>
      </Form>
      <Button
        loading={isLoading}
        onClick={startScript}
        block
        type="primary"
        icon={<PlayCircleOutlined />}
      >
        Join server
      </Button>
    </Card>
  );
};

export default JoinServer;
