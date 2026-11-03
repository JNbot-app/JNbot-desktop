import { Themes } from '../../common/CommonEnums';
import {
  updateAppSetting,
  updateScriptSettings,
  useSettingsStore,
} from './settings';

describe('app settings updates', () => {
  const ipcAction = jest.fn();
  const profileAction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    window.ipcRenderer = { action: ipcAction } as any;
    window.messenger = { profileAction } as any;
    window.__appSettings = {};
    useSettingsStore.setState({
      appSettings: {
        server: 'jartexnetwork',
        ip: 'old.example.test',
        sidebarCollapsed: false,
        theme: Themes.GOLD,
      },
      selectedProfileId: 7,
      selectedProfileKey: 'jartexnetwork',
      theme: Themes.GOLD,
    });
  });

  it('sends a profile setting as a single patch', () => {
    updateAppSetting('ip', 'new.example.test');

    expect(profileAction).toHaveBeenCalledWith(7, 'APPSETTINGS_UPDATE', {
      key: 'ip',
      value: 'new.example.test',
    });
    expect(ipcAction).not.toHaveBeenCalled();
  });

  it('sends a global setting through the same patch channel', () => {
    updateAppSetting('sidebarCollapsed', true);

    expect(profileAction).toHaveBeenCalledWith(7, 'APPSETTINGS_UPDATE', {
      key: 'sidebarCollapsed',
      value: true,
    });
    expect(ipcAction).not.toHaveBeenCalled();
  });

  it('updates local app settings before a profile is active', () => {
    useSettingsStore.setState({
      selectedProfileId: null,
      appSettings: { ...useSettingsStore.getState().appSettings, gettingStarted: null },
    });
    updateAppSetting('gettingStarted', []);

    expect(useSettingsStore.getState().appSettings.gettingStarted).toEqual([]);
    expect(ipcAction).not.toHaveBeenCalled();
    expect(profileAction).not.toHaveBeenCalled();
  });

  it('does not persist profile settings without an active profile', () => {
    useSettingsStore.setState({ selectedProfileId: null });
    updateAppSetting('ip', 'new.example.test');

    expect(ipcAction).not.toHaveBeenCalled();
    expect(profileAction).not.toHaveBeenCalled();
  });

  it('sends general settings updates as targeted patches', () => {
    useSettingsStore.setState({
      settings: {
        scripts: {},
        pluginData: {},
        reminders: [],
        triggers: [],
        altTags: [],
        altData: {},
        version: 2,
      },
    });

    updateScriptSettings({
      scriptName: 'chat',
      optionId: 'gamemode',
      value: 'survival',
    });

    expect(profileAction).toHaveBeenCalledWith(7, 'SETTINGS_UPDATE', [
      {
        path: ['scripts', 'chat', 'gamemode'],
        value: 'survival',
      },
    ]);
  });
});
