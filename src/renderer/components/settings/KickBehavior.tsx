import React from 'react';
import { Table, Input, Select, Button, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import { KickBehaviorOptions } from '../../../common/CommonEnums';
import { KickBehaviorConfig, KickBehaviorRule } from '../../../main/src/types';

const { Text } = Typography;

interface SelectServerProps {
  changeSetting: (setting: { key: string; value: KickBehaviorConfig }) => void;
  value: KickBehaviorConfig;
  setting: any;
}



const actionOptions = [
  { label: 'Retry (Reconnect)', value: KickBehaviorOptions.RETRY },
  { label: 'Pause (Ask User)', value: KickBehaviorOptions.PAUSE },
  { label: 'Skip (Next Alt)', value: KickBehaviorOptions.SKIP },
];

const KickBehaviour: React.FC<SelectServerProps> = ({ changeSetting, value, setting }) => {
  const config: KickBehaviorConfig = value || {
    rules: [],
    defaultAction: KickBehaviorOptions.RETRY,
  };


  const handleConfigChange = (newConfig: KickBehaviorConfig) => {
    changeSetting({ key: setting.key, value: newConfig });
  };

  const addRule = () => {
    const newRule: KickBehaviorRule = {
      id: Date.now().toString(),
      kickMessage: '',
      action: KickBehaviorOptions.RETRY,
    };
    handleConfigChange({
      ...config,
      rules: [...config.rules, newRule],
    });
  };

  const deleteRule = (id: string) => {
    handleConfigChange({
      ...config,
      rules: config.rules.filter((rule) => rule.id !== id),
    });
  };

  const updateRule = (id: string, field: 'kickMessage' | 'action', value: string | KickBehaviorOptions) => {
    handleConfigChange({
      ...config,
      rules: config.rules.map((rule) =>
        rule.id === id ? { ...rule, [field]: value } : rule
      ),
    });
  };

  const updateDefaultAction = (action: KickBehaviorOptions) => {
    handleConfigChange({
      ...config,
      defaultAction: action,
    });
  };

  const columns: ColumnType<KickBehaviorRule>[] = [
    {
      title: 'Kick Message Contains',
      dataIndex: 'kickMessage',
      key: 'kickMessage',
      width: '60%',
      render: (text: string, record: KickBehaviorRule) => (
        <Input
          placeholder="e.g., 'receiving too many connections'"
          value={text}
          onChange={(e) => updateRule(record.id, 'kickMessage', e.target.value)}
        />
      ),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: '30%',
      render: (action: KickBehaviorOptions, record: KickBehaviorRule) => (
        <Select
          style={{ width: '100%' }}
          value={action}
          options={actionOptions}
          onChange={(value) => updateRule(record.id, 'action', value)}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: '10%',
      render: (_: any, record: KickBehaviorRule) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => deleteRule(record.id)}
        />
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '800px' }}>
      <div>
        <Table
          dataSource={config.rules}
          columns={columns}
          pagination={false}
          rowKey="id"
          locale={{ emptyText: 'No custom rules. Add one to customize kick behavior.' }}
          size="small"
          style={{ marginTop: '8px' }}
        />
        <Button
          type="dashed"
          onClick={addRule}
          icon={<PlusOutlined />}
          style={{ marginTop: '8px', width: '100%' }}
        >
          Add Rule
        </Button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
        <Text strong>Default Action (No Match):</Text>
        <Select
          style={{ flex: 1 }}
          value={config.defaultAction}
          options={actionOptions}
          onChange={updateDefaultAction}
        />
      </div>
    </div>
  );
};

export default KickBehaviour;
