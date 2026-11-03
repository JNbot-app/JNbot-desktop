import {
  SCHEDULE_TAB,
  SHARE_TAB,
  TRIGGER_TAB,
  type SchedulePanelData,
  type SharePanelData,
  type TriggerPanelData,
} from './panelTabs';
import { CloseOutlined, LoadingOutlined } from '@ant-design/icons';
import { Badge, Button, Spin, Tabs } from 'antd';
import {
  FC,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ActiveBotsType } from 'main/src/types';
import {
  useSettingsStore,
  selectActiveBots,
  selectSelectedBot,
} from 'renderer/redux/settings';
import type { PanelData as PluginPanelData } from '../../macros/PluginInfoTab';
import type { PreviewProps } from './panelTabs/ProfileUiPreviewTab';
import { usePanelContext } from './SidePanelContextProvider';
import { ALT_EDITOR_TAB, type AltEditorPanelData } from './panelTabs';
import {
  ACCOUNT_PROFILE_TAB,
  AccountProfilePanelData,
} from './accountProfile/accountProfileTab';
import {
  MINECRAFT_PROJECT_TAB,
  type MinecraftProjectPanelData,
} from './panelTabs';
import { CHAIN_OPTIONS_TAB, CHANGELOG_TAB, type ChainOptionsPanelData } from './panelTabs';

const LogsTab = lazy(() => import('./panelTabs/LogsTab'));

const ActiveBotsTab = lazy(() => import('./panelTabs/ActiveBotsTab'));


const BotPanel = lazy(() => import('./botPanel/BotPanel'));

const PluginInfoTab = lazy(() => import('../../macros/PluginInfoTab'));

const ProfileUiPreviewTab = lazy(
  () => import('./panelTabs/ProfileUiPreviewTab'),
);

const AccountProfilePanel = lazy(
  () => import('./accountProfile/AccountProfilePanel'),
);

const ScheduleEditor = lazy(
  () => import('../../dashboard/schedules/ScheduleEditor'),
);

const TriggerEditor = lazy(() => import('../../triggers/TriggerEditor'));

const ShareReviewPanel = lazy(() => import('../../share/ShareReviewPanel'));

const AltEditorPanel = lazy(() => import('../../alts/AltEditorPanel'));

const MinecraftProjectPanel = lazy(
  () => import('../../mcLauncher/tabs/MinecraftProjectPanel'),
);

const ChangelogPanel = lazy(() => import('./ChangelogPanel'));

const ChainOptions = lazy(
  () => import('../../dashboard/scriptChain/ChainOptions'),
);

interface TabItem {
  key: string;
  label: ReactNode;
}

const CONTAINER_STYLE: CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderLeft: '1px solid rgba(128, 128, 128, 0.15)',
};

const TAB_BAR_STYLE: CSSProperties = {
  margin: 0,
  padding: '0 8px',
};

const CONTENT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 12,
};

const PANEL_LOADING_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const tabLabel = (text: string, count?: number, error?: boolean) => {
  if (!count) return <span>{text}</span>;

  return (
    <span>
      {text}{' '}
      <Badge
        count={count}
        overflowCount={999}
        size="small"
        color={error ? 'red' : undefined}
        style={
          !error
            ? { background: 'rgba(128, 128, 128, 0.25)', color: 'inherit' }
            : undefined
        }
      />
    </span>
  );
};

const getContextualTabItem = (
  activeTab: string,
  data: unknown,
): TabItem | null => {
  switch (activeTab) {
    case SCHEDULE_TAB:
      return { key: SCHEDULE_TAB, label: 'Script schedule' };
    case TRIGGER_TAB:
      return { key: TRIGGER_TAB, label: 'Trigger' };
    case SHARE_TAB:
      return { key: SHARE_TAB, label: 'Share' };
    case CHANGELOG_TAB:
      return { key: CHANGELOG_TAB, label: 'Changelog' };
    case CHAIN_OPTIONS_TAB: {
      const chainData = data as ChainOptionsPanelData | undefined;
      return chainData
        ? {
            key: CHAIN_OPTIONS_TAB,
            label: chainData.creating ? 'New chain' : 'Chain settings',
          }
        : null;
    }
    case ACCOUNT_PROFILE_TAB: {
      const profile = data as AccountProfilePanelData | undefined;
      return typeof profile?.username === 'string'
        ? { key: ACCOUNT_PROFILE_TAB, label: profile.username }
        : null;
    }
    case ALT_EDITOR_TAB: {
      const altData = data as AltEditorPanelData | undefined;
      const label = altData?.originalUsername
        ? `Edit ${altData.originalUsername}`
        : 'Add alt';
      return { key: ALT_EDITOR_TAB, label };
    }
    case 'plugin': {
      const pluginData = data as PluginPanelData | undefined;
      return pluginData?.plugin?.name
        ? { key: 'plugin', label: pluginData.plugin.name }
        : null;
    }
    case MINECRAFT_PROJECT_TAB: {
      const projectData = data as MinecraftProjectPanelData | undefined;
      return projectData?.title
        ? { key: MINECRAFT_PROJECT_TAB, label: projectData.title }
        : null;
    }
    case 'mcp-client-access': {
      const customData = data as { label?: string } | undefined;
      return customData?.label
        ? { key: 'mcp-client-access', label: customData.label }
        : null;
    }
    default:
      return null;
  }
};

