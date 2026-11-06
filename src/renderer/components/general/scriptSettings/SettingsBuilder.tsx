import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { FormInstance } from 'antd';
import {
  useSettingsStore,
  selectActiveServerGamemodes,
} from '../../../redux/settings';
import {
  SCRIPT_KIND_LABELS,
  SCRIPT_KINDS,
} from '../../../../common/scriptKinds';
import {
  AimOutlined,
  AppstoreOutlined,
  CheckOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  EditOutlined,
  FontSizeOutlined,
  HolderOutlined,
  KeyOutlined,
  PlusOutlined,
  RobotOutlined,
  SlidersOutlined,
  TableOutlined,
  TagsOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import type { DraggableProvided, DropResult } from '@hello-pangea/dnd';
import type {
  ListField,
  ListFieldType,
  OptionTypes,
  ScriptSettingProps,
  ScriptSettingsSection,
} from './ScriptSettingsProps.d';

const { TextArea } = Input;
const { Text, Title, Paragraph } = Typography;

// ------------------------------- constants -------------------------------- //

const MAX_LABEL_LENGTH = 50;
const MAX_ID_LENGTH = 50;
const MAX_TOOLTIP_LENGTH = 1000;
const MAX_SECTION_NAME = 40;
const MAX_OPTIONS = 50;
const MAX_LIST_FIELDS = 6;
const ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type TypeMeta = {
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
};

const TYPE_META: Record<OptionTypes, TypeMeta> = {
  input: {
    label: 'Text Input',
    description: 'Free-form text, number, or password field.',
    icon: <FontSizeOutlined />,
    color: 'blue',
  },
  select: {
    label: 'Single Select',
    description: 'Pick one of a defined list of options.',
    icon: <UnorderedListOutlined />,
    color: 'geekblue',
  },
  multiSelect: {
    label: 'Multi Select',
    description: 'Pick zero or more options from a list.',
    icon: <CheckSquareOutlined />,
    color: 'cyan',
  },
  slider: {
    label: 'Slider',
    description: 'Numeric slider with min, max, and step.',
    icon: <SlidersOutlined />,
    color: 'gold',
  },
  switch: {
    label: 'Switch',
    description: 'Boolean on/off toggle.',
    icon: <CheckOutlined />,
    color: 'green',
  },
  altSelect: {
    label: 'Alt Select',
    description: 'Pick one alt account.',
    icon: <UserOutlined />,
    color: 'orange',
  },
  altsSelect: {
    label: 'Alts Select',
    description: 'Pick multiple alt accounts.',
    icon: <TeamOutlined />,
    color: 'volcano',
  },
  altRange: {
    label: 'Alt Range',
    description: 'Process a contiguous slice of the alt list.',
    icon: <ColumnWidthOutlined />,
    color: 'red',
  },
  tagsSelect: {
    label: 'Alt Tags Select',
    description: 'Pick one or more alt tags.',
    icon: <TagsOutlined />,
    color: 'purple',
  },
  gamemodeSelect: {
    label: 'Gamemode Select',
    description:
      'Pick one or (with "Allow Multiple") several gamemodes, predefined per server.',
    icon: <AppstoreOutlined />,
    color: 'lime',
  },
  list: {
    label: 'List',
    description: 'A repeatable row of fields with up to 6 columns.',
    icon: <TableOutlined />,
    color: 'magenta',
  },
  coordinate: {
    label: 'Coordinate',
    description: 'Minecraft 3D coordinate (X / Y / Z).',
    icon: <AimOutlined />,
    color: 'gold',
  },
  keybind: {
    label: 'Keybind',
    description: 'Capture a single key or key combination.',
    icon: <KeyOutlined />,
    color: 'purple',
  },
  activeBotSelect: {
    label: 'Active Bot Select',
    description: 'Pick an active bot or Minecraft client.',
    icon: <RobotOutlined />,
    color: 'cyan',
  },
  scriptSelect: {
    label: 'Script Select',
    description: 'Pick one or more scripts, actions, recordings or chains.',
    icon: <CodeOutlined />,
    color: 'geekblue',
  },
};

const TYPE_ORDER: OptionTypes[] = [
  'input',
  'select',
  'multiSelect',
  'slider',
  'switch',
  'coordinate',
  'keybind',
  'list',
  'altSelect',
  'altsSelect',
  'altRange',
  'tagsSelect',
  'gamemodeSelect',
  'activeBotSelect',
  'scriptSelect',
];

const FIELDS_BY_TYPE: Record<OptionTypes, string[]> = {
  input: ['inputType', 'defaultValue', 'placeholder'],
  select: ['options', 'defaultValue', 'clearable', 'freeSolo'],
  multiSelect: ['options', 'defaultValue', 'freeSolo'],
  slider: ['min', 'max', 'step', 'defaultValue'],
  switch: ['defaultValue', 'labelChecked', 'labelUnchecked'],
  gamemodeSelect: ['defaultValue', 'multiple'],
  altSelect: ['defaultValue', 'clearable', 'freeSolo'],
  altsSelect: ['defaultValue'],
  tagsSelect: ['defaultValue'],
  altRange: [],
  list: ['fields', 'addLabel', 'minItems', 'maxItems'],
  coordinate: ['defaultValue', 'withDimension'],
  keybind: ['defaultValue', 'simple'],
  activeBotSelect: ['defaultValue', 'multiple', 'botFilter', 'clearable'],
  scriptSelect: ['kinds', 'multiple', 'clearable'],
};

const TYPE_SPECIFIC_FIELDS_ALL = Array.from(
  new Set(Object.values(FIELDS_BY_TYPE).flat()),
);

const VALUE_BY_FIELD_TYPES: OptionTypes[] = [
  'input',
  'select',
  'gamemodeSelect',
  'altSelect',
  'keybind',
  'activeBotSelect',
];

// Curated subset of types that can appear as columns inside a `list`. No
// nested lists, and complex aggregate types are excluded.
const LIST_FIELD_TYPES: ListFieldType[] = [
  'input',
  'switch',
  'slider',
  'select',
  'altSelect',
];

// ------------------------------- helpers ---------------------------------- //

const slugify = (s: string): string => {
  const normalized = (s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!normalized) return '';

  const parts = normalized.split(/\s+/).filter(Boolean);
  const camel = parts
    .map((part, index) => {
      if (index === 0) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');

  return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};


// --------------------------- keybind capture ------------------------------ //

const KeybindCapture: React.FC<{
  value?: string;
  onChange?: (v: string | undefined) => void;
  simple?: boolean;
}> = ({ value, onChange, simple }) => {
  const [capturing, setCapturing] = useState(false);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.shiftKey) mods.push('Shift');
    if (e.altKey) mods.push('Alt');
    if (e.metaKey) mods.push('Meta');
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    const combo = [...mods, key].join('+');
    if (simple && combo.includes('+')) return;
    onChange?.(combo);
    setCapturing(false);
    e.currentTarget.blur();
  };

  return (
    <Input
      readOnly
      value={capturing ? 'Press a key…' : value || ''}
      placeholder="Click then press a key"
      onFocus={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={handleKey}
      allowClear
      onChange={(e) => {
        // Only triggered by allowClear
        if (!e.target.value) onChange?.(undefined);
      }}
    />
  );
};

// --------------------------- coordinate editor ---------------------------- //

const CoordinateInput: React.FC<{
  value?: { x?: number; y?: number; z?: number };
  onChange?: (v: { x?: number; y?: number; z?: number } | undefined) => void;
}> = ({ value, onChange }) => {
  const v = value || {};
  const patch = (next: Partial<typeof v>) => {
    const merged = { ...v, ...next };
    const empty =
      merged.x === undefined &&
      merged.y === undefined &&
      merged.z === undefined;
    onChange?.(empty ? undefined : merged);
  };
  return (
    <Space.Compact block>
      <Space.Compact style={{ flex: 1 }}>
        <Input value="X" readOnly style={{ width: 40, textAlign: 'center' }} />
        <InputNumber
          value={v.x ?? null}
          onChange={(n) => patch({ x: n ?? undefined })}
          style={{ width: '100%' }}
        />
      </Space.Compact>
      <Space.Compact style={{ flex: 1 }}>
        <Input value="Y" readOnly style={{ width: 40, textAlign: 'center' }} />
        <InputNumber
          value={v.y ?? null}
          onChange={(n) => patch({ y: n ?? undefined })}
          style={{ width: '100%' }}
        />
      </Space.Compact>
      <Space.Compact style={{ flex: 1 }}>
        <Input value="Z" readOnly style={{ width: 40, textAlign: 'center' }} />
        <InputNumber
          value={v.z ?? null}
          onChange={(n) => patch({ z: n ?? undefined })}
          style={{ width: '100%' }}
        />
      </Space.Compact>
    </Space.Compact>
  );
};

// --------------------------- setting modal -------------------------------- //

interface SettingModalProps {
  open: boolean;
  onCancel: () => void;
  onSave: (setting: ScriptSettingProps) => void;
  setting?: ScriptSettingProps;
  existingIds: Set<string>;
  sections: ScriptSettingsSection[];
}

const SettingModal: React.FC<SettingModalProps> = ({
  open,
  onCancel,
  onSave,
  setting,
  existingIds,
  sections,
}) => {
  const [form] = Form.useForm();
  // Seed the type from the setting being edited. Without this fallback the
  // first render (before the open effect runs setFieldsValue) would default to
  // 'input', mounting input's own `defaultValue` field. When the type then
  // switches to the real type, preserve={false} deletes `defaultValue` from the
  // store as the input field unmounts — wiping the value we just restored.
  const currentType: OptionTypes =
    (Form.useWatch('type', form) as OptionTypes) || setting?.type || 'input';
  const currentId = Form.useWatch('id', form) as string | undefined;
  const isEdit = !!setting;
  const lastTypeRef = useRef<OptionTypes | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      lastTypeRef.current = undefined;
      return;
    }
    form.resetFields();
    if (setting) {
      form.setFieldsValue({ ...setting });
    } else {
      form.setFieldsValue({ type: 'input' });
    }
    lastTypeRef.current = (setting?.type as OptionTypes) || 'input';
  }, [open, setting, form]);

  const handleValuesChange = (changedValues: Partial<ScriptSettingProps>) => {
    if (!open || !changedValues.type) return;

    const nextType = changedValues.type as OptionTypes;
    if (lastTypeRef.current !== undefined && lastTypeRef.current !== nextType) {
      const clear: Record<string, undefined> = {};
      for (const f of TYPE_SPECIFIC_FIELDS_ALL) clear[f] = undefined;
      form.setFieldsValue(clear);
    }
    lastTypeRef.current = nextType;
  };

  const handleLabelBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (isEdit) return;
    if (!form.getFieldValue('id')) {
      form.setFieldValue('id', slugify(e.target.value));
    }
  };

  const handleSuggestId = () => {
    const label = form.getFieldValue('label') || '';
    form.setFieldValue('id', slugify(label));
    form.validateFields(['id']).catch(() => {});
  };

  const dependencySources = useMemo<DependencySourceOption[]>(() => {
    return sections
      .flatMap((section) => section.options)
      .filter(
        (option) =>
          option.id !== currentId &&
          VALUE_BY_FIELD_TYPES.includes(option.type) &&
          !option.valueByFieldId,
      );
  }, [sections, currentId]);

  const handleSave = async () => {
    let values: Record<string, unknown>;
    try {
      values = (await form.validateFields()) as Record<string, unknown>;
    } catch (err) {
      console.error('Form validation error:', err);
      return;
    }
    const type = values.type as OptionTypes;
    const result: Record<string, unknown> = {
      id: (values.id as string).trim(),
      label: (values.label as string).trim(),
      type,
    };
    if (typeof values.tooltip === 'string' && values.tooltip.trim()) {
      result.tooltip = values.tooltip.trim();
    }
    if (values.required) {
      result.required = true;
    }
    for (const [key, value] of Object.entries(values)) {
      if (['id', 'label', 'type', 'tooltip', 'required'].includes(key)) continue;
      const v = value;
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      result[key] = v;
    }

    onSave(result as unknown as ScriptSettingProps);
  };

  return (
    <Modal
      title={isEdit ? 'Edit Option' : 'Add Option'}
      open={open}
      onCancel={onCancel}
      onOk={handleSave}
      okText={isEdit ? 'Save' : 'Add'}
      width={700}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        onValuesChange={handleValuesChange}
      >
        <Form.Item
          name="type"
          label="Option Type"
          rules={[{ required: true, message: 'Pick a type' }]}
        >
          <Select
            options={TYPE_ORDER.map((t) => ({
              value: t,
              label: (
                <Space>
                  <Text type="secondary">{TYPE_META[t].icon}</Text>
                  <span>{TYPE_META[t].label}</span>
                </Space>
              ),
            }))}
          />
        </Form.Item>

      
        <Form.Item
          name="label"
          label="Label"
          rules={[
            { required: true, message: 'Label is required' },
            { whitespace: true, message: 'Label cannot be blank' },
            {
              max: MAX_LABEL_LENGTH,
              message: `Max ${MAX_LABEL_LENGTH} characters`,
            },
          ]}
        >
          <Input
            placeholder="e.g. Movement speed"
            showCount
            maxLength={MAX_LABEL_LENGTH}
            onBlur={handleLabelBlur}
          />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <span>Setting ID</span>
              <Tooltip title="Unique key used to read this setting from your script.">
                <Text type="secondary" style={{ fontWeight: 'normal' }}>
                  (script key)
                </Text>
              </Tooltip>
            </Space>
          }
          required
        >
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item
              name="id"
              noStyle
              rules={[
                { required: true, message: 'ID is required' },
                {
                  max: MAX_ID_LENGTH,
                  message: `Max ${MAX_ID_LENGTH} characters`,
                },
                {
                  pattern: ID_PATTERN,
                  message:
                    'Use letters, digits and underscores; must start with a letter or underscore',
                },
                {
                  validator: (_, value: string) => {
                    if (value && existingIds.has(value)) {
                      return Promise.reject(
                        new Error('This ID is already used'),
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input placeholder="movement_speed" />
            </Form.Item>
            <Button onClick={handleSuggestId}>Suggest</Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item
          name="tooltip"
          label="Tooltip"
          rules={[
            {
              max: MAX_TOOLTIP_LENGTH,
              message: `Max ${MAX_TOOLTIP_LENGTH} characters`,
            },
          ]}
        >
          <TextArea
            rows={2}
            placeholder="Optional help text shown next to the field"
            showCount
            maxLength={MAX_TOOLTIP_LENGTH}
          />
        </Form.Item>

        <Form.Item
          name="required"
          valuePropName="checked"
          label="Required"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="valueByFieldId"
          label="Value depends on"
          tooltip="Store one value per selected field value."
        >
          <Select
            allowClear
            disabled={dependencySources.length === 0}
            placeholder={
              dependencySources.length === 0
                ? 'No eligible fields'
                : 'Choose a string-valued field'
            }
            options={dependencySources.map((option) => ({
              value: option.id,
              label: `${option.label} (${option.id})`,
            }))}
          />
        </Form.Item>

        <TypeFields type={currentType} form={form} />
      </Form>
    </Modal>
  );
};

// --------------------------- type-specific fields ------------------------- //

interface TypeFieldsProps {
  type: OptionTypes;
  form: FormInstance;
}

const TypeFields: React.FC<TypeFieldsProps> = ({ type, form }) => {
  switch (type) {
    case 'input':
      return <InputTypeFields form={form} />;

    case 'select':
      return <SelectTypeFields form={form} />;

    case 'multiSelect':
      return <MultiSelectTypeFields form={form} />;

    case 'slider':
      return <SliderTypeFields form={form} />;

    case 'switch':
      return (
        <>
          <Form.Item
            name="defaultValue"
            valuePropName="checked"
            label="Default Value"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
          <Space.Compact block>
            <Form.Item
              name="labelChecked"
              label="Label (on)"
              rules={[{ max: 20, message: 'Max 20 characters' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Enabled" />
            </Form.Item>
            <Form.Item
              name="labelUnchecked"
              label="Label (off)"
              rules={[{ max: 20, message: 'Max 20 characters' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Disabled" />
            </Form.Item>
          </Space.Compact>
        </>
      );

    case 'gamemodeSelect':
      return <GamemodeTypeFields />;

    case 'activeBotSelect':
      return <ActiveBotTypeFields />;

    case 'scriptSelect':
      return <ScriptTypeFields />;

    case 'altSelect':
      return (
        <>
          <Form.Item
            name="defaultValue"
            label="Default Alt"
            rules={[{ max: 60, message: 'Max 60 characters' }]}
          >
            <Input placeholder="Alt username (optional)" />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item
              name="clearable"
              valuePropName="checked"
              label="Clearable"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="freeSolo"
              valuePropName="checked"
              label="Allow Custom"
            >
              <Switch />
            </Form.Item>
          </Space>
        </>
      );

    case 'altsSelect':
    case 'tagsSelect':
      return (
        <Form.Item name="defaultValue" label="Default Values">
          <Select mode="tags" placeholder="Optional default entries" />
        </Form.Item>
      );

    case 'coordinate':
      return (
        <>
          <Form.Item name="defaultValue" label="Default Coordinate">
            <CoordinateInput />
          </Form.Item>
          <Form.Item
            name="withDimension"
            valuePropName="checked"
            label="Include Dimension"
            tooltip="Adds an overworld / nether / end picker to the coordinate."
          >
            <Switch />
          </Form.Item>
        </>
      );

    case 'keybind':
      return (
        <>
          <Form.Item name="defaultValue" label="Default Keybind">
            <KeybindCapture />
          </Form.Item>
          <Form.Item
            name="simple"
            valuePropName="checked"
            label="Single Key Only"
            tooltip="Reject combos like Ctrl+S; only accept a single key."
          >
            <Switch />
          </Form.Item>
        </>
      );

    case 'list':
      return <ListTypeFields />;

    default:
      return null;
  }
};

// ---- input ------------------------------------------------------------- //

const InputTypeFields: React.FC<{ form: FormInstance }> = ({ form }) => {
  const inputType: 'text' | 'number' | 'password' =
    Form.useWatch('inputType', form) ?? 'text';

  return (
    <>
      <Form.Item name="inputType" label="Input Type" initialValue="text">
        <Select
          options={[
            { value: 'text', label: 'Text' },
            { value: 'number', label: 'Number' },
            { value: 'password', label: 'Password' },
          ]}
        />
      </Form.Item>
      <Form.Item
        name="placeholder"
        label="Placeholder"
        rules={[{ max: 60, message: 'Max 60 characters' }]}
      >
        <Input placeholder="Shown when the field is empty" />
      </Form.Item>
      <Form.Item
        name="defaultValue"
        label="Default Value"
        rules={
          inputType === 'number'
            ? []
            : [{ max: 100, message: 'Max 100 characters' }]
        }
      >
        {inputType === 'number' ? (
          <InputNumber
            style={{ width: '100%' }}
            placeholder="Optional default"
          />
        ) : inputType === 'password' ? (
          <Input.Password placeholder="Optional default" />
        ) : (
          <Input placeholder="Optional default" />
        )}
      </Form.Item>
    </>
  );
};

// ---- select ------------------------------------------------------------ //

const SelectTypeFields: React.FC<{ form: FormInstance }> = ({ form }) => {
  const options =
    (Form.useWatch('options', form) as
      | { label: string; value: string | number }[]
      | undefined) || [];

  const validValues = options
    .map((o) => o?.value)
    .filter((v) => v !== undefined && v !== '');

  return (
    <>
      <SelectOptionsList />
      <Form.Item
        name="defaultValue"
        label="Default Value"
        dependencies={['options']}
        rules={[
          {
            validator: (_, value) => {
              if (value === undefined || value === '' || value === null) {
                return Promise.resolve();
              }
              if (validValues.length === 0) return Promise.resolve();
              if (!validValues.includes(value)) {
                return Promise.reject(
                  new Error(
                    'Default must match one of the defined option values',
                  ),
                );
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Select
          allowClear
          placeholder={
            validValues.length === 0
              ? 'Define options first'
              : 'Pick a default (optional)'
          }
          options={options
            .filter((o) => o && o.value !== undefined && o.value !== '')
            .map((o) => ({
              value: o.value,
              label: o.label || String(o.value),
            }))}
        />
      </Form.Item>
      <Space size="large" wrap>
        <Form.Item name="clearable" valuePropName="checked" label="Clearable">
          <Switch />
        </Form.Item>
        <Form.Item
          name="freeSolo"
          valuePropName="checked"
          label="Allow Custom Values"
        >
          <Switch />
        </Form.Item>
      </Space>
    </>
  );
};

// ---- multiSelect ------------------------------------------------------- //

const MultiSelectTypeFields: React.FC<{ form: FormInstance }> = ({ form }) => {
  const options =
    (Form.useWatch('options', form) as string[] | undefined) || [];
  const valid = options.filter((o) => o && o.trim() !== '');

  return (
    <>
      <Form.Item
        name="options"
        label="Options"
        rules={[
          {
            validator: (_, value: string[] = []) => {
              if (value.length > MAX_OPTIONS) {
                return Promise.reject(new Error(`Max ${MAX_OPTIONS} options`));
              }
              const seen = new Set<string>();
              for (const v of value) {
                if (!v) continue;
                if (seen.has(v)) {
                  return Promise.reject(new Error('Options must be unique'));
                }
                seen.add(v);
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Select mode="tags" placeholder="Type each option then press Enter" />
      </Form.Item>
      <Form.Item
        name="defaultValue"
        label="Default Selected"
        dependencies={['options']}
        rules={[
          {
            validator: (_, value: string[] = []) => {
              if (valid.length === 0) return Promise.resolve();
              for (const v of value) {
                if (!valid.includes(v)) {
                  return Promise.reject(
                    new Error('Defaults must come from the defined options'),
                  );
                }
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Select
          mode="multiple"
          placeholder={
            valid.length === 0
              ? 'Define options first'
              : 'Pick defaults (optional)'
          }
          options={valid.map((v) => ({ value: v, label: v }))}
        />
      </Form.Item>
      <Form.Item
        name="freeSolo"
        valuePropName="checked"
        label="Allow Custom Values"
      >
        <Switch />
      </Form.Item>
    </>
  );
};

// ---- slider ------------------------------------------------------------ //

const SliderTypeFields: React.FC<{ form: FormInstance }> = ({ form }) => {
  const min = Form.useWatch('min', form);
  const max = Form.useWatch('max', form);
  const step = Form.useWatch('step', form);

  return (
    <>
      <Space.Compact block>
        <Form.Item
          name="min"
          label="Min"
          rules={[{ required: true, message: 'Required' }]}
          style={{ flex: 1 }}
          initialValue={0}
        >
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="max"
          label="Max"
          dependencies={['min']}
          rules={[
            { required: true, message: 'Required' },
            {
              validator: (_, value: number) => {
                const m = form.getFieldValue('min');
                if (
                  typeof m === 'number' &&
                  typeof value === 'number' &&
                  value <= m
                ) {
                  return Promise.reject(
                    new Error('Max must be greater than min'),
                  );
                }
                return Promise.resolve();
              },
            },
          ]}
          style={{ flex: 1 }}
          initialValue={100}
        >
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="step"
          label="Step"
          rules={[
            {
              validator: (_, value: number) => {
                if (value !== undefined && value <= 0) {
                  return Promise.reject(new Error('Step must be > 0'));
                }
                return Promise.resolve();
              },
            },
          ]}
          style={{ flex: 1 }}
          initialValue={1}
        >
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
      </Space.Compact>
      <Form.Item
        name="defaultValue"
        label="Default Value"
        dependencies={['min', 'max']}
        rules={[
          {
            validator: (_, value: number) => {
              if (value === undefined || value === null)
                return Promise.resolve();
              if (typeof min === 'number' && value < min) {
                return Promise.reject(new Error('Default below min'));
              }
              if (typeof max === 'number' && value > max) {
                return Promise.reject(new Error('Default above max'));
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <InputNumber
          style={{ width: '100%' }}
          min={typeof min === 'number' ? min : undefined}
          max={typeof max === 'number' ? max : undefined}
          step={typeof step === 'number' && step > 0 ? step : undefined}
        />
      </Form.Item>
    </>
  );
};

// ---- gamemodeSelect ---------------------------------------------------- //

const GamemodeTypeFields: React.FC = () => {
  const form = Form.useFormInstance();
  const gamemodes = useSettingsStore(selectActiveServerGamemodes);
  const multiple = !!Form.useWatch('multiple', form);

  return (
    <>
      <Form.Item
        name="multiple"
        valuePropName="checked"
        label="Allow Multiple"
        tooltip="When on, the user can pick several gamemodes and the value is stored as an array."
      >
        <Switch
          onChange={() => {
            // Single uses a string, multi uses an array — clear so the stored
            // default doesn't carry over in the wrong shape.
            form.setFieldValue('defaultValue', undefined);
          }}
        />
      </Form.Item>
      <Form.Item
        name="defaultValue"
        label={multiple ? 'Default Gamemodes' : 'Default Gamemode'}
      >
        {gamemodes.length > 0 ? (
          <Select
            allowClear
            mode={multiple ? 'multiple' : undefined}
            placeholder={
              multiple
                ? 'Pick default gamemodes (optional)'
                : 'Pick a default gamemode (optional)'
            }
            options={gamemodes.map((g) => ({ value: g, label: g }))}
            showSearch
          />
        ) : multiple ? (
          <Select
            mode="tags"
            allowClear
            placeholder="Default gamemodes (optional)"
          />
        ) : (
          <Input placeholder="Default gamemode (optional)" />
        )}
      </Form.Item>
    </>
  );
};

// ---- activeBotSelect ---------------------------------------------------- //

const ActiveBotTypeFields: React.FC = () => {
  const form = Form.useFormInstance();

  return (
    <>
      <Form.Item
        name="botFilter"
        label="Candidate Filter"
        tooltip="Choose which client types are allowed in the selector."
        initialValue="all"
      >
        <Select
          options={[
            { value: 'all', label: 'All (Bots & MC Clients)' },
            { value: 'bots', label: 'JNbot Bots Only' },
            { value: 'minecraft', label: 'Minecraft Clients Only' },
          ]}
        />
      </Form.Item>
      <Space size="large" wrap>
        <Form.Item
          name="multiple"
          valuePropName="checked"
          label="Allow Multiple"
          tooltip="When on, the user can pick several active bots/clients and the value is stored as an array."
        >
          <Switch
            onChange={() => {
              form.setFieldValue('defaultValue', undefined);
            }}
          />
        </Form.Item>
        <Form.Item
          name="clearable"
          valuePropName="checked"
          label="Clearable"
        >
          <Switch />
        </Form.Item>
      </Space>
      <Form.Item
        name="defaultValue"
        label="Default Active Bots"
      >
        <Select
          mode="tags"
          allowClear
          placeholder="Optional default usernames"
        />
      </Form.Item>
    </>
  );
};

// ---- scriptSelect ------------------------------------------------------- //

const ScriptTypeFields: React.FC = () => (
  <>
    <Form.Item
      name="kinds"
      label="Script Types"
      tooltip="Which kinds of script the user can pick from. Leave empty to offer all of them."
    >
      <Select
        mode="multiple"
        allowClear
        placeholder="All types"
        options={SCRIPT_KINDS.map((kind) => ({
          value: kind,
          label: SCRIPT_KIND_LABELS[kind],
        }))}
      />
    </Form.Item>
    <Space size="large" wrap>
      <Form.Item
        name="multiple"
        valuePropName="checked"
        label="Allow Multiple"
        tooltip="When on, the user can pick several scripts and the value is stored as an array of ids."
      >
        <Switch />
      </Form.Item>
      <Form.Item name="clearable" valuePropName="checked" label="Clearable">
        <Switch />
      </Form.Item>
    </Space>
  </>
);

// ---- list -------------------------------------------------------------- //

const ListTypeFields: React.FC = () => (
  <>
    <ListFieldsBuilder />
    <Space size="large" wrap style={{ marginTop: 8 }}>
      <Form.Item
        name="minItems"
        label="Min Rows"
        rules={[
          {
            validator: (_, value: number) => {
              if (value === undefined || value === null)
                return Promise.resolve();
              if (value < 0)
                return Promise.reject(new Error('Cannot be negative'));
              return Promise.resolve();
            },
          },
        ]}
      >
        <InputNumber min={0} placeholder="0" />
      </Form.Item>
      <Form.Item
        name="maxItems"
        label="Max Rows"
        dependencies={['minItems']}
        rules={[
          ({ getFieldValue }) => ({
            validator(_, value: number) {
              if (value === undefined || value === null)
                return Promise.resolve();
              const min = getFieldValue('minItems');
              if (value < 1)
                return Promise.reject(new Error('Must be at least 1'));
              if (typeof min === 'number' && value < min) {
                return Promise.reject(new Error('Max must be ≥ min'));
              }
              return Promise.resolve();
            },
          }),
        ]}
      >
        <InputNumber min={1} placeholder="∞" />
      </Form.Item>
      <Form.Item
        name="addLabel"
        label="Add-row Button Label"
        rules={[{ max: 30, message: 'Max 30 characters' }]}
      >
        <Input placeholder="Add row" />
      </Form.Item>
    </Space>
  </>
);

// ---- list fields sub-builder (unique-typed columns) -------------------- //

const ListFieldsBuilder: React.FC = () => (
  <Form.Item label="Columns" required style={{ marginBottom: 8 }}>
    <Form.List
      name="fields"
      rules={[
        {
          validator: async (_, fields: ListField[] = []) => {
            if (!fields || fields.length === 0) {
              return Promise.reject(new Error('Add at least one column'));
            }
            if (fields.length > MAX_LIST_FIELDS) {
              return Promise.reject(
                new Error(`At most ${MAX_LIST_FIELDS} columns`),
              );
            }
            const keys = new Set<string>();
            // const types = new Set<string>();
            for (const f of fields) {
              if (!f) continue;
              if (f.key) {
                if (keys.has(f.key)) {
                  return Promise.reject(
                    new Error('Column keys must be unique'),
                  );
                }
                keys.add(f.key);
              }
              // if (f.type) {
              //   if (types.has(f.type)) {
              //     return Promise.reject(
              //       new Error(
              //         `Only one column per type — "${f.type}" is used twice`,
              //       ),
              //     );
              //   }
              //   types.add(f.type);
              // }
            }
            return Promise.resolve();
          },
        },
      ]}
    >
      {(fields, { add, remove }, { errors }) => (
        <>
          {fields.map((field) => (
            <ListFieldRow
              key={field.key}
              fieldName={field.name}
              onRemove={() => remove(field.name)}
            />
          ))}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            disabled={fields.length >= MAX_LIST_FIELDS}
            onClick={() => add({ type: 'input', inputType: 'text' })}
          >
            Add column
          </Button>
          <Form.ErrorList errors={errors} />
        </>
      )}
    </Form.List>
  </Form.Item>
);

type DependencySourceOption = Pick<
  ScriptSettingProps,
  'id' | 'label' | 'type' | 'valueByFieldId'
>;

const ListFieldRow: React.FC<{
  fieldName: number;
  onRemove: () => void;
}> = ({ fieldName, onRemove }) => {
  const form = Form.useFormInstance();
  const subType: ListFieldType =
    (Form.useWatch(['fields', fieldName, 'type'], form) as ListFieldType) ||
    'input';
  const inputType: 'text' | 'number' | 'password' =
    Form.useWatch(['fields', fieldName, 'inputType'], form) ?? 'text';

  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Space.Compact block style={{ marginBottom: 8 }}>
        <Form.Item
          name={[fieldName, 'key']}
          rules={[
            { required: true, message: 'Key required' },
            { max: MAX_ID_LENGTH },
            {
              pattern: ID_PATTERN,
              message: 'Use letters, digits and underscores',
            },
          ]}
          style={{ flex: 1, marginBottom: 0 }}
        >
          <Input placeholder="column_key" />
        </Form.Item>
        <Form.Item
          name={[fieldName, 'label']}
          rules={[
            { required: true, message: 'Label required' },
            { max: 30, message: 'Max 30 characters' },
          ]}
          style={{ flex: 1, marginBottom: 0 }}
        >
          <Input placeholder="Column header" />
        </Form.Item>
        <Form.Item
          name={[fieldName, 'type']}
          rules={[{ required: true, message: 'Type required' }]}
          style={{ flex: 1, marginBottom: 0 }}
          initialValue="input"
        >
          <Select
            options={LIST_FIELD_TYPES.map((t) => ({
              value: t,
              label: (
                <Space>
                  {TYPE_META[t].icon}
                  <span>{TYPE_META[t].label}</span>
                </Space>
              ),
            }))}
          />
        </Form.Item>
        <Button danger icon={<DeleteOutlined />} onClick={onRemove} />
      </Space.Compact>

      {/* Per-type configuration */}
      {subType === 'input' && (
        <Space.Compact block>
          <Form.Item
            name={[fieldName, 'inputType']}
            initialValue="text"
            style={{ flex: 1, marginBottom: 0 }}
          >
            <Select
              options={[
                { value: 'text', label: 'Text' },
                { value: 'number', label: 'Number' },
                { value: 'password', label: 'Password' },
              ]}
            />
          </Form.Item>
          {inputType !== 'password' && (
            <Form.Item
              name={[fieldName, 'placeholder']}
              rules={[{ max: 30, message: 'Max 30' }]}
              style={{ flex: 2, marginBottom: 0 }}
            >
              <Input placeholder="Placeholder (optional)" />
            </Form.Item>
          )}
        </Space.Compact>
      )}

      {subType === 'slider' && (
        <Space.Compact block>
          <Form.Item
            name={[fieldName, 'min']}
            rules={[{ required: true, message: 'Min' }]}
            initialValue={0}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <Space.Compact block>
              <Input
                value="Min"
                readOnly
                style={{ width: 56, textAlign: 'center' }}
              />
              <InputNumber style={{ width: '100%' }} />
            </Space.Compact>
          </Form.Item>
          <Form.Item
            name={[fieldName, 'max']}
            rules={[{ required: true, message: 'Max' }]}
            initialValue={100}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <Space.Compact block>
              <Input
                value="Max"
                readOnly
                style={{ width: 56, textAlign: 'center' }}
              />
              <InputNumber style={{ width: '100%' }} />
            </Space.Compact>
          </Form.Item>
          <Form.Item
            name={[fieldName, 'step']}
            initialValue={1}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <Space.Compact block>
              <Input
                value="Step"
                readOnly
                style={{ width: 56, textAlign: 'center' }}
              />
              <InputNumber style={{ width: '100%' }} min={0} />
            </Space.Compact>
          </Form.Item>
        </Space.Compact>
      )}

      {subType === 'select' && (
        <Form.Item
          name={[fieldName, 'options']}
          rules={[
            {
              validator: async (
                _,
                value: { label: string; value: string | number }[] = [],
              ) => {
                if (!value || value.length === 0) {
                  return Promise.reject(new Error('Add at least one choice'));
                }
                return Promise.resolve();
              },
            },
          ]}
          style={{ marginBottom: 0 }}
        >
          <InlineSelectOptions />
        </Form.Item>
      )}
    </Card>
  );
};

// Compact label+value editor used inside list-field "select" config. Mirrors
// `SelectOptionsList` but accepts a controlled value via Form so it can live
// inside a Form.List nested item.
const InlineSelectOptions: React.FC<{
  value?: { label: string; value: string | number }[];
  onChange?: (v: { label: string; value: string | number }[]) => void;
}> = ({ value = [], onChange }) => {
  // Rows have no stable id of their own, so we track one per row in a ref and
  // keep it in lockstep with `value`. This keeps React identity stable across
  // add/remove (index keys would mis-map inputs when a middle row is removed).
  const counter = useRef(0);
  const idsRef = useRef<number[]>([]);
  if (idsRef.current.length !== value.length) {
    idsRef.current = value.map((_, i) => idsRef.current[i] ?? counter.current++);
  }
  const ids = idsRef.current;

  const update = (
    idx: number,
    patch: Partial<{ label: string; value: string | number }>,
  ) => {
    const next = value.map((v, i) => (i === idx ? { ...v, ...patch } : v));
    onChange?.(next);
  };
  const remove = (idx: number) => {
    idsRef.current = ids.filter((_, i) => i !== idx);
    onChange?.(value.filter((_, i) => i !== idx));
  };
  const add = () => {
    idsRef.current = [...ids, counter.current++];
    onChange?.([...value, { label: '', value: '' }]);
  };

  return (
    <div>
      {value.map((row, idx) => (
        <Space.Compact block key={ids[idx]} style={{ marginBottom: 4 }}>
          <Input
            placeholder="Display label"
            value={row.label}
            onChange={(e) => update(idx, { label: e.target.value })}
          />
          <Input
            placeholder="Stored value"
            value={String(row.value ?? '')}
            onChange={(e) => update(idx, { value: e.target.value })}
          />
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => remove(idx)}
          />
        </Space.Compact>
      ))}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={add}>
        Add choice
      </Button>
    </div>
  );
};

// ---- select options sub-editor (label + value pairs) -------------------- //

const SelectOptionsList: React.FC = () => (
  <Form.Item label="Options" required style={{ marginBottom: 16 }}>
    <Form.List
      name="options"
      rules={[
        {
          validator: async (_, value) => {
            if (!value || value.length === 0) {
              return Promise.reject(new Error('Add at least one option'));
            }
            if (value.length > MAX_OPTIONS) {
              return Promise.reject(new Error(`Max ${MAX_OPTIONS} options`));
            }
            const values = (value as { value: string | number }[]).map((v) =>
              String(v?.value ?? ''),
            );
            const seen = new Set<string>();
            for (const v of values) {
              if (!v) continue;
              if (seen.has(v)) {
                return Promise.reject(
                  new Error('Option values must be unique'),
                );
              }
              seen.add(v);
            }
            return Promise.resolve();
          },
        },
      ]}
    >
      {(fields, { add, remove, move }, { errors }) => (
        <>
          {fields.map((field, index) => (
            <Space.Compact
              key={field.key}
              style={{ width: '100%', marginBottom: 6 }}
            >
              <Form.Item
                name={[field.name, 'label']}
                rules={[
                  { required: true, message: 'Label required' },
                  { max: 40, message: 'Max 40 chars' },
                ]}
                style={{ flex: 1, marginBottom: 0 }}
              >
                <Input placeholder="Display label" />
              </Form.Item>
              <Form.Item
                name={[field.name, 'value']}
                rules={[
                  { required: true, message: 'Value required' },
                  { max: 40, message: 'Max 40 chars' },
                ]}
                style={{ flex: 1, marginBottom: 0 }}
              >
                <Input placeholder="Stored value" />
              </Form.Item>
              <Tooltip title="Move up">
                <Button
                  disabled={index === 0}
                  icon={<HolderOutlined />}
                  onClick={() => move(index, index - 1)}
                />
              </Tooltip>
              <Tooltip title="Remove">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                />
              </Tooltip>
            </Space.Compact>
          ))}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => add({ label: '', value: '' })}
          >
            Add option
          </Button>
          <Form.ErrorList errors={errors} />
        </>
      )}
    </Form.List>
  </Form.Item>
);

// --------------------------- section modal -------------------------------- //

interface SectionModalProps {
  open: boolean;
  onCancel: () => void;
  onSave: (values: { name: string; collapsed?: boolean }) => void;
  initial?: { name: string; collapsed?: boolean };
  existingNames: Set<string>;
}

const SectionModal: React.FC<SectionModalProps> = ({
  open,
  onCancel,
  onSave,
  initial,
  existingNames,
}) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initial) form.setFieldsValue(initial);
  }, [open, initial, form]);

  const handleOk = () => {
    form
      .validateFields()
      .then((values) =>
        onSave({ name: values.name.trim(), collapsed: !!values.collapsed }),
      )
      .catch(() => {});
  };

  return (
    <Modal
      title={initial ? 'Edit Section' : 'Add Section'}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText={initial ? 'Save' : 'Add'}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="Section Name"
          rules={[
            { required: true, message: 'Section name is required' },
            { whitespace: true, message: 'Section name cannot be blank' },
            {
              max: MAX_SECTION_NAME,
              message: `Max ${MAX_SECTION_NAME} characters`,
            },
            {
              validator: (_, value: string) => {
                if (value && existingNames.has(value.trim())) {
                  return Promise.reject(
                    new Error('A section with this name already exists'),
                  );
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input
            placeholder="e.g. Movement"
            showCount
            maxLength={MAX_SECTION_NAME}
          />
        </Form.Item>
        <Form.Item
          name="collapsed"
          valuePropName="checked"
          label="Collapsed by default"
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// --------------------------- main component ------------------------------- //

interface SettingsBuilderProps {
  sections: ScriptSettingsSection[];
  onChange: (sections: ScriptSettingsSection[]) => void;
  title?: string;
  description?: string;
}

const SettingsBuilder: React.FC<SettingsBuilderProps> = ({
  sections,
  onChange,
  title = 'Plugin Settings',
  description,
}) => {
  const { token } = theme.useToken();

  const [settingModal, setSettingModal] = useState<{
    open: boolean;
    sectionIndex: number;
    setting?: ScriptSettingProps;
  }>({ open: false, sectionIndex: 0 });

  const [sectionModal, setSectionModal] = useState<{
    open: boolean;
    index?: number;
  }>({ open: false });

  const [activeKeys, setActiveKeys] = useState<string[]>(() =>
    sections.map((_, i) => String(i)),
  );

  const allIds = useMemo(
    () => sections.flatMap((s) => s.options.map((o) => o.id)),
    [sections],
  );

  const idsExcludingEditing = useMemo(() => {
    const set = new Set(allIds);
    if (settingModal.setting) set.delete(settingModal.setting.id);
    return set;
  }, [allIds, settingModal.setting]);

  const sectionNamesExcludingEditing = useMemo(() => {
    const set = new Set(sections.map((s) => s.name));
    if (sectionModal.index !== undefined) {
      set.delete(sections[sectionModal.index].name);
    }
    return set;
  }, [sections, sectionModal.index]);

  // ----- section ops -----
  const openAddSection = () => setSectionModal({ open: true });
  const openEditSection = (index: number) =>
    setSectionModal({ open: true, index });

  const handleSaveSection = (values: { name: string; collapsed?: boolean }) => {
    const next = sections.map((s) => ({ ...s, options: [...s.options] }));
    if (sectionModal.index !== undefined) {
      next[sectionModal.index] = { ...next[sectionModal.index], ...values };
    } else {
      next.push({
        name: values.name,
        options: [],
        collapsed: values.collapsed,
      });
      setActiveKeys((keys) => [...keys, String(next.length - 1)]);
    }
    onChange(next);
    setSectionModal({ open: false });
  };

  const deleteSection = (index: number) => {
    onChange(sections.filter((_, i) => i !== index));
  };

  // ----- setting ops -----
  const openAddSetting = (sectionIndex: number) =>
    setSettingModal({ open: true, sectionIndex });

  const openEditSetting = (sectionIndex: number, settingIndex: number) =>
    setSettingModal({
      open: true,
      sectionIndex,
      setting: sections[sectionIndex].options[settingIndex],
    });

  const handleSaveSetting = (setting: ScriptSettingProps) => {
    const next = sections.map((s) => ({ ...s, options: [...s.options] }));
    const target = next[settingModal.sectionIndex];
    if (!target) return;
    const editing = settingModal.setting;
    if (editing) {
      const idx = target.options.findIndex((o) => o.id === editing.id);
      if (idx >= 0) target.options[idx] = setting;
      else target.options.push(setting);
    } else {
      target.options.push(setting);
    }
    onChange(next);
    setSettingModal({ open: false, sectionIndex: 0 });
  };

  const deleteSetting = (sectionIndex: number, settingIndex: number) => {
    const next = sections.map((s) => ({ ...s, options: [...s.options] }));
    next[sectionIndex].options.splice(settingIndex, 1);
    onChange(next);
  };

  // ----- drag and drop -----
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination } = result;
    const sourceSection = parseInt(source.droppableId.split('-')[1], 10);
    const destSection = parseInt(destination.droppableId.split('-')[1], 10);
    if (Number.isNaN(sourceSection) || Number.isNaN(destSection)) return;

    const next = sections.map((s) => ({ ...s, options: [...s.options] }));
    const [removed] = next[sourceSection].options.splice(source.index, 1);
    next[destSection].options.splice(destination.index, 0, removed);
    onChange(next);
  };

  const settingItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    marginBottom: 8,
    borderRadius: token.borderRadius,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorFillQuaternary,
  };

  const renderSettingRow = (
    _section: ScriptSettingsSection,
    sectionIndex: number,
    setting: ScriptSettingProps,
    settingIndex: number,
    dragProvided: DraggableProvided,
    isDragging: boolean,
  ) => {
    const meta = TYPE_META[setting.type] || TYPE_META.input;
    return (
      <div
        ref={dragProvided.innerRef}
        {...dragProvided.draggableProps}
        style={{
          ...dragProvided.draggableProps.style,
          ...settingItemStyle,
          background: isDragging
            ? token.colorPrimaryBg
            : settingItemStyle.background,
        }}
      >
        <span
          {...dragProvided.dragHandleProps}
          style={{
            cursor: 'grab',
            color: token.colorTextTertiary,
            display: 'flex',
          }}
        >
          <HolderOutlined />
        </span>
        <Tag color={meta.color} icon={meta.icon} style={{ margin: 0 }}>
          {meta.label}
        </Tag>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong ellipsis style={{ maxWidth: 260 }}>
              {setting.label}
            </Text>
            <Text type="secondary" code style={{ fontSize: 12 }}>
              {setting.id}
            </Text>
            {setting.required && (
              <Tag color="red" style={{ margin: 0 }}>
                required
              </Tag>
            )}
          </div>
          {setting.tooltip && (
            <Text
              type="secondary"
              style={{ fontSize: 12, display: 'block' }}
              ellipsis={{ tooltip: setting.tooltip }}
            >
              {setting.tooltip}
            </Text>
          )}
        </div>
        <Space>
          <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditSetting(sectionIndex, settingIndex)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this option?"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteSetting(sectionIndex, settingIndex)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ marginBottom: 4 }}>
          {title}
        </Title>
        {description && (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {description}
          </Paragraph>
        )}
      </div>

      <Space
        style={{
          width: '100%',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
  
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddSection}>
          Add Section
        </Button>
      </Space>

      {sections.length === 0 ? (
        <Card>
          <Empty description="No options yet">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openAddSection}
            >
              Create First Section
            </Button>
          </Empty>
        </Card>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Collapse
            activeKey={activeKeys}
            onChange={(k) =>
              setActiveKeys(Array.isArray(k) ? (k as string[]) : [k as string])
            }
            items={sections.map((section, sectionIndex) => ({
              key: String(sectionIndex),
              label: (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <Space>
                    <Text strong>{section.name}</Text>
                    <Tag color="blue">
                      {section.options.length}{' '}
                      {section.options.length === 1 ? 'option' : 'options'}
                    </Tag>
                    {section.collapsed && <Tag>collapsed by default</Tag>}
                  </Space>
                  <Space onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Edit section">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEditSection(sectionIndex)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="Delete this section and all its options?"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => deleteSection(sectionIndex)}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                      />
                    </Popconfirm>
                  </Space>
                </div>
              ),
              children: (
                <Droppable droppableId={`section-${sectionIndex}`}>
                  {(droppableProvided) => (
                    <div
                      ref={droppableProvided.innerRef}
                      {...droppableProvided.droppableProps}
                    >
                      {section.options.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="No options in this section"
                          style={{ padding: '12px 0' }}
                        >
                          <Button
                            type="dashed"
                            icon={<PlusOutlined />}
                            onClick={() => openAddSetting(sectionIndex)}
                          >
                            Add Option
                          </Button>
                        </Empty>
                      ) : (
                        <>
                          {section.options.map((setting, settingIndex) => (
                            <Draggable
                              key={setting.id}
                              draggableId={`${sectionIndex}-${setting.id}`}
                              index={settingIndex}
                            >
                              {(dragProvided, snapshot) =>
                                renderSettingRow(
                                  section,
                                  sectionIndex,
                                  setting,
                                  settingIndex,
                                  dragProvided,
                                  snapshot.isDragging,
                                )
                              }
                            </Draggable>
                          ))}
                          {droppableProvided.placeholder}
                          <Button
                            type="dashed"
                            block
                            icon={<PlusOutlined />}
                            onClick={() => openAddSetting(sectionIndex)}
                            style={{ marginTop: 4 }}
                          >
                            Add Option
                          </Button>
                        </>
                      )}
                      {section.options.length === 0 &&
                        droppableProvided.placeholder}
                    </div>
                  )}
                </Droppable>
              ),
            }))}
          />
        </DragDropContext>
      )}

      <SectionModal
        open={sectionModal.open}
        onCancel={() => setSectionModal({ open: false })}
        onSave={handleSaveSection}
        initial={
          sectionModal.index !== undefined
            ? {
                name: sections[sectionModal.index].name,
                collapsed: sections[sectionModal.index].collapsed,
              }
            : undefined
        }
        existingNames={sectionNamesExcludingEditing}
      />

      <SettingModal
        open={settingModal.open}
        onCancel={() => setSettingModal({ open: false, sectionIndex: 0 })}
        onSave={handleSaveSetting}
        setting={settingModal.setting}
        existingIds={idsExcludingEditing}
        sections={sections}
      />
    </div>
  );
};

export default SettingsBuilder;
