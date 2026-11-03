import { FC } from 'react';
import { Card, Typography, theme } from 'antd';
import { StarOutlined } from '@ant-design/icons';
import type { RanksSectionData } from '../../../../../common/profileUiSchema';
import { TONE_TO_HEX } from './toneColors';

const RanksCard: FC<{ data: RanksSectionData }> = ({ data }) => {
  const { token } = theme.useToken();
  return (
    <Card
      variant="borderless"
      style={{ background: token.colorBgContainer }}
      styles={{ body: { padding: token.paddingLG } }}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StarOutlined /> Ranks
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {data.items.length}
          </Typography.Text>
        </span>
      }
    >
      {data.items.length === 0 ? (
        <Typography.Text type="secondary">No ranks</Typography.Text>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 10,
          }}
        >
          {data.items.map((r) => {
            const color = r.tone ? TONE_TO_HEX[r.tone] : token.colorPrimary;
            const low = r.emphasis === 'low';
            const high = r.emphasis === 'high';
            return (
              <div
                key={`${r.server ?? ''}-${r.name}`}
                style={{
                  borderRadius: 10,
                  border: low
                    ? `1px dashed ${token.colorBorder}`
                    : `1px solid ${color}55`,
                  background: low
                    ? 'transparent'
                    : `${color}${high ? '22' : '10'}`,
                  padding: '10px 12px',
                  borderLeft: low
                    ? `3px dashed ${token.colorBorder}`
                    : `3px solid ${color}`,
                  boxShadow: high ? `inset 0 0 0 1px ${color}55` : undefined,
                  opacity: low ? 0.55 : 1,
                }}
              >
                <Typography.Text
                  strong
                  style={{
                    color: low ? token.colorTextSecondary : color,
                    display: 'block',
                    fontSize: 14,
                  }}
                >
                  {r.name}
                </Typography.Text>
                {r.server && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 11, display: 'block' }}
                  >
                    {r.server}
                  </Typography.Text>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default RanksCard;
