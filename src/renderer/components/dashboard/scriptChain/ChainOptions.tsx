import type { ChainOptionsPanelData } from 'renderer/components/other/botSideBar/panelTabs';
import { useState } from 'react';
import { Button, Collapse, Form, Input, Space } from 'antd';
import type { ChainOptions as ChainRunOptions } from '../../../../main/src/types';
import Option from '../../general/scriptSettings/SettingOptions/Option';
import {
  useSettingsStore,
  selectActiveServerGamemodes,
} from '../../../redux/settings';
import { CHAIN_OPTIONS_SCHEME } from './chainOptionsScheme';
import { usePanelContext } from '../../other/botSideBar/SidePanelContextProvider';

export default function ChainOptions({
  options,
  creating,
  onSave,
}: ChainOptionsPanelData) {
  const { setPanel } = usePanelContext();
  const onClose = () =>
    setPanel((current) => ({ ...current, active: false, data: undefined }));
  const [form] = Form.useForm<ChainRunOptions>();
  const [values, setValues] = useState(options);
  const gamemodes = useSettingsStore(selectActiveServerGamemodes);
  const renderOptions = (section: (typeof CHAIN_OPTIONS_SCHEME)[number]) =>
    section.options.map((option) => (
      <Option
        key={option.id}
        option={
          option.type === 'gamemodeSelect'
            ? { ...option, gamemodes }
            : option
        }
        value={Reflect.get(values, option.id) ?? option.defaultValue}
        onChange={(value, field) => {
          form.setFields([{ name: field.id, value, errors: [] }]);
          setValues((current) => ({ ...current, [field.id]: value }));
        }}
      />
    ));

  const save = (values: ChainRunOptions) => {
    const errors = [
      {
        name: 'name',
        errors: values.name?.trim() ? [] : ['Enter a chain name.'],
      },
      {
        name: 'gamemode',
        errors: values.gamemode || !gamemodes.length ? [] : ['Choose a gamemode.'],
      },
    ];
    form.setFields(errors);
    if (errors.some((field) => field.errors.length)) return;
    onSave({
      ...options,
      ...values,
      name: values.name.trim(),
      description: values.description?.trim(),
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        gap: 16,
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={options}
        onFinish={save}
      >
        {renderOptions(CHAIN_OPTIONS_SCHEME[0])}
        <Form.Item
          name="description"
          label="Description"
        >
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={300}
            placeholder="What does this chain do?"
          />
        </Form.Item>
        <Collapse
          items={[
            {
              key: 'alts',
              label: 'Alt selection',
              children: renderOptions(CHAIN_OPTIONS_SCHEME[1]),
            },
          ]}
        />
      </Form>
      <Space style={{ marginTop: 'auto', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="primary" onClick={() => form.submit()}>
          {creating ? 'Create chain' : 'Save settings'}
        </Button>
      </Space>
    </div>
  );
}
