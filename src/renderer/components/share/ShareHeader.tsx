import { Flex, Tooltip, Typography, theme } from 'antd';
import {
  CheckCircleFilled,
  ExclamationCircleOutlined,
  SafetyCertificateFilled,
  SyncOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  SHARE_KIND_LABELS,
  type ShareInstallState,
  type ShareOverview,
} from '../../../common/share';
import BannerHero from '../macros/BannerHero';
import KindTile, { SHARE_KIND_ICONS } from '../marketplace/KindTile';

const PUBLISHER_STATES = {
  official: {
    icon: <SafetyCertificateFilled />,
    label: 'JNbot team',
    tone: 'colorPrimary',
  },
  own: { icon: <UserOutlined />, label: 'You', tone: 'colorTextSecondary' },
  trusted: {
    icon: <CheckCircleFilled />,
    label: 'Trusted',
    tone: 'colorSuccess',
  },
  new: {
    icon: <ExclamationCircleOutlined />,
    label: 'New publisher',
    tone: 'colorWarning',
  },
} as const;

/** Banner or icon, title, publisher and install state of a share. */
const ShareHeader: React.FC<{
  overview: ShareOverview;
  installState: ShareInstallState;
}> = ({ overview, installState }) => {
  const { token } = theme.useToken();
  const { kind, publisher, color } = overview;
  const media = kind === 'plugin' || kind === 'bundle';
  const accent = color ?? token.colorPrimary;
  const state =
    PUBLISHER_STATES[
      publisher.official
        ? 'official'
        : publisher.own
          ? 'own'
          : publisher.trusted
            ? 'trusted'
            : 'new'
    ];

  const title = (
    <Flex vertical gap={2} style={{ minWidth: 0 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {overview.title}
      </Typography.Title>
      <Flex
        align="center"
        gap={token.marginXS}
        wrap
        style={{ fontSize: token.fontSizeSM }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 'inherit' }}>
          {SHARE_KIND_LABELS[kind]} by
        </Typography.Text>
        <Tooltip
          title={`Publisher key ${publisher.fingerprint.match(/.{1,4}/g)?.join(' ')}`}
        >
          <Typography.Text strong style={{ fontSize: 'inherit' }}>
            {publisher.name}
          </Typography.Text>
        </Tooltip>
        <Typography.Text
          style={{ fontSize: 'inherit', color: token[state.tone] }}
        >
          {state.icon} {state.label}
        </Typography.Text>
      </Flex>
    </Flex>
  );

  return (
    <Flex vertical gap={token.marginSM}>
      {media ? (
        <>
          <div
            style={{ borderRadius: token.borderRadiusLG, overflow: 'hidden' }}
          >
            <BannerHero
              src={overview.bannerUrl}
              height={150}
              accent={accent}
              fallback={
                <Flex
                  align="center"
                  justify="center"
                  style={{
                    height: '100%',
                    fontSize: 44,
                    color: accent,
                    opacity: 0.7,
                  }}
                >
                  {SHARE_KIND_ICONS[kind]}
                </Flex>
              }
            />
          </div>
          {title}
        </>
      ) : (
        <Flex gap={token.marginSM} align="center">
          <KindTile
            kind={kind}
            color={color}
            src={kind === 'profile' ? overview.bannerUrl : undefined}
            size={56}
          />
          {title}
        </Flex>
      )}
      {(installState === 'installed' || installState === 'update') && (
        <Typography.Text
          type={installState === 'installed' ? 'success' : undefined}
          style={
            installState === 'update'
              ? { color: token.colorPrimary }
              : undefined
          }
        >
          {installState === 'installed' ? (
            <>
              <CheckCircleFilled /> You have the latest version
            </>
          ) : (
            <>
              <SyncOutlined /> A newer version is available
            </>
          )}
        </Typography.Text>
      )}
      {overview.description && (
        <Typography.Paragraph
          ellipsis={{ rows: 5, expandable: 'collapsible' }}
          style={{ margin: 0, whiteSpace: 'pre-wrap' }}
        >
          {overview.description}
        </Typography.Paragraph>
      )}
    </Flex>
  );
};

export default ShareHeader;
