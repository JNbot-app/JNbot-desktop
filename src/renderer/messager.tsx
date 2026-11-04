import { useEffect } from 'react';
import { Button, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { NotificationInstance } from 'antd/es/notification/interface';
import type {
  ActiveActionsType,
  ActiveBotsType,
  ActiveScriptsType,
  AppSettings,
  ButtonSnackbarProps,
  JNbotServerStatus,
  JNdata,
  MacroInfo,
  SettingsObj,
  SharedSettings,
  Stats,
  UpdateData,
} from '../main/src/types';
import type { CustomProfile } from '../common/profiles';
import type { Address } from '../common/messaging';
import type { BotKickedPayload } from '../common/mobileClientContract';
import {
  remoteAccessCapabilities,
  type RemoteAccessCapabilities,
} from '../common/clientPermissions';
import { Language } from './providers/AppProvider';
import type { NotificationType, ProxyInfo } from './redux/store';
import {
  addNotification,
  setActiveBots,
  setActiveScript,
  setActiveScriptActions,
  setAppSettings,
  setCustomProfiles,
  setDevices,
  setJNbotProxyInfo,
  setJNdata,
  setMacros,
  setRecordings,
  setSelectedBot,
  setSettings,
  setShared,
  setStats,
  setUpdate,
  applyProfilePublication,
  applyProfileSnapshot,
  useSettingsStore,
  set,
} from './redux/settings';
import { clearSelectedProfileKey } from './redux/profileSelection';
import ButtonSnackbar from './components/other/ButtonSnackbar';
import gkitsReadySound from './assets/gkit_sound.mp3';
import scriptFinishedSound from './assets/script_finished.mp3';
import useAppApi from './hooks/useAppApi';
import useApp from './hooks/useApp';

type PopupId = string | number;

type PopupPayload = {
  title: string;
  buttons?: ButtonSnackbarProps['btns'];
  popupID: PopupId;
  body?: string;
  isMain?: boolean;
  messageAddress?: Address;
};

type SnackbarVariant = Extract<
  keyof NotificationInstance,
  'success' | 'error' | 'warning' | 'info'
>;

type SnackbarPayload = {
  title: string;
  variant?: SnackbarVariant;
};

type MessageType = Extract<
  keyof MessageInstance,
  'success' | 'error' | 'warning' | 'info'
>;

type MessagePayload = Parameters<MessageInstance['open']>[0] & {
  type?: MessageType;
};

type ImportMacroFileResult = {
  status: 'success' | 'error';
  message?: string;
};

type McpApprovalNotification = {
  id: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  requiresReview: boolean;
};


type MacroWithLegacyPluginId = MacroInfo & {
  publicKey?: string;
};

const snackbarVariants = new Set<SnackbarVariant>([
  'success',
  'error',
  'warning',
  'info',
]);

const messageTypes = new Set<MessageType>([
  'success',
  'error',
  'warning',
  'info',
]);

const isSnackbarVariant = (value: unknown): value is SnackbarVariant =>
  typeof value === 'string' && snackbarVariants.has(value as SnackbarVariant);

const isMessageType = (value: unknown): value is MessageType =>
  typeof value === 'string' && messageTypes.has(value as MessageType);

const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' &&
  Object.values(Language).includes(value as Language);

const normalizeMacros = (macros: MacroWithLegacyPluginId[]): MacroInfo[] =>
  macros.map((macro) => ({
    ...macro,
    pluginId: macro.pluginId || macro.publicKey || macro.name,
  }));

function SocketHandler(): null {
  const { snackbar, message } = useAppApi();
  const { setTheme, setLanguage } = useApp();
  const selectedProfileKey = useSettingsStore(
    (state) => state.selectedProfileKey,
  );

  useEffect(() => {
    if (!selectedProfileKey) return;
    let current = true;
    void window.messenger
      .watchProfile(selectedProfileKey, (publication) => {
        if (current) applyProfilePublication(publication);
      })
      .then((snapshot) => {
        if (current) applyProfileSnapshot(snapshot);
      })
      .catch((error) => {
        if (!current) return;
        console.error('Failed to watch profile', error);
        clearSelectedProfileKey();
        set((state) => {
          if (state.selectedProfileKey !== selectedProfileKey) return;
          state.selectedProfileKey = null;
          state.selectedProfileId = null;
          state.ready = true;
          state.activeScripts = {};
          state.activeBots = [];
          state.activeScriptActions = {};
          state.selectedBot = null;
        });
        message.error(
          `Could not open ${selectedProfileKey}. Choose another profile.`,
        );
      });
    return () => {
      current = false;
    };
  }, [selectedProfileKey, message]);

  useEffect(() => {
    const removeListeners: Array<() => void> = [];

    const remoteBootstrap = (event: Event) => {
      const data = (event as CustomEvent).detail as {
        jndata?: JNdata;
        profiles?: CustomProfile[];
        appSettings?: AppSettings;
        shared?: SharedSettings;
        stats?: Stats;
        permissions?: {
          permissionMask?: number;
          capabilities?: RemoteAccessCapabilities;
        };
      };
      if (data.jndata) {
        window.__JNdata = data.jndata;
        setJNdata(data.jndata);
      }
      if (data.profiles) setCustomProfiles(data.profiles);
      if (data.shared) setShared(data.shared);
      if (data.stats) setStats(data.stats);
      if (data.appSettings) {
        // A browser may have a remembered profile key from another access
        // link. The server-provided default is already permission-filtered.
        const available =
          data.jndata?.serverList ?? useSettingsStore.getState().JNdata.serverList;
        set((state) => {
          const currentKey = state.selectedProfileKey;
          const currentValid = currentKey && available.includes(currentKey);
          if (!currentValid) {
            state.selectedProfileKey = data.appSettings?.server ?? null;
            state.selectedProfileId = null;
            state.ready = !data.appSettings?.server;
          }
        });
        setAppSettings(data.appSettings);
        if (data.appSettings.theme) setTheme(data.appSettings.theme);
      }
      if (typeof data.permissions?.permissionMask === 'number') {
        const permissionMask = data.permissions.permissionMask;
        const derivedCapabilities = remoteAccessCapabilities(permissionMask);
        set((state) => {
          state.remotePermissionMask = permissionMask;
          state.remoteCapabilities = derivedCapabilities;
        });
      }
    };
    window.addEventListener('jnbot:remote-bootstrap', remoteBootstrap);
    removeListeners.push(() => window.removeEventListener('jnbot:remote-bootstrap', remoteBootstrap));
    const remoteStats = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data) setStats(data as Stats);
    };
    window.addEventListener('jnbot:remote-stats', remoteStats);
    removeListeners.push(() => window.removeEventListener('jnbot:remote-stats', remoteStats));
    const permissionsUpdated = () => {
      const state = useSettingsStore.getState();
      const available = state.JNdata.serverList;
      if (!state.selectedProfileKey || !available.includes(state.selectedProfileKey)) {
        const next = available[0] ?? null;
        set((draft) => {
          draft.selectedProfileKey = next;
          draft.selectedProfileId = null;
          draft.ready = !next;
          draft.activeBots = [];
          draft.activeScripts = {};
        });
      } else if (state.selectedProfileKey && window.messenger?.watchProfile) {
        window.messenger
          .watchProfile(state.selectedProfileKey, applyProfilePublication)
          .then(applyProfileSnapshot)
          .catch((error) => console.error('Failed to refresh profile on permission update', error));
      }
    };
    window.addEventListener('jnbot:permissions-updated', permissionsUpdated);
    removeListeners.push(() => window.removeEventListener('jnbot:permissions-updated', permissionsUpdated));

    const remoteError = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { message?: unknown }
        | undefined;
      message.error(
        typeof detail?.message === 'string'
          ? detail.message
          : 'The remote operation failed.',
      );
    };
    window.addEventListener('jnbot:remote-error', remoteError);
    removeListeners.push(() =>
      window.removeEventListener('jnbot:remote-error', remoteError),
    );

    const buttonPopup = ({
      title,
      buttons,
      popupID,
      body,
      isMain,
      messageAddress,
    }: PopupPayload): void => {
      const notifyDismissed = (): void => {
        if (isMain) {
          window.ipcRenderer.send('popup-buttons', {
            targetId: popupID,
            response: null,
          });
          return;
        }

        if (messageAddress !== undefined) {
          window.messenger.send(`popup-buttons-${popupID}`, messageAddress, {
            response: null,
          });
        }
      };

      snackbar.open({
        title,
        description: body,
        actions: (
          <ButtonSnackbar
            btns={buttons}
            popupID={String(popupID)}
            isMain={isMain}
            messageAddress={messageAddress}
            onClose={() => snackbar.destroy(popupID)}
          />
        ),
        placement: 'bottomRight',
        duration: 0,
        key: popupID,
        onClose: notifyDismissed,
      });
    };

    removeListeners.push(
      window.ipcRenderer.on('appSettings', (data: AppSettings) => {
        setAppSettings(data);
        if (data.theme) setTheme(data.theme);
        if (isLanguage(data.locale)) setLanguage(data.locale);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('sharedAppSettings', (data: AppSettings) => {
        const current = useSettingsStore.getState().appSettings;
        setAppSettings({ ...current, ...data, server: current.server });
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('JNdata', (data: JNdata) => {
        window['__JNdata'] = data;
        setJNdata(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('profiles', (data: CustomProfile[]) => {
        if (Array.isArray(data)) setCustomProfiles(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('activeScripts', (data: ActiveScriptsType) => {
        setActiveScript(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('settings', (data: SettingsObj | null) => {
        if (data) setSettings(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('shared', (data: SharedSettings | null) => {
        if (!data) return;
        setShared(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('bot-kicked', (data: BotKickedPayload) => {
        const title = `${data.username} got kicked`;
        snackbar.error({ message: title, showProgress: true });
        addNotification({
          title,
          message: data.reason,
          type: 'error',
          buttons: [
            { label: 'Open bot', action: 'openBot', botId: data.botId },
          ],
        });
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('devices', (data: JNbotServerStatus) => {
        setDevices(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on(
        'notification',
        (data: Omit<NotificationType, 'timestamp'>) => {
          if (!data.title) return;
          addNotification({
            title: data.title,
            message: data.message,
            type: data.type ?? 'info',
            buttons: data.buttons,
          });
        },
      ),
    );

    removeListeners.push(
      window.ipcRenderer.on(
        'actions',
        ([event, data]: [
          'gkits_ready' | 'script_finished' | 'update_state',
          UpdateData,
        ]) => {
          if (event === 'gkits_ready') {
            new Audio(gkitsReadySound).play().catch(() => {});
          } else if (event === 'script_finished') {
            new Audio(scriptFinishedSound).play().catch(() => {});
          } else {
            setUpdate(data);
          }
        },
      ),
    );

    removeListeners.push(
      window.ipcRenderer.on('snackbar', (data: SnackbarPayload | null) => {
        if (!data?.title) {
          console.error('Invalid snackbar data', data);
          return;
        }

        if (isSnackbarVariant(data.variant)) {
          snackbar[data.variant]({ message: data.title });
          return;
        }

        snackbar.open({
          message: data.title,
          showProgress: true,
          pauseOnHover: true,
        });
      }),
    );

    removeListeners.push(window.ipcRenderer.on('popup-buttons', buttonPopup));

    removeListeners.push(
      window.ipcRenderer.on(
        'MCP_APPROVAL_REQUESTED',
        (approval: McpApprovalNotification) => {
          const key = `mcp-approval-${approval.id}`;
          addNotification({
            title: 'AI approval required',
            message: approval.summary,
            type: approval.risk === 'high' ? 'warning' : 'info',
          });
          const decide = async (approved: boolean) => {
            try {
              const result = await window.ipcRenderer.get(
                'MCP_DECIDE_APPROVAL',
                { approvalId: approval.id, approved },
              );
              snackbar.destroy(key);
              if (!approved) {
                message.info('AI request denied');
              } else if (result.execution?.status === 'running') {
                message.success('AI request approved; execution started');
              } else {
                message.success('AI request approved');
              }
            } catch (error) {
              message.error(
                error instanceof Error
                  ? error.message
                  : 'Could not decide AI request',
              );
            }
          };
          snackbar.open({
            key,
            message: 'AI approval required',
            description: approval.summary,
            duration: 0,
            placement: 'bottomRight',
            actions: (
              <Space>
                <Button onClick={() => void decide(false)}>Deny</Button>
                {approval.requiresReview ? (
                  <Button
                    type="primary"
                    onClick={() => {
                      window.location.hash = '/mcp?tab=approvals';
                      snackbar.destroy(key);
                    }}
                  >
                    Review
                  </Button>
                ) : (
                  <Button type="primary" onClick={() => void decide(true)}>
                    Approve
                  </Button>
                )}
              </Space>
            ),
          });
        },
      ),
    );

    removeListeners.push(
      window.ipcRenderer.on('activeBots', (data: ActiveBotsType) => {
        setActiveBots(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('stats', (data: Stats) => {
        setStats(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on(
        'ACTIVE_ACTION_SCRIPT',
        (data: ActiveActionsType) => {
          setActiveScriptActions(data);
        },
      ),
    );

    removeListeners.push(
      window.ipcRenderer.on(
        'SELECTED_BOT',
        (data: ActiveBotsType[number] | null) => {
          setSelectedBot(data);
        },
      ),
    );

    removeListeners.push(
      window.ipcRenderer.on('NOTIFICATION_MESSAGE', (data: MessagePayload) => {
        const content =
          typeof data?.content === 'string' ? data.content : undefined;
        if (content && /\b(?:timed out|timeout)\b/i.test(content)) return;
        const type = isMessageType(data.type) ? data.type : 'info';
        message[type](data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('PROXY:INFO', (data: ProxyInfo | null) => {
        setJNbotProxyInfo(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('RECORDINGS', (data: unknown) => {
        setRecordings(data);
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('file-dropped', (filePaths: string[]) => {
        if (!Array.isArray(filePaths)) return;

        const macroFiles = filePaths.filter(
          (filePath) =>
            filePath.endsWith('.jnbot') || filePath.endsWith('.jnp'),
        );

        macroFiles
          .reduce(
            (pending, filePath) =>
              pending.then(async () => {
                try {
                  const result =
                    await window.ipcRenderer.get<ImportMacroFileResult>(
                      'IMPORT_MACRO_FILE',
                      filePath,
                    );
                  if (result.status === 'success') {
                    snackbar.success({ message: result.message });
                  } else {
                    snackbar.error({
                      message: result.message ?? 'Failed to import plugin',
                    });
                  }
                } catch (error) {
                  console.error('Error importing plugin:', error);
                  snackbar.error({ message: `Failed to import ${filePath}` });
                }
              }),
            Promise.resolve(),
          )
          .catch((error: unknown) => {
            console.error('Error processing dropped macro files:', error);
          });
      }),
    );

    removeListeners.push(
      window.ipcRenderer.on('MACROS', (data: MacroWithLegacyPluginId[]) => {
        if (!Array.isArray(data)) return;
        const macros = normalizeMacros(data);

        try {
          window.localStorage.setItem('macros_cache', JSON.stringify(macros));
        } catch {
          // Storage can be unavailable or full; the live IPC payload still wins.
        }

        setMacros(macros);
      }),
    );

    try {
      const cached = window.localStorage.getItem('macros_cache');
      if (cached) {
        const macros: unknown = JSON.parse(cached);
        if (Array.isArray(macros)) {
          setMacros(normalizeMacros(macros as MacroWithLegacyPluginId[]));
        }
      }
    } catch {
      // Ignore malformed or inaccessible cache data and request fresh macros.
    }

    window.ipcRenderer.action('GET_MACROS');
    window.ipcRenderer.send('LOADED');

    return () => {
      removeListeners.forEach((removeListener) => removeListener());
    };
  }, [message, setLanguage, setTheme, snackbar]);

  return null;
}

export default SocketHandler;
