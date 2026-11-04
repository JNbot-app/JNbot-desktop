import { Flex, Tooltip, Typography, theme } from 'antd';
import { SafetyCertificateFilled } from '@ant-design/icons';
import { useState } from 'react';
import type { MarketEntry } from '../../../common/share';
import { withAlpha } from '../intro/introUtils';
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
    <div
      role="button"
      tabIndex={0}
      aria-label={`${entry.listing.title} by ${entry.publisher.name}`}
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
      style={{
        minWidth: 0,
        cursor: 'pointer',
        overflow: 'hidden',
        borderRadius: token.borderRadiusLG,
        border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
      }}
    >
      <BannerHero
        src={entry.bannerUrl}
        height={160}
        zoomed={hover}
        accent={accent}
        fallback={
          <Flex
            align="center"
            justify="center"
            style={{
              height: '100%',
              fontSize: 56,
              color: accent,
              background: `radial-gradient(circle at 30% 20%, ${withAlpha(accent, 0.35)}, transparent 70%)`,
            }}
          >
            {SHARE_KIND_ICONS[entry.kind]}
          </Flex>
        }
      >
        <Flex
          align="center"
          gap={token.marginXXS}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: `${token.paddingXL}px ${token.paddingSM}px ${token.paddingSM}px`,
            background:
              'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.5) 55%, transparent)',
          }}
        >
          <Typography.Text
            ellipsis
            style={{
              color: token.colorTextLightSolid,
              opacity: 0.85,
              minWidth: 0,
              fontWeight: token.fontWeightStrong,
            }}
          >
            {entry.listing.title}
          </Typography.Text>
          {entry.publisher.official && (
            <Tooltip title="Made by the JNbot team">
              <SafetyCertificateFilled
                style={{ color: token.colorTextLightSolid, opacity: 0.85 }}
              />
            </Tooltip>
          )}
        </Flex>
      </BannerHero>
    </div>
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
