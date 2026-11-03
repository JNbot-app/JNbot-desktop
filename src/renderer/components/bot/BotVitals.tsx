import { FC } from 'react';
import { Flex, Progress, Typography, theme as antTheme } from 'antd';
import type { InfoData } from './types';

const Vital: FC<{
  label: string;
  percent: number;
  value: number;
  color: string;
}> = ({ label, percent, value, color }) => (
  <Flex align="center" gap={8} style={{ minWidth: 0 }}>
    <Typography.Text type="secondary" style={{ fontSize: 11, width: 44 }}>
      {label}
    </Typography.Text>
    <Progress
      percent={Math.min(100, Math.max(0, percent))}
      showInfo={false}
      size="small"
      strokeColor={color}
      style={{ flex: 1, margin: 0, minWidth: 0 }}
    />
    <Typography.Text
      style={{
        fontSize: 12,
        minWidth: 18,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Typography.Text>
  </Flex>
);

/** Health, hunger and XP bars; each only shows once the bot reports it. */
const BotVitals: FC<{ info: InfoData }> = ({ info }) => {
  const { token } = antTheme.useToken();

  return (
    <div style={{ marginBottom: 20 }}>
      <Typography.Text
        strong
        style={{
          fontSize: 11,
          letterSpacing: 1,
          textTransform: 'uppercase',
          display: 'block',
          marginBottom: 12,
        }}
      >
        Vitals
      </Typography.Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          columnGap: 16,
          rowGap: 8,
        }}
      >
        {info.health !== undefined && (
          <Vital
            label="Health"
            percent={(info.health / 20) * 100}
            value={info.health}
            color={token.colorError}
          />
        )}
        {info.hunger !== undefined && (
          <Vital
            label="Hunger"
            percent={(info.hunger / 20) * 100}
            value={info.hunger}
            color={token.colorWarning}
          />
        )}
        {info.level !== undefined && (
          <Vital
            label="XP"
            percent={(info.xpProgress ?? 0) * 100}
            value={info.level}
            color={token.colorSuccess}
          />
        )}
      </div>
    </div>
  );
};

export default BotVitals;
