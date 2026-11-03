import { useEffect } from 'react';
import type { MacroInfo } from '../../../main/src/types';
import type { ProfileScript } from '../../../common/profileScripts';
import { useSettingsStore, selectJNDataByServer } from '../../redux/settings';
import { usePanelContext } from './botSideBar/SidePanelContextProvider';
import { ResolvedProfileScript } from 'main/src/functions/ProfileScripts';

type OptionErrorPayload = {
  pluginId?: string;
  scriptName?: string;
  field: string;
  message: string;
};

/**
 * Resolve the plugin info the error belongs to. Library plugins live in the
 * macros list; profile scripts aren't stored on the device, so we match them
 * against the active profile and resolve their info on the main side.
 */
const resolvePlugin = async (
  payload: OptionErrorPayload,
): Promise<{ plugin: MacroInfo; profileScript?: ProfileScript } | undefined> => {
  const macros = useSettingsStore.getState().macros.list;
  const plugin =
    (payload.pluginId &&
      macros.find((m) => m.pluginId === payload.pluginId)) ||
    (payload.scriptName &&
      macros.find((m) => m.name === payload.scriptName)) ||
    undefined;
  if (plugin) return { plugin };

  const { data } = selectJNDataByServer(useSettingsStore.getState());
  const profileScript = (data.scripts ?? []).find((s) => s.pluginId === payload.pluginId);
  if (!profileScript) return undefined;

  const res = await window.ipcRenderer.invoke<ResolvedProfileScript & { error: string }>(
    'profile-script-resolve',
    profileScript,
  );
  if (!res?.info) return undefined;
  return { plugin: res.info, profileScript };
};

/**
 * Listens for `option-error` events emitted by scripts/plugins via
 * `script.optionError(...)`. Opens the matching plugin's settings panel
 * and stores the error so the field can highlight + display the message.
 */
const OptionErrorListener: React.FC = () => {
  const { setPanel, setOptionError } = usePanelContext();

  useEffect(() => {
    const off = window.ipcRenderer.on(
      'option-error',
      async (payload: OptionErrorPayload) => {
        if (!payload?.field || !payload?.message) return;

        const resolved = await resolvePlugin(payload);
        if (!resolved) {
          return console.error('No plugin found for option error:', payload);
        }
        const { plugin, profileScript } = resolved;

        setOptionError(plugin.pluginId, payload.field, payload.message);
        setPanel({
          active: true,
          tab: 'plugin',
          data: { plugin, view: 'options', profileScript },
        });
      },
    );
    return () => off();
  }, [setPanel, setOptionError]);

  return null;
};

export default OptionErrorListener;
