import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Flex, Spin, Typography, theme } from 'antd';
import { CodeOutlined, FlagOutlined } from '@ant-design/icons';
import {
  entryOverview,
  parseShareId,
  previewBlocked,
  previewNeedsCheck,
  previewOverview,
  shareInstallKey,
  shareInstallState,
  type ShareInstallInput,
  type SharePreview,
} from '../../../common/share';
import useAppApi from '../../hooks/useAppApi';
import { selectActiveServerId, useSettingsStore } from '../../redux/settings';
import { useShares } from '../../redux/shares';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import type { SharePanelData } from '../other/botSideBar/panelTabs';
import type { PluginChoice } from './SharePluginRow';
import ShareContents from './ShareContents';
import ShareHeader from './ShareHeader';
import ShareInstallCheck, { choiceKey } from './ShareInstallCheck';
import shareRequest from './shareRequest';
import { useOpenInstalled } from './useInstallShare';
import ShareReviewActions from './ShareReviewActions';
import promptText from './promptText';

const INSTALL_LABELS = {
  none: 'Install',
  update: 'Update',
  installed: 'Open',
} as const;

/**
 * Shows what a share is and installs it. Opened from the marketplace it renders
 * from the cached catalog and downloads the share only for Install or the code.
 */
const ShareReviewPanel: React.FC<SharePanelData> = ({
  link,
  revision,
  reports,
  entry,
}) => {
  const { token } = theme.useToken();
  const api = useAppApi();
  const { setPanel } = usePanelContext();
  const openInstalled = useOpenInstalled();
  const profileKey = useSettingsStore(selectActiveServerId);
  const reviewing = revision !== undefined || reports !== undefined;
  const [preview, setPreview] = useState<SharePreview | null>();
  const shareId = entry?.id ?? parseShareId(link) ?? '';
  const kind = preview?.kind ?? entry?.kind;
  const install = useShares((state) =>
    kind ? state.installed[shareInstallKey(shareId, kind, profileKey)] : undefined,
  );
  const appVersion = useShares((state) => state.appVersion);
  const [busy, setBusy] = useState<'code' | 'install' | null>(null);
  // Links and reviews show the code right away; catalog entries once asked for.
  const [checking, setChecking] = useState(!entry);
  const [choices, setChoices] = useState<Record<string, PluginChoice>>({});
  const [trustPublisher, setTrustPublisher] = useState(false);
  const checkRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const result = await shareRequest<SharePreview>(api, 'SHARE_PREVIEW', {
      link,
      revision,
      profileKey: profileKey ?? undefined,
    });
    setPreview(result);
    return result;
  };

  useEffect(() => {
    if (!entry) void load();
  }, []);

  const showCheck = checking && !!preview;
  useEffect(() => {
    if (showCheck && entry)
      checkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showCheck]);

  const overview = preview
    ? previewOverview(preview)
    : entry && entryOverview(entry);
  if (!overview) {
    return preview === null ? (
      <Empty description="This share could not be opened." />
    ) : (
      <Flex justify="center" style={{ padding: token.paddingLG }}>
        <Spin />
      </Flex>
    );
  }

  const installState = shareInstallState(
    install,
    overview.revision,
    overview.minAppVersion,
    appVersion,
    overview.publisher.own,
  );
  const closePanel = () => setPanel((panel) => ({ ...panel, active: false }));

  const showCode = async () => {
    setBusy('code');
    if (preview || (await load())) setChecking(true);
    setBusy(null);
  };

  const report = async () => {
    const reason = await promptText(api, {
      title: `Report ${overview.title}`,
      description:
        'The JNbot team reviews it again. Tell us what is wrong, e.g. does not work.',
      okText: 'Report',
      placeholder: 'What is wrong with it?',
      danger: true,
    });
    if (
      reason &&
      (await shareRequest(api, 'SHARE_REPORT', { id: overview.id, reason }))
    ) {
      api.message.success('Thanks, the JNbot team will take a look');
    }
  };

  const confirmInstall = async () => {
    if (install && installState === 'installed') {
      closePanel();
      openInstalled(install.localRef);
      return;
    }
    setBusy('install');
    const result = await installShare();
    setBusy(null);
    if (!result) return;
    api.message.success(
      `${overview.title} ${installState === 'none' ? 'installed' : 'updated'}`,
    );
    closePanel();
    openInstalled(overview.kind, result.localRef);
  };

  /** Downloads the share if needed; shows the check first when something needs a look. */
  const installShare = async () => {
    const loaded = preview ?? (await load());
    if (!loaded || previewBlocked(loaded)) return null;
    if (!checking && previewNeedsCheck(loaded)) {
      setChecking(true);
      return null;
    }
    return shareRequest<{ localRef: string }>(api, 'SHARE_INSTALL', {
      id: loaded.id,
      decisions: loaded.plugins.map((plugin) => ({
        ownerId: plugin.ownerId,
        pluginId: plugin.pluginId,
        revision: plugin.revision,
        action: choices[choiceKey(plugin)] ?? 'replace',
        // The user reviewed the plugins and their publishers in this panel.
        acceptUnverified: true,
      })),
      trustPublisher,
      ...(loaded.kind === 'chain' || loaded.kind === 'trigger'
        ? { profileKey }
        : {}),
    } satisfies ShareInstallInput);
  };

  return (
    <Flex vertical gap={token.marginLG} style={{ minHeight: '100%' }}>
      <ShareHeader overview={overview} installState={installState} />
      <ShareContents overview={overview} />

      {checking && preview ? (
        <div ref={checkRef}>
          <ShareInstallCheck
            preview={preview}
            choices={choices}
            onChoice={(key, choice) =>
              setChoices({ ...choices, [key]: choice })
            }
            trustPublisher={trustPublisher}
            onTrustPublisher={setTrustPublisher}
          />
        </div>
      ) : (
        <Button
          type="link"
          icon={<CodeOutlined />}
          loading={busy === 'code'}
          onClick={showCode}
          style={{ alignSelf: 'start', paddingInline: 0 }}
        >
          View code and signatures
        </Button>
      )}

      <Flex
        vertical
        gap={token.marginXS}
        style={{
          position: 'sticky',
          bottom: -12,
          marginTop: 'auto',
          marginInline: -12,
          marginBottom: -12,
          padding: 12,
          background: token.colorBgContainer,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {reviewing ? (
          preview && (
            <ShareReviewActions
              preview={preview}
              reports={reports}
              onDone={closePanel}
            />
          )
        ) : (
          <>
            {!overview.canInstall && (
              <Typography.Text type="warning">
                Needs JNbot {overview.minAppVersion} or newer. Update JNbot to
                install it.
              </Typography.Text>
            )}
            <Flex gap={token.marginXS} align="center">
              {(entry || preview?.reviewed) && !overview.publisher.own && (
                <Button
                  type="text"
                  size="small"
                  icon={<FlagOutlined />}
                  onClick={report}
                >
                  Report
                </Button>
              )}
              {installState !== 'own' && (
                <Button
                  type="primary"
                  size="large"
                  loading={busy === 'install'}
                  disabled={
                    !overview.canInstall || (!!preview && previewBlocked(preview))
                  }
                  onClick={confirmInstall}
                  style={{ marginLeft: 'auto', minWidth: 140 }}
                >
                  {INSTALL_LABELS[installState]}
                </Button>
              )}
            </Flex>
          </>
        )}
      </Flex>
    </Flex>
  );
};

export default ShareReviewPanel;
