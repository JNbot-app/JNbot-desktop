import { FC } from 'react';
import { Card, theme, Typography } from 'antd';
import {
  DollarOutlined,
  NumberOutlined,
  ClockCircleOutlined,
  StarOutlined,
  TrophyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type {
  KpiItem,
  KpiSectionData,
} from '../../../../../common/profileUiSchema';
import { TONE_TO_HEX } from './toneColors';

const ICON_MAP: Record<string, JSX.Element> = {
  money: <DollarOutlined />,
  hash: <NumberOutlined />,
  clock: <ClockCircleOutlined />,
  star: <StarOutlined />,
  trophy: <TrophyOutlined />,
  bolt: <ThunderboltOutlined />,
};

const Kpi: FC<{ item: KpiItem }> = ({ item }) => {
  const { token } = theme.useToken();
  const color = item.tone ? TONE_TO_HEX[item.tone] : token.colorTextSecondary;
  const icon = item.icon ? ICON_MAP[item.icon] : null;
  return (
    <Card
      variant="borderless"
      size="small"
      style={{ background: token.colorBgContainer, height: '100%' }}
      styles={{ body: { padding: token.paddingSM } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {icon && (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `${color}1a`,
              color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              fontSize: 18,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 10,
              letterSpacing: 0.7,
              textTransform: 'uppercase',
              display: 'block',
              lineHeight: 1,
            }}
          >
            {item.label}
          </Typography.Text>
          <Typography.Text
            strong
            style={{
              fontSize: 18,
              display: 'block',
              marginTop: 4,
              lineHeight: 1,
            }}
          >
            {item.value}
          </Typography.Text>
        </div>
      </div>
    </Card>
  );
};

const KpiStrip: FC<{ data: KpiSectionData }> = ({ data }) => (
  <div className="account-profile-kpis">
    {data.items.map((item, i) => (
      <div key={`${item.label}-${i}`}>
        <Kpi item={item} />
      </div>
    ))}
  </div>
);

export default KpiStrip;
