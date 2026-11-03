import { Button, Flex, Typography, theme } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { SHARE_KIND_INFO, type ShareKind } from '../../../common/share';
import { SHARE_KIND_ICONS } from './KindTile';

/** Rows flow into as many columns as fit. */
export const RowGrid: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
        gap: token.marginXS,
      }}
    >
      {children}
    </div>
  );
};

/** A kind's heading with its count and an optional "See all". */
const MarketSection: React.FC<{
  kind: ShareKind;
  total: number;
  onSeeAll?: () => void;
  children: React.ReactNode;
}> = ({ kind, total, onSeeAll, children }) => {
  const { token } = theme.useToken();
  return (
    <section aria-label={SHARE_KIND_INFO[kind].plural}>
      <Flex
        align="center"
        justify="space-between"
        style={{ marginBottom: token.marginXS }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          <span
            style={{
              color: token.colorTextSecondary,
              marginRight: token.marginXS,
            }}
          >
            {SHARE_KIND_ICONS[kind]}
          </span>
          {SHARE_KIND_INFO[kind].plural}
        </Typography.Title>
        {onSeeAll && (
          <Button type="link" size="small" onClick={onSeeAll}>
            See all {total} <RightOutlined />
          </Button>
        )}
      </Flex>
      {children}
    </section>
  );
};

export default MarketSection;
