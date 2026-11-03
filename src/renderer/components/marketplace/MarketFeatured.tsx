import { useState } from 'react';
import { Flex, Typography, theme } from 'antd';
import type { MarketEntry } from '../../../common/share';
import BannerHero from '../macros/BannerHero';
import { SHARE_KIND_ICONS } from './KindTile';

const FeaturedCard: React.FC<{ entry: MarketEntry; onOpen: () => void }> = ({
  entry,
  onOpen,
}) => {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const accent = entry.listing.color ?? token.colorPrimary;
  return (
    <Flex
      vertical
      role="button"
      tabIndex={0}
      aria-label={`${entry.listing.title} by ${entry.publisher.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 0,
        cursor: 'pointer',
        overflow: 'hidden',
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer,
        border: `${token.lineWidth}px ${token.lineType} ${hover ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        transition: `border-color ${token.motionDurationMid}`,
      }}
    >
      <BannerHero
        src={entry.bannerUrl}
        height={132}
        accent={accent}
        fallback={
          <Flex
            align="center"
            justify="center"
            style={{ height: '100%', fontSize: 32, color: accent, opacity: 0.7 }}
          >
            {SHARE_KIND_ICONS[entry.kind]}
          </Flex>
        }
      />
      <Flex vertical style={{ padding: token.paddingSM }}>
        <Typography.Text strong ellipsis>
          {entry.listing.title}
        </Typography.Text>
        <Typography.Text
          type="secondary"
          ellipsis
          style={{ fontSize: token.fontSizeSM }}
        >
          {entry.publisher.name}
        </Typography.Text>
      </Flex>
    </Flex>
  );
};

/** The newest banner-led entries, as a row of wide cards above the lists. */
const MarketFeatured: React.FC<{
  entries: MarketEntry[];
  onOpen: (entry: MarketEntry) => void;
}> = ({ entries, onOpen }) => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: token.marginSM,
      }}
    >
      {entries.map((entry) => (
        <FeaturedCard key={entry.id} entry={entry} onOpen={() => onOpen(entry)} />
      ))}
    </div>
  );
};

export default MarketFeatured;
