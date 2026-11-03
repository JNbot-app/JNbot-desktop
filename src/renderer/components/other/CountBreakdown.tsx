import React from 'react';
import { Collapse, Flex, Tag, Typography, theme } from 'antd';

export type CountGroups = [string, Record<string, number>][];

/** A row whose background fills proportionally to `ratio`, with the label and count on top. */
const CountRow: React.FC<{ name: string; amount: number; ratio: number }> = ({
  name,
  amount,
  ratio,
}) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: token.borderRadius,
        background: token.colorFillQuaternary,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${ratio * 100}%`,
          background: token.colorPrimaryBg,
        }}
      />
      <Flex
        justify="space-between"
        gap="small"
        style={{ position: 'relative', padding: '4px 10px' }}
      >
        <Typography.Text ellipsis>{name}</Typography.Text>
        <Typography.Text strong>{amount}</Typography.Text>
      </Flex>
    </div>
  );
};

/** Collapsible per-group breakdown, each item shown as a bar relative to the group's largest. */
const CountBreakdown: React.FC<{ groups: CountGroups }> = ({ groups }) => (
  <Collapse
    accordion
    ghost
    items={groups.map(([group, counts]) => {
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const total = rows.reduce((sum, [, n]) => sum + n, 0);
      return {
        key: group,
        label: (
          <Flex justify="space-between" align="center">
            <Typography.Text strong>{group}</Typography.Text>
            <Tag variant="filled" style={{ margin: 0 }}>
              {total}
            </Tag>
          </Flex>
        ),
        children: (
          <Flex vertical gap={4}>
            {rows.map(([name, amount]) => (
              <CountRow
                key={name}
                name={name}
                amount={amount}
                ratio={amount / rows[0][1]}
              />
            ))}
          </Flex>
        ),
      };
    })}
  />
);

export default CountBreakdown;
