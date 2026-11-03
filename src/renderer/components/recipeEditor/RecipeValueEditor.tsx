import {
  CalculatorOutlined,
  CloseOutlined,
  DownOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import {
  Button,
  Dropdown,
  Input,
  InputNumber,
  Mentions,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import React, { useCallback, useMemo } from 'react';
import { literal, type RecipeValue } from '../../../common/recipeV3';
import type { RecipeInputDefinition } from '../../../common/recipeCatalog';
import { clone, type ScopeValue } from './recipeEditorUtils';
import DeferredRecipeInput, {
  useDeferredRecipeValue,
} from './DeferredRecipeInput';

const formulaName = (label: string, used: Set<string>) => {
  const base =
    label
      .replace(/^[^·]+·\s*/, '')
      .replace(/[^a-zA-Z0-9_]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((part, index) =>
        index ? part.charAt(0).toUpperCase() + part.slice(1) : part,
      )
      .join('') || 'value';
  let name = base.replace(/^[0-9]/, '_$&');
  let index = 2;
  while (used.has(name)) name = `${base}${index++}`;
  used.add(name);
  return name;
};

type MentionValue = ReturnType<typeof mentionOptions>[number];

const mentionOptions = (scope: ScopeValue[]) => {
  const used = new Set<string>();
  return scope.map((item) => ({
    name: formulaName(item.label, used),
    label: item.label,
    group: item.group,
    value: item.value,
  }));
};

const groupLabels = {
  bot: 'Current bot',
  variables: 'Earlier values',
  options: 'Plugin options',
  event: 'Event values',
  inputs: 'Function inputs',
} as const;

const groupedMentionOptions = (options: MentionValue[]) =>
  (Object.keys(groupLabels) as Array<keyof typeof groupLabels>).flatMap(
    (group) => {
      const values = options.filter((option) => option.group === group);
      if (!values.length) return [];
      return [
        {
          value: `__group_${group}`,
          label: groupLabels[group],
          disabled: true,
        },
        ...values.map((option) => ({
          value: option.name,
          label: option.label,
        })),
      ];
    },
  );

const sameValue = (left: RecipeValue, right: RecipeValue) =>
  JSON.stringify(left) === JSON.stringify(right);

const mentionForValue = (value: RecipeValue, options: MentionValue[]) =>
  options.find((option) => sameValue(option.value, value));

const templateText = (value: RecipeValue, options: MentionValue[]): string => {
  if (value.kind === 'literal') return String(value.value ?? '');
  if (value.kind !== 'template') return '';
  return value.parts
    .map((part) => {
      if (typeof part === 'string') return part;
      const option = mentionForValue(part, options);
      return option ? `@${option.name}` : '';
    })
    .join('');
};

const templateValue = (text: string, options: MentionValue[]): RecipeValue => {
  const byName = new Map(options.map((option) => [option.name, option]));
  const parts: Extract<RecipeValue, { kind: 'template' }>['parts'] = [];
  const expression = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(text))) {
    const option = byName.get(match[1]);
    if (!option) continue;
    if (option.value.kind === 'template') continue;
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(clone(option.value));
    cursor = match.index + match[0].length;
  }
  if (!parts.length) return literal(text);
  if (cursor < text.length) parts.push(text.slice(cursor));
  return { kind: 'template', parts };
};

function valueLabel(value: RecipeValue, scope: ScopeValue[]): string {
  if (value.kind === 'reference')
    return (
      scope.find((item) => sameValue(item.value, value))?.label ??
      'Value is no longer available'
    );
  if (value.kind === 'template') return 'Text made from several values';
  if (value.kind === 'formula') return value.expression || 'Write an equation';
  if (value.kind === 'expression') return 'Calculation';
  return String(value.value ?? '');
}

const ValueSourceButton: React.FC<{
  scope: ScopeValue[];
  includeFormula: boolean;
  compact?: boolean;
  onSelect: (value: RecipeValue) => void;
  onFormula?: () => void;
}> = ({ scope, includeFormula, compact, onSelect, onFormula }) => {
  const groups = (Object.keys(groupLabels) as Array<keyof typeof groupLabels>)
    .map((group) => ({
      group,
      values: scope.filter((item) => item.group === group),
    }))
    .filter(({ values }) => values.length);
  const items: MenuProps['items'] = [
    ...(groups.length
      ? groups.flatMap(({ group, values }, index) => [
          ...(index ? [{ type: 'divider' as const }] : []),
          {
            type: 'group' as const,
            key: `group:${group}`,
            label: groupLabels[group],
            children: values.map((item) => ({
              key: `value:${item.key}`,
              label: item.label,
            })),
          },
        ])
      : [
          {
            key: 'empty',
            label: 'No values are available yet',
            disabled: true,
          },
        ]),
    ...(includeFormula
      ? [
          { type: 'divider' as const },
          {
            key: 'formula',
            icon: <CalculatorOutlined />,
            label: 'Write an equation',
          },
        ]
      : []),
  ];

  return (
    <Tooltip title="Use a bot property, option, or earlier value">
      <Dropdown
        trigger={['click']}
        menu={{
          items,
          onClick: ({ key }) => {
            if (key === 'formula') return onFormula?.();
            const selected = scope.find((item) => `value:${item.key}` === key);
            if (selected) onSelect(clone(selected.value));
          },
        }}
      >
        <Button icon={<LinkOutlined />} aria-label="Choose a value">
          {!compact && (
            <>
              Use value <DownOutlined />
            </>
          )}
        </Button>
      </Dropdown>
    </Tooltip>
  );
};

const FormulaInput: React.FC<{
  value: Extract<RecipeValue, { kind: 'formula' }>;
  scope: ScopeValue[];
  onChange: (value: RecipeValue) => void;
}> = ({ value, scope, onChange }) => {
  const options = useMemo(() => mentionOptions(scope), [scope]);
  const optionByName = useMemo(
    () => new Map(options.map((option) => [option.name, option])),
    [options],
  );
  const syncReferences = useCallback(
    (expression: string) => {
      const names = [...expression.matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(
        (match) => match[1],
      );
      const references: NonNullable<
        Extract<RecipeValue, { kind: 'formula' }>['references']
      > = {};
      names.forEach((name) => {
        const selected = optionByName.get(name);
        if (selected && selected.value.kind !== 'formula')
          references[name] = clone(selected.value);
      });
      onChange({ kind: 'formula', expression, references });
    },
    [onChange, optionByName],
  );
  const deferred = useDeferredRecipeValue(value.expression, syncReferences);

  return (
    <div className="recipe-formula-editor">
      <Mentions
        prefix="@"
        value={deferred.draft}
        options={groupedMentionOptions(options)}
        placeholder="Example: @coins * 2 + 10"
        onFocus={deferred.onFocus}
        onBlur={deferred.onBlur}
        onChange={deferred.setDraft}
      />
      <Typography.Text type="secondary">
        Type an equation. Use @ to insert a value; calculations follow normal
        mathematical order (multiply/divide before add/subtract).
      </Typography.Text>
    </div>
  );
};

const TextTemplateInput: React.FC<{
  value: RecipeValue;
  scope: ScopeValue[];
  compact?: boolean;
  onChange: (value: RecipeValue) => void;
}> = ({ value, scope, compact, onChange }) => {
  const options = useMemo(() => mentionOptions(scope), [scope]);
  const externalText = useMemo(
    () => templateText(value, options),
    [options, value],
  );
  const commit = useCallback(
    (text: string) => onChange(templateValue(text, options)),
    [onChange, options],
  );

  const deferred = useDeferredRecipeValue(externalText, commit);

  return (
    <Mentions
      autoSize={!compact}
      prefix="@"
      value={deferred.draft}
      options={groupedMentionOptions(options)}
      placeholder={
        scope.length
          ? compact
            ? 'Enter a value or type @'
            : 'Type text, or use @ to add values'
          : undefined
      }
      onFocus={deferred.onFocus}
      onBlur={deferred.onBlur}
      onChange={deferred.setDraft}
    />
  );
};

export const RecipeValueEditor: React.FC<{
  value: RecipeValue;
  type?: string;
  choices?: RecipeInputDefinition['choices'];
  scope: ScopeValue[];
  compact?: boolean;
  loading?: boolean;
  placeholder?: string;
  renderLiteralInput?: (
    value: Extract<RecipeValue, { kind: 'literal' }>['value'],
    onChange: (
      value: Extract<RecipeValue, { kind: 'literal' }>['value'],
    ) => void,
  ) => React.ReactNode;
  onChange: (value: RecipeValue) => void;
}> = ({
  value,
  type = 'string',
  choices,
  scope,
  compact,
  loading,
  placeholder,
  renderLiteralInput,
  onChange,
}) => {
  const emptyValue = useMemo(
    () => literal(type === 'number' ? 0 : type === 'boolean' ? false : ''),
    [type],
  );
  const sourceButton = (
    <ValueSourceButton
      scope={scope}
      includeFormula={type === 'number'}
      compact={compact}
      onSelect={onChange}
      onFormula={() =>
        onChange({ kind: 'formula', expression: '', references: {} })
      }
    />
  );

  if (value.kind === 'formula') {
    return (
      <Space.Compact block>
        <div className="recipe-formula-control">
          <FormulaInput value={value} scope={scope} onChange={onChange} />
        </div>
        {sourceButton}
        <Button
          icon={<CloseOutlined />}
          aria-label="Use a fixed value instead"
          onClick={() => onChange(emptyValue)}
        />
      </Space.Compact>
    );
  }

  if (value.kind === 'literal' && renderLiteralInput) {
    return (
      <Space.Compact block>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renderLiteralInput(value.value, (next) => onChange(literal(next)))}
        </div>
        {sourceButton}
      </Space.Compact>
    );
  }

  if (value.kind === 'literal' && choices) {
    return (
      <Space.Compact block>
        <Select
          style={{ width: '100%' }}
          value={value.value as string | number | boolean}
          options={choices}
          loading={loading}
          placeholder={placeholder}
          onChange={(next) => onChange(literal(next))}
        />
        {sourceButton}
      </Space.Compact>
    );
  }

  if (
    !choices &&
    (type === 'string' || type === 'any') &&
    (value.kind === 'literal' || value.kind === 'template')
  ) {
    return (
      <Space.Compact block>
        <TextTemplateInput
          value={value}
          scope={scope}
          compact={compact}
          onChange={onChange}
        />
        {sourceButton}
      </Space.Compact>
    );
  }

  if (value.kind !== 'literal') {
    return (
      <Space.Compact block>
        <Input
          readOnly
          prefix={<LinkOutlined />}
          value={valueLabel(value, scope)}
        />
        {sourceButton}
        <Button
          icon={<CloseOutlined />}
          aria-label="Use a fixed value instead"
          onClick={() => onChange(emptyValue)}
        />
      </Space.Compact>
    );
  }

  if (type === 'number') {
    return (
      <Space.Compact block>
        <InputNumber
          style={{ width: '100%' }}
          value={Number(value.value ?? 0)}
          onChange={(next) => onChange(literal(next ?? 0))}
        />
        {sourceButton}
      </Space.Compact>
    );
  }
  if (type === 'boolean') {
    return (
      <div className="recipe-switch-value">
        <Switch
          checked={Boolean(value.value)}
          onChange={(next) => onChange(literal(next))}
        />
        <Typography.Text>{value.value ? 'Yes' : 'No'}</Typography.Text>
        {sourceButton}
      </div>
    );
  }
  return (
    <DeferredRecipeInput
      value={String(value.value ?? '')}
      placeholder={placeholder}
      onCommit={(next) => onChange(literal(next))}
    />
  );
};

export default RecipeValueEditor;
