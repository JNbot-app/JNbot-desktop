import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PLUGINS_UI_STORAGE_KEY,
  SettingsState,
  useSettingsStore,
  selectScripts,
  setPluginsUi,
  savePlugin,
  removeMacro,
  setPluginMetadata,
  set,
} from '../../redux/settings';
import useAppApi from '../../hooks/useAppApi';
import promptPublisherName from '../share/promptPublisherName';
import type { MacroInfo } from '../../../main/src/types';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import { isPluginDisallowed } from '../../../common/profiles';
import { useShares } from '../../redux/shares';
import { SHARE_TAB, type SharePanelData } from '../other/botSideBar/panelTabs';

export type PluginView = 'details' | 'options';

export const usePluginActions = () => {
  const navigate = useNavigate();
  const scripts = useSettingsStore(selectScripts);
  const { setPanel } = usePanelContext();
  const { message, modal } = useAppApi();

  return useMemo(() => {
    const writeUi = () => {
      const { search: _omit, ...rest } = useSettingsStore.getState().pluginsUi;
      try {
        window.localStorage.setItem(
          PLUGINS_UI_STORAGE_KEY,
          JSON.stringify(rest),
        );
      } catch {}
    };
    const patchUi = (
      patch: Partial<SettingsState['pluginsUi']>,
      skipPersist = false,
    ) => {
      setPluginsUi(patch);
      if (
        !skipPersist &&
        !('search' in patch && Object.keys(patch).length === 1)
      )
        writeUi();
    };
    return {
      selectPlugin: (plugin: MacroInfo, view: PluginView = 'details') =>
        setPanel({ active: true, tab: 'plugin', data: { plugin, view } }),

      togglePin: (pluginId: string, pinned?: boolean) => {
        set((state) => {
          const pd = state.settings.pluginData;
          pd[pluginId] ??= { pinned: false };
          pd[pluginId].pinned = pinned ?? !pd[pluginId].pinned;
        });
        const { pluginData } = useSettingsStore.getState().settings;
        window.ipcRenderer.action('UPDATE_PLUGIN_DATA', pluginData);
      },

      run: async (p: Pick<MacroInfo, 'pluginId' | 'name'>) => {
        const state = useSettingsStore.getState();
        if (
          isPluginDisallowed(
            state.JNdata?.data?.[state.appSettings.server ?? ''],
            p.pluginId,
          )
        ) {
          message.info('This plugin is disabled by the active profile');
          return;
        }
        await scripts.runPlugin(p);
      },

      editCode: (p: MacroInfo) =>
        navigate(
          (p.language === 'components'
            ? '/macros/'
            : p.language === 'recording'
              ? '/recordings/'
              : '/code/') + p.pluginId,
        ),

      exportPlugin: async (p: MacroInfo) => {
        const macro = await window.ipcRenderer.get<any>(
          'MACRO_CODE',
          p.pluginId,
        );
        if (macro?.status !== 'success' || !macro.code) {
          message.error(macro?.error || 'Failed to load plugin for export');
          return;
        }
        const payload = { macroInfo: macro.info || p, code: macro.code };
        type ExportResult = {
          status: 'success' | 'cancelled' | 'publisher-name-required' | 'error';
          message?: string;
          identity?: { fingerprint?: string };
        };
        let result = (await window.ipcRenderer.get(
          'EXPORT_MACRO',
          payload,
        )) as ExportResult;
        if (result?.status === 'publisher-name-required') {
          const configured = await promptPublisherName(
            { modal, message },
            result.identity?.fingerprint,
            'Save and export',
          );
          if (!configured) return;
          result = (await window.ipcRenderer.get('EXPORT_MACRO', payload)) as ExportResult;
        }
        if (result?.status === 'error') message.error(result.message);
        else if (result?.status === 'success') message.success('Plugin exported');
      },

      /** Plugins update through the share they were installed from. */
      updatePlugin: (pluginId: string) => {
        const share = Object.values(useShares.getState().installed).find(
          (item) => item.kind === 'plugin' && item.localRef === pluginId,
        );
        if (share) setPanel({ active: true, tab: SHARE_TAB, data: { link: share.id } satisfies SharePanelData });
      },

      savePlugin: (p: MacroInfo) => savePlugin(p),

      deletePlugin: async (p: MacroInfo) => {
        // Stop the plugin first if it's running.
        scripts.stopByScriptId(p.pluginId);
        await window.ipcRenderer.get('DELETE_MACRO', p);
        removeMacro(p.pluginId);
        setPanel({ active: false, tab: 'logs' });
        try {
          const cached = window.localStorage.getItem('macros_cache');
          if (cached) {
            const arr = (JSON.parse(cached) as MacroInfo[]).filter(
              (x) => x.pluginId !== p.pluginId,
            );
            window.localStorage.setItem('macros_cache', JSON.stringify(arr));
          }
        } catch {}
        message.success(`${p.name} deleted`);
      },

      duplicatePlugin: async (p: MacroInfo) => {
        const r = await window.ipcRenderer.get<any>(
          'DUPLICATE_MACRO',
          p.pluginId,
        );
        if (r?.status === 'success') {
          message.success(`Copied to "${r.name}"`);
          // Jump to the fresh copy. PluginInfoTab falls back to this
          // snapshot until the MACROS push lands in the store.
          setPanel({
            active: true,
            tab: 'plugin',
            data: { plugin: r as MacroInfo, view: 'details' },
          });
        } else {
          message.error(r?.message || 'Failed to copy plugin');
        }
      },

      importPlugin: async () => {
        let r: any;
        if (window.web) {
          const file = await new Promise<File | null>((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.jnp';
            input.onchange = () => resolve(input.files?.[0] ?? null);
            input.oncancel = () => resolve(null);
            input.click();
          });
          if (!file) return;
          r = await window.ipcRenderer.get('IMPORT_MACRO_FILE', { content: await file.text() });
        } else {
          r = await window.ipcRenderer.get<any>('IMPORT_MACRO');
        }
        if (r.status === 'success') message.success(r.message);
        else if (r.status === 'error') message.error(r.message);
      },

      setUi: patchUi,

      movePlugin: (pluginId: string, folder: string | null) => {
        const metadata = { ...useSettingsStore.getState().pluginMetadata };
        if (folder) metadata[pluginId] = { folder };
        else delete metadata[pluginId];
        setPluginMetadata(metadata);
      },

      renameFolder: (oldName: string, newName: string) => {
        const ui = useSettingsStore.getState().pluginsUi;
        const metadata = useSettingsStore.getState().pluginMetadata;
        const allFolders = new Set<string>(ui.extraFolders);
        Object.values(metadata).forEach(
          (m) => m.folder && allFolders.add(m.folder),
        );
        if (allFolders.has(newName)) {
          message.error(`Folder "${newName}" already exists`);
          return;
        }
        const nextMetadata = Object.fromEntries(
          Object.entries(metadata).map(([pluginId, value]) => [
            pluginId,
            value.folder === oldName ? { ...value, folder: newName } : value,
          ]),
        );
        setPluginMetadata(nextMetadata);
        patchUi({
          extraFolders: ui.extraFolders.map((f) =>
            f === oldName ? newName : f,
          ),
          folder: ui.folder === oldName ? newName : ui.folder,
        });
        message.success(`Renamed to "${newName}"`);
      },

      deleteFolder: (name: string) => {
        const ui = useSettingsStore.getState().pluginsUi;
        const metadata = useSettingsStore.getState().pluginMetadata;
        const nextMetadata = Object.fromEntries(
          Object.entries(metadata).filter(([, value]) => value.folder !== name),
        );
        setPluginMetadata(nextMetadata);
        patchUi({
          extraFolders: ui.extraFolders.filter((f) => f !== name),
          folder: ui.folder === name ? '__all__' : ui.folder,
        });
        message.success(`Folder "${name}" deleted`);
      },

      createFolder: (name: string) => {
        const ui = useSettingsStore.getState().pluginsUi;
        const metadata = useSettingsStore.getState().pluginMetadata;
        const existing = new Set<string>(ui.extraFolders);
        Object.values(metadata).forEach(
          (m) => m.folder && existing.add(m.folder),
        );
        if (existing.has(name)) {
          message.error(`Folder "${name}" already exists`);
          return;
        }
        patchUi({
          extraFolders: [...ui.extraFolders, name],
          folder: name,
        });
        message.success(`Folder "${name}" created`);
      },
    };
  }, [navigate, scripts, setPanel, message, modal]);
};
