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
    <Card title="Join server" style={{ maxWidth: 600 }}>
      <Form
        form={form}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{
          username: currentBot?.username || scriptSettings.username || '',
          version: currentBot?.version || scriptSettings.version || '1.8.9',
        }}
      >
        <Form.Item label="username:" name="username">
          <AutoComplete
            disabled={!!currentBot}
            options={(alts ?? []).map((a: Alt) => ({ value: a.username }))}
            showSearch
          />
        </Form.Item>

        <Form.Item label="Minecraft Version" name="version">
          <Select disabled={!!currentBot} options={options} />
        </Form.Item>
      </Form>
      <br />
      <Button
        loading={isLoading}
        onClick={startScript}
        block
        type='primary'
      >
        Join server
      </Button>
    </Card>
  );
};

export default JoinServer;
