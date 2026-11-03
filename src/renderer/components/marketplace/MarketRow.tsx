import { useState } from 'react';
import { Button, Flex, Tag, Tooltip, Typography, theme } from 'antd';
import {
  CheckCircleFilled,
  SafetyCertificateFilled,
  UserOutlined,
} from '@ant-design/icons';
import {
  shareSummary,
  type MarketEntry,
  type ShareInstallState,
} from '../../../common/share';
import ShareStatusTag from '../share/ShareStatusTag';
import KindTile from './KindTile';

/** Install state as the row's trailing control: a button to get it, or a quiet status. */
const RowAction: React.FC<{
  entry: MarketEntry;
  state: ShareInstallState;
  busy: boolean;
  onGet: () => void;
}> = ({ entry, state, busy, onGet }) => {
  const { token } = theme.useToken();
  const small = { fontSize: token.fontSizeSM, whiteSpace: 'nowrap' } as const;
  if (entry.status !== undefined) {
    return (
      <Flex gap={token.marginXXS}>
        <ShareStatusTag
          share={{
            visibility: 'public',
            status: entry.status,
            note: null,
            pending: false,
          }}
        />
        {!!entry.reports && <Tag color="error">{entry.reports} reports</Tag>}
      </Flex>
    );
  }
  if (!entry.canInstall) {
    return (
      <Typography.Text type="warning" style={small}>
        Needs JNbot {entry.listing.minAppVersion}
      </Typography.Text>
    );
  }
  if (state === 'own') {
    return (
      <Typography.Text type="secondary" style={small}>
        <UserOutlined /> Yours
      </Typography.Text>
    );
  }
  if (state === 'installed') {
    return (
      <Typography.Text type="success" style={small}>
        <CheckCircleFilled /> Installed
      </Typography.Text>
    );
  }
  return (
    <Button
      size="small"
      loading={busy}
      onClick={(event) => {
        event.stopPropagation();
        onGet();
      }}
    >
      {state === 'update' ? 'Update' : 'Get'}
    </Button>
  );
};

/** One marketplace entry as a dense row; the row opens the detail panel, the button installs. */
const MarketRow: React.FC<{
  entry: MarketEntry;
  installState: ShareInstallState;
  busy?: boolean;
  onOpen: () => void;
  onGet: () => void;
}> = ({ entry, installState, busy = false, onOpen, onGet }) => {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const { listing, publisher } = entry;
  const description =
    listing.description || listing.items.map((item) => item.name).join(', ');
  return (
    <Flex
      align="center"
      gap={token.marginSM}
      role="button"
      tabIndex={0}
      aria-label={`${listing.title} by ${publisher.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 0,
        padding: token.paddingSM,
        cursor: 'pointer',
        borderRadius: token.borderRadiusLG,
        background: hover ? token.colorFillQuaternary : 'transparent',
        border: `${token.lineWidth}px ${token.lineType} ${hover ? token.colorBorder : token.colorBorderSecondary}`,
        transition: `background ${token.motionDurationMid}, border-color ${token.motionDurationMid}`,
      }}
    >
      <KindTile
        kind={entry.kind}
        color={listing.color}
        src={entry.bannerUrl}
        size={52}
      />
      <Flex vertical style={{ flex: 1, minWidth: 0 }}>
        <Flex align="center" gap={token.marginXXS} style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
            {listing.title}
          </Typography.Text>
          {publisher.official && (
            <Tooltip title="Made by the JNbot team">
              <SafetyCertificateFilled
                style={{ color: token.colorPrimary, fontSize: token.fontSizeSM }}
              />
            </Tooltip>
          )}
        </Flex>
        <Typography.Text
          type="secondary"
          ellipsis
          style={{ fontSize: token.fontSizeSM }}
        >
          {description}
        </Typography.Text>
        <Typography.Text
          type="secondary"
          ellipsis
          style={{ fontSize: token.fontSizeSM, opacity: 0.75 }}
        >
          {[publisher.name, shareSummary(listing)].filter(Boolean).join(' · ')}
        </Typography.Text>
      </Flex>
      <RowAction entry={entry} state={installState} busy={busy} onGet={onGet} />
    </Flex>
  );
};

export default MarketRow;