const SidePanel: FC<{
  activeTab: string;
  onClose: () => void;
  onTabChange: (tab: string) => void;
  /** Editor-specific tabs keep their UI in the editor while sharing this panel. */
  extraTabs?: Array<{ key: string; label: ReactNode; content: ReactNode }>;
  /** Only set inside the code editor for profile-UI plugins. */
  preview?: PreviewProps;
}> = ({ activeTab, onClose, onTabChange, preview, extraTabs = [] }) => {
  const selectedBot = useSettingsStore(selectSelectedBot);
  const activeBots = useSettingsStore(selectActiveBots);
  const { panel } = usePanelContext();

  const onSelectBot = useCallback(
    (bot: ActiveBotsType[number]) => {
      onTabChange(`bot-${bot.botId}`);
    },
    [onTabChange],
  );

  useEffect(() => {
    if (!selectedBot && activeTab.startsWith('bot-')) {
      onTabChange('activeBots');
    }
  }, [selectedBot, activeTab, onTabChange]);

  const items = useMemo(() => {
    const list: TabItem[] = extraTabs.map(({ key, label }) => ({
      key,
      label,
    }));

    const contextualTab = getContextualTabItem(activeTab, panel.data);
    if (contextualTab) {
      list.push(contextualTab);
    }

    if (preview) {
      list.push({ key: 'preview', label: 'Preview' });
    }

    list.push(
      { key: 'logs', label: 'Logs' },
      { key: 'activeBots', label: tabLabel('Active bots', activeBots.length) },
    );

    if (selectedBot) {
      list.push({
        key: `bot-${selectedBot.botId}`,
        label: selectedBot.username,
      });
    }

    return list;
  }, [
    extraTabs,
    activeTab,
    panel.data,
    preview,
    activeBots.length,
    selectedBot,
  ]);

  const renderContent = () => {
    const extra = extraTabs.find((tab) => tab.key === activeTab);
    if (extra) return extra.content;

    if (selectedBot && activeTab === `bot-${selectedBot.botId}`) {
      return <BotPanel key={selectedBot.botId} selectedBot={selectedBot} />;
    }

    switch (activeTab) {
      case SCHEDULE_TAB: {
        const data = panel.data as SchedulePanelData | undefined;
        return data ? (
          <ScheduleEditor key={data.schedule?.id ?? 'new'} {...data} />
        ) : null;
      }
      case TRIGGER_TAB: {
        const data = panel.data as TriggerPanelData | undefined;
        return data ? (
          <TriggerEditor key={data.trigger?.id ?? 'new'} {...data} />
        ) : null;
      }
      case SHARE_TAB: {
        const data = panel.data as SharePanelData | undefined;
        return data ? <ShareReviewPanel key={`${data.link}:${data.revision ?? ''}`} {...data} /> : null;
      }
      case CHAIN_OPTIONS_TAB: {
        const chainData = panel.data as ChainOptionsPanelData | undefined;
        return chainData ? (
          <ChainOptions key={chainData.id} {...chainData} />
        ) : null;
      }
      case CHANGELOG_TAB:
        return <ChangelogPanel />;
      case 'logs':
        return <LogsTab />;
      case 'activeBots':
        return <ActiveBotsTab onSelect={onSelectBot} />;
      case 'preview':
        return preview ? <ProfileUiPreviewTab preview={preview} /> : null;
      case ACCOUNT_PROFILE_TAB: {
        const profile = panel.data as AccountProfilePanelData | undefined;
        return typeof profile?.username === 'string' ? (
          <AccountProfilePanel data={profile} />
        ) : null;
      }
      case ALT_EDITOR_TAB:
        return (
          <AltEditorPanel
            data={(panel.data as AltEditorPanelData | undefined) ?? {}}
          />
        );
      case 'plugin':
        return panel.data ? (
          <PluginInfoTab data={panel.data as PluginPanelData} />
        ) : null;
      case MINECRAFT_PROJECT_TAB: {
        const projectData = panel.data as MinecraftProjectPanelData | undefined;
        if (!projectData) return null;
        const projectKey =
          projectData.kind === 'launcher'
            ? `launcher-${projectData.type}-${projectData.modInfo.id}-${projectData.modInfo.projectId}`
            : `server-plugin-${projectData.serverId}-${projectData.projectId}`;
        return <MinecraftProjectPanel key={projectKey} data={projectData} />;
      }
      case 'mcp-client-access':
        return (
          (panel.data as { content?: ReactNode } | undefined)?.content ?? null
        );
      default:
        return null;
    }
  };

  return (
    <div style={CONTAINER_STYLE}>
      <Tabs
        activeKey={activeTab}
        onChange={onTabChange}
        items={items}
        size="small"
        tabBarStyle={TAB_BAR_STYLE}
        tabBarExtraContent={
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onClose}
          />
        }
      />
      <div style={CONTENT_STYLE}>
        <Suspense
          fallback={
            <div style={PANEL_LOADING_STYLE} role="status" aria-label="Loading">
              <Spin
                indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />}
              />
            </div>
          }
        >
          {renderContent()}
        </Suspense>
      </div>
    </div>
  );
};

export default SidePanel;
