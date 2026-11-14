import { Button, Flex, Typography, theme } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import type { LlmOptionsResult } from '../../../common/llm';

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(show).join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** The settings the AI wants to change, to apply or discard. */
const LlmOptionChanges = ({ result, onApply, onDiscard }: { result: LlmOptionsResult; onApply: () => void; onDiscard: () => void }) => {
  const { token } = theme.useToken();
  const nothing = !result.changes.length;
  return (
    <Flex
      vertical
      gap={token.marginXS}
      style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, padding: token.paddingSM }}
    >
      {nothing && <Typography.Text type="secondary">Nothing to change: the settings already match.</Typography.Text>}
      {result.changes.map((change) => (
        <Flex key={change.id} gap={token.marginXS} align="baseline" wrap>
          <Typography.Text strong>{change.label}</Typography.Text>
          <Typography.Text type="secondary" delete>
            {show(change.from)}
          </Typography.Text>
          <ArrowRightOutlined style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }} />
          <Typography.Text>{show(change.to)}</Typography.Text>
        </Flex>
      ))}
      {result.skipped.map((skip, index) => (
        <Typography.Text key={index} type="warning" style={{ fontSize: token.fontSizeSM }}>
          Skipped {skip.label} ({show(skip.value)}): {skip.reason}
        </Typography.Text>
      ))}
      <Flex gap={token.marginXS} justify="flex-end">
        <Button size="small" onClick={onDiscard}>
          {nothing ? 'Close' : 'Discard'}
        </Button>
        {!nothing && (
          <Button size="small" type="primary" onClick={onApply}>
            Apply {result.changes.length === 1 ? 'change' : `${result.changes.length} changes`}
          </Button>
        )}
      </Flex>
    </Flex>
  );
};

export default LlmOptionChanges;
