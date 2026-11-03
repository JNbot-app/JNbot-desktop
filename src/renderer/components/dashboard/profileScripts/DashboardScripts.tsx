import { FC, useMemo, useRef } from 'react';
import {
  useSettingsStore,
  selectJNDataByServer,
  selectMacros,
  selectSettings,
} from '../../../redux/settings';
import { sortScripts } from '../../../../common/profileScripts';
import DashboardScriptCard from './DashboardScriptCard';
import { Divider, theme, Typography } from 'antd';
import DashboardPinnedScripts from './DashboardPinnedScripts';
import OnboardingHint from '../../intro/OnboardingHint';

/**
 * Renders the scripts list for the active server profile. Each card is
 * driven by the profile's `ProfileScript` entry — see the Scripts step
 * of the profile wizard for how the list is built.
 */
const DashboardScripts: FC = () => {
  const { token } = theme.useToken();

  const profile = useSettingsStore(selectJNDataByServer);
  const settings = useSettingsStore(selectSettings);
  const { list } = useSettingsStore(selectMacros);
  const listRef = useRef<HTMLDivElement>(null);

  const scripts = useMemo(
    () => sortScripts(profile.data?.scripts ?? []).filter((s) => !s.hidden),
    [profile.data?.scripts],
  );

  const existingPluginIds = useMemo(
    () => new Set(scripts.map((s) => s.pluginId).filter(Boolean)),
    [scripts],
  );

  const pinnedPlugins = useMemo(() => {
    const pinnedIds = new Set(
      Object.entries(settings.pluginData ?? {})
        .filter(([_, data]) => data?.pinned)
        .map(([pluginId]) => pluginId),
    );
    return list.filter(
      (plugin) =>
        pinnedIds.has(plugin.pluginId) && !existingPluginIds.has(plugin.pluginId),
    );
  }, [settings.pluginData, list, existingPluginIds]);

  if (!scripts.length && !pinnedPlugins.length) {
    return null;
  }

  return (
    <>
      <Typography.Title
        level={2}
        style={{
          fontWeight: 600,
          fontSize: '1.7em',
          color: token.colorPrimaryText,
          paddingTop: '1rem',
        }}
      >
        Scripts
      </Typography.Title>
      <Divider style={{ marginBottom: '2rem', marginTop: 0 }} />
      <div
        ref={listRef}
        style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          justifyContent: 'flex-start',
        }}
      >
        {scripts.map((s) => (
          <DashboardScriptCard key={s.id} script={s} />
        ))}
        <DashboardPinnedScripts pinnedPlugins={pinnedPlugins} />
      </div>
      <OnboardingHint
        id="plugin"
        steps={[
          {
            title: 'Run a script',
            description:
              'Press Run on a script to automate a task with your bot. Use the settings icon to change how it behaves.',
            target: () => listRef.current,
          },
        ]}
      />
    </>
  );
};

export default DashboardScripts;
