import { shell } from 'electron';
import { FullLogMessage, LogMessage } from '../types';
import ScriptHandler from './ScriptHandler';
import fs from 'fs';
import path from 'path';
import Console from './Console';
import { backendMessaging } from '../messaging';

class ConsoleHandler {
  private console: Console;

  scriptHandler: ScriptHandler;

  constructor(
    scriptHandler: ScriptHandler,
    private readonly profileId: number,
    private readonly profileKey: string,
  ) {
    this.scriptHandler = scriptHandler;
    this.console = new Console(() =>
      this.scriptHandler.settings.getProfileAppSettings(this.profileKey),
    );
  }

  log(messages: LogMessage[], scriptID: string, scriptName: string) {
    const newLogs = this.console.log(messages, scriptID, scriptName);
    this.emitLogs(newLogs);
  }

  emitLogs(newLogs: FullLogMessage[]) {
    backendMessaging.messenger.publishToProfile(this.profileId, 'LOGS', newLogs)
  }

  getLogs() {
    return {
      scripts: this.scriptHandler.getRuntime(this.profileId).activeScripts.toObject(),
      logs: this.console.get(1000),
    };
  }



  clear(scriptName: string | undefined) {
    this.console.clear(scriptName);
  }

  openLogs() {
    const appSettings = this.scriptHandler.settings.getProfileAppSettings(
      this.profileKey,
    );
    const dir: string = appSettings.logging_dir as string;
    if (!dir?.length)
      return backendMessaging.messenger.publishToProfile(this.profileId, 'snackbar', {
        variant: 'error',
        title: 'No logging directory found',
      });
    if (!fs.existsSync(path.resolve(dir)))
      return backendMessaging.messenger.publishToProfile(this.profileId, 'snackbar', {
        variant: 'error',
        title: 'Incorrect path to logging directory',
      });
    shell.openPath(path.resolve(dir));
  }

  getAllLogs(): FullLogMessage[] {
    return this.console.toList();
  }

  public getConsole() {
    return this.console.get(20);
  }
}

export default ConsoleHandler;
