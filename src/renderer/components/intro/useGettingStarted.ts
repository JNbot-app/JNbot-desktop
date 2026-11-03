import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSettingsStore,
  selectAppSettings,
  selectJNDataByServer,
  updateAppSetting,
  updateScriptSettings,
} from '../../redux/settings';
import useAppApi from '../../hooks/useAppApi';
import { usePluginActions } from '../macros/usePluginActions';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import { ALT_EDITOR_TAB } from '../other/botSideBar/panelTabs';
import { hintState } from './OnboardingHint';

export type GettingStartedId = 'alt' | 'join' | 'plugin';

export const GETTING_STARTED_STEPS: { id: GettingStartedId; title: string }[] = [
  { id: 'alt', title: 'Add an alt' },
  { id: 'join', title: 'Join the server with your alt' },
  { id: 'plugin', title: 'Run a script from the dashboard' },
];

// Starter plugin installed when the dashboard has no scripts to try.
const STARTER_PLUGIN_URL =
  'https://jnbot-jndata.pages.dev/latest-plugin/jartexnetwork/mpzs840b1y2am3mg9qu';

/** True when the dashboard's Scripts section has at least one card. */
const dashboardHasScripts = () => {
  const state = useSettingsStore.getState();
  const { pluginData } = state.settings;
  return (
    (selectJNDataByServer(state).data?.scripts ?? []).some((s) => !s.hidden) ||
    state.macros.list.some((plugin) => pluginData?.[plugin.pluginId]?.pinned)
  );
};

/** Show the checklist from now on (called when the intro finishes). */
export const startGettingStarted = () => updateAppSetting('gettingStarted', []);
export const dismissGettingStarted = () => updateAppSetting('gettingStarted', null);

/**
 * Checklist progress, or null when hidden. A step completes the first time its
 * condition holds (alts exist, a bot is online, a plugin runs) and stays done.
 */
export default function useGettingStarted() {
  const recorded = useSettingsStore((s) => selectAppSettings(s).gettingStarted);
  const hasAlt = useSettingsStore((s) => s.alts.length > 0);
  const botOnline = useSettingsStore((s) => s.activeBots.length > 0);
  const pluginRunning = useSettingsStore((s) =>
    Object.values(s.activeScripts).some((script) => script.name !== 'chat'),
  );
  const live: Record<GettingStartedId, boolean> = {
    alt: hasAlt,
    join: botOnline,
    plugin: pluginRunning,
  };

  useEffect(() => {
    if (!recorded) return;
    const reached = GETTING_STARTED_STEPS.filter(
      ({ id }) => live[id] && !recorded.includes(id),
    ).map(({ id }) => id);
    if (reached.length) updateAppSetting('gettingStarted', [...recorded, ...reached]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded, hasAlt, botOnline, pluginRunning]);

  if (!recorded) return null;
  return GETTING_STARTED_STEPS.map((step) => ({
    ...step,
    done: live[step.id] || recorded.includes(step.id),
  }));
}

/** Takes the user to the place where a checklist step is done. */
export function useGettingStartedAction() {
  const navigate = useNavigate();
  const { setPanel } = usePanelContext();
  const { message } = useAppApi();
  const { togglePin } = usePluginActions();

  /** Install and pin the starter plugin so the dashboard has a script. */
  const addStarterScript = async () => {
    const res = await window.ipcRenderer.invoke<{
      ok: boolean;
      pluginId?: string;
      error?: string;
    }>('profile-plugin-install', {
      id: 'starter',
      pluginId: '',
      source: { kind: 'url', url: STARTER_PLUGIN_URL, infoPath: '' },
    });
    if (!res?.ok || !res.pluginId) {
      message.error(res?.error ?? 'Could not add the starter script.');
      return;
    }
    togglePin(res.pluginId, true);
    window.ipcRenderer.action('GET_MACROS');
  };

  return async (id: GettingStartedId) => {
    if (id === 'alt') {
      navigate('/alts', { state: hintState('alt') });
      setPanel({ active: true, tab: ALT_EDITOR_TAB, data: {} });
      return;
    }
    if (id === 'join') {
      // Preselect the user's first alt in the join form.
      const { alts, settings } = useSettingsStore.getState();
      if (alts[0] && !settings.scripts?.chat?.username) {
        updateScriptSettings({
          optionId: 'username',
          value: alts[0].username,
          scriptName: 'chat',
        });
      }
      navigate('/bot', { state: hintState('join') });
      return;
    }
    if (!dashboardHasScripts()) await addStarterScript();
    navigate('/', { state: hintState('plugin') });
  };
}
