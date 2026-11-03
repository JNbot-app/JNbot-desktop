import { FC } from 'react';
import { Card, Space, theme, Typography } from 'antd';
import { GiftOutlined } from '@ant-design/icons';
import type { GkitsSectionData } from '../../../../../common/profileUiSchema';

const GkitsCard: FC<{ data: GkitsSectionData }> = ({ data }) => {
  const { token } = theme.useToken();
  return (
    <Card
      variant="borderless"
      style={{ background: token.colorBgContainer }}
      styles={{ body: { padding: token.paddingLG } }}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GiftOutlined /> Gkits
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {data.groups.reduce((n, g) => n + g.items.length, 0)}
          </Typography.Text>
        </span>
      }
    >
      {data.groups.length === 0 ? (
        <Typography.Text type="secondary">No gkits</Typography.Text>
      ) : (
        <Space orientation="vertical" size={14} style={{ width: '100%' }}>
          {data.groups.map((g) => (
            <div key={g.gamemode}>
              <Typography.Text
                type="secondary"
                style={{
                  fontSize: 11,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                {g.gamemode}{' '}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {g.items.length}
                </Typography.Text>
              </Typography.Text>
              <Space wrap size={6}>
                {g.items.map((name) => (
                  <span
                    key={name}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 999,
                      border: `1px solid ${token.colorBorder}`,
                      fontSize: 12,
                    }}
                  >
                    {name}
                  </span>
                ))}
              </Space>
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
};

export default GkitsCard;
