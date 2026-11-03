import React, { ReactNode } from 'react';
import { Card, Flex, Typography, theme } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import Sparkline from './Sparkline';

const { Text, Link } = Typography;

type StatTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'link';

interface StatCardProps {
  title: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: StatTone;
  /** Secondary context line shown under the value. */
  hint?: ReactNode;
  /** No meaningful value yet: mutes the value and shows `action` as the hint. */
  empty?: boolean;
  action?: { label: string; onClick: () => void };
  /** Weekly values (oldest → newest) drawn as a sparkline; needs 2+ weeks. */
  trend?: number[];
  /** Formats a week's value for the sparkline hover. */
  trendFormat?: (value: number) => string;
  /** Bottom visual when there is no trend, e.g. a progress bar. */
  footer?: ReactNode;
}

const toneColor = (token: GlobalToken, tone: StatTone) => {
  switch (tone) {
    case 'success': return token.colorSuccess;
    case 'warning': return token.colorWarning;
    case 'danger': return token.colorError;
    case 'info': return token.colorInfo;
    case 'link': return token.colorLink;
    default: return `color-mix(in srgb, ${token.colorPrimary} 72%, ${token.colorWarning})`;
  }
};

const FOOTER_HEIGHT = 24;

const StatCard: React.FC<StatCardProps> = ({
  title, value, icon, tone = 'accent', hint, empty, action, trend, trendFormat = String, footer,
}) => {
  const { token } = theme.useToken();
  const color = toneColor(token, tone);

  return (
    <Card style={{ height: '100%' }} styles={{ body: { padding: token.padding, height: '100%' } }}>
      <Flex vertical gap={token.paddingXXS} style={{ height: '100%' }}>
        <Flex align="center" gap={token.paddingXS} style={{ marginBottom: token.paddingXS }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: token.borderRadiusSM,
              background: `color-mix(in srgb, ${color} 15%, transparent)`,
              color,
              fontSize: 16,
            }}
          >
            {icon}
          </span>
          <Text type="secondary" ellipsis>{title}</Text>
        </Flex>
        <Text
          strong
          ellipsis
          type={empty ? 'secondary' : undefined}
          style={{
            display: 'block',
            fontSize: token.fontSizeHeading3,
            lineHeight: 1.25,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </Text>
        {empty && action ? (
          <Link onClick={action.onClick} ellipsis style={{ fontSize: token.fontSizeSM }}>
            {action.label}
          </Link>
        ) : (
          <Text type="secondary" ellipsis style={{ fontSize: token.fontSizeSM }}>
            {hint ?? ' '}
          </Text>
        )}
        <div
          style={{
            marginTop: 'auto',
            paddingTop: token.paddingXS,
            height: FOOTER_HEIGHT + token.paddingXS,
            display: 'flex',
            alignItems: 'flex-end',
          }}
        >
          {trend && trend.length > 1 && trend.some(Boolean)
            ? <Sparkline values={trend} color={color} format={trendFormat} />
            : footer}
        </div>
      </Flex>
    </Card>
  );
};

export type { StatCardProps, StatTone };
export default StatCard;
