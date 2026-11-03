import { FC } from 'react';
import { Card, Space, Tag, theme, Typography } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import Image from '../../../Image';
import type {
  IdentitySectionData,
  ProfileUiPlayer,
} from '../../../../../common/profileUiSchema';
import { TONE_TO_ANTD, TONE_TO_HEX } from './toneColors';

interface Props {
  player: ProfileUiPlayer;
  data: IdentitySectionData;
}

const IdentityCard: FC<Props> = ({ player, data }) => {
  const { token } = theme.useToken();

  return (
    <Card
      variant="borderless"
      styles={{ body: { padding: token.paddingLG } }}
      style={{ background: token.colorBgContainer, position: 'relative' }}
    >
      <div
        style={{
          background: token.colorFillQuaternary,
          borderRadius: token.borderRadiusLG,
          padding: token.paddingLG,
          display: 'flex',
          justifyContent: 'center',
          minHeight: 180,
          alignItems: 'center',
        }}
      >
        <Image
          height={220}
          center
          style={{ maxWidth: '100%', objectFit: 'contain' }}
          src={
            player.skinUrl ??
            `https://crafthead.net/armor/body/${player.username}`
          }
        />
      </div>

      <div style={{ textAlign: 'center', marginTop: token.marginMD }}>
        <Space align="center" size={8} style={{ justifyContent: 'center' }}>
          {player.displayRank && (
            <Tag
              color={TONE_TO_ANTD.emerald}
              style={{ margin: 0, fontWeight: 600 }}
            >
              {player.displayRank}
            </Tag>
          )}
          <Typography.Title level={3} style={{ margin: 0 }}>
            {player.displayName ?? player.username}
          </Typography.Title>
        </Space>
      </div>

      {!!data.badges?.length && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
            marginTop: token.marginSM,
          }}
        >
          {data.badges.map((b, i) => {
            const color = b.tone ? TONE_TO_HEX[b.tone] : token.colorBorder;
            return (
              <span
                key={`${b.label}-${i}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: `1px solid ${color}55`,
                  background: `${color}14`,
                  fontSize: 12,
                  color: color,
                }}
              >
                <CheckCircleFilled style={{ fontSize: 10 }} />
                {b.label}
              </span>
            );
          })}
        </div>
      )}

      {!!data.counts?.length && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))',
            gap: 12,
            marginTop: token.marginLG,
            padding: `${token.paddingSM}px 0`,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {data.counts.map((c) => (
            <div key={c.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {c.label}
              </Typography.Text>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default IdentityCard;
