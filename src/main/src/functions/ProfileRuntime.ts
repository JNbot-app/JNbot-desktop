import type { BrowserWindow } from 'electron';
import ActiveBots_ from './ActiveBots';
import ActiveScripts_ from './ActiveScripts';
import ConsoleHandler from './ConsoleHandler';
import ScriptActionHandler from './ScriptActionHandler';
import type ScriptHandler_ from './ScriptHandler';
import type Settings_ from './Settings';
import { backendMessaging } from '../messaging';

/** All mutable backend state belonging to one enabled profile. */
export default class ProfileRuntime {
  readonly activeScripts: ActiveScripts_;
  readonly activeBots: ActiveBots_;
  readonly consoleHandler: ConsoleHandler;
  readonly scriptActionHandler: ScriptActionHandler;
  workingIps: string[] = [];
  cooldownLastTickAt = Date.now();
  cooldownTimer?: ReturnType<typeof setInterval>;

  constructor(
    readonly profileId: number,
    readonly profileKey: string,
    settings: Settings_,
    mainWindow: BrowserWindow,
    scriptHandler: ScriptHandler_,
  ) {
    this.activeScripts = new ActiveScripts_(
      mainWindow,
      settings,
      scriptHandler,
      profileId,
      profileKey,
    );
    this.activeBots = new ActiveBots_(
      mainWindow,
      settings,
      scriptHandler,
      profileId,
      profileKey,
    );
    this.consoleHandler = new ConsoleHandler(
      scriptHandler,
      profileId,
      profileKey,
    );
    this.scriptActionHandler = new ScriptActionHandler(profileId);
    let { triggers, altTags } = settings.getProfileSettings(profileKey);
    settings.on(`profile:settings:${profileKey}`, (value) => {
      backendMessaging.messenger.publishToProfile(profileId, 'settings', value);
      this.publishAlts(settings);
      // Patches replace these arrays, so a reference check spots real edits.
      if (value.triggers === triggers && value.altTags === altTags) return;
      ({ triggers, altTags } = value);
      for (const script of this.activeScripts)
        script.send('TRIGGERS_UPDATE', { triggers, altTags });
    });
    settings.on('shared', () => this.publishAlts(settings));
    settings.on(`profile:appSettings:${profileKey}`, (value) => {
      backendMessaging.messenger.publishToProfile(
        profileId,
        'appSettings',
        value,
      );
    });
    settings.on('sharedAppSettings', () => {
      backendMessaging.messenger.publishToProfile(
        profileId,
        'appSettings',
        settings.getProfileAppSettings(profileKey),
      );
    });
    settings.stats.on('change', () => {
      backendMessaging.messenger.publishToProfile(
        profileId,
        'mobileActivity',
        settings.stats.mobileActivity(),
      );
    });
  }

  private publishAlts(settings: Settings_): void {
    backendMessaging.messenger.publishToProfile(
      this.profileId,
      'alts',
      settings.getAltsWithDataForProfile(this.profileKey),
    );
  }
}
