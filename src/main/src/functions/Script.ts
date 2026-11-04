import { Worker } from 'worker_threads';
import {
  AppSettings,
  MacroInfo,
  Progress,
  ScriptSettings,
  SettingsObj,
  SharedSettings,
  WorkerDataType,
} from '../types';
import BotEvents from './BotEvents';
import ScriptHandler_ from './ScriptHandler';
import { app } from 'electron';
import ActiveScripts_ from './ActiveScripts';
import { getMinecraftAuthDir } from './minecraft/minecraftPaths';
import { devicePath } from './storage/portablePaths';
import { workerDataPath, workerEntryPath } from './workerPaths';
import { toRunnableJs } from './transpile';
import { backendMessaging } from '../messaging';
import { Address, workerScriptAddress } from '../../../common/messaging';
import type ProfileRuntime from './ProfileRuntime';
import { randomUUID } from 'crypto';
import { getAiService, cancelAiOwner } from '../ai/AiService';


class Script_ extends BotEvents {
  name: string;
  id: string;
  scriptSettings: ScriptSettings;
  progress: Progress | null = null;
  controls: number = 0;
  startCount: number = 0;
  worker!: Worker;
  activeScripts: ActiveScripts_;
  scriptOptions;
  scriptHandler: ScriptHandler_;
  forceExit: boolean = false;
  startTime: number;
  scriptId: string; // ScriptId is important for distinguishing between multiple plugins with the same name. The pluginId is used here, else it's the script name.
  instanceId: number;
  /** Run-local routing IDs. The legacy names remain until UI data is migrated. */
  runtimeProfileId: number;
  runtimeScriptId: number;
  pluginId: string;
  messagingAddress: Address;
  private disposeMessagingRoute?: () => void;
  workingIps: string[];

  settings: SettingsObj;
  sharedSettings: SharedSettings;
  appSettings: AppSettings;

  options = {
    waitBeforeTerminate: false, // These options depend on the script you run, they came from the worker.
  };
  onExitPromise?: Promise<number[]>;

  constructor(
    scriptSettings: ScriptSettings,
    scriptHandler: ScriptHandler_,
    public readonly profile: ProfileRuntime,
    scriptOptions: {
      instanceId: number;
    },
    public sharedArray: Uint16Array,
  ) {
    super(
      profile.activeBots,
      profile.activeScripts.mainWindow,
      scriptHandler.minecraftBridgeManager,
    );
    this.name = scriptSettings.script;
    this.scriptId = scriptSettings.scriptId;
    this.pluginId = scriptSettings.scriptId;
    this.instanceId = scriptOptions.instanceId;
    this.runtimeScriptId = scriptOptions.instanceId;
    this.runtimeProfileId = profile.profileId;
    this.messagingAddress = workerScriptAddress(
      this.runtimeProfileId,
      this.runtimeScriptId,
    );

    this.settings = scriptHandler.settings.getProfileSettings(profile.profileKey);
    this.sharedSettings = scriptHandler.settings.shared;
    this.appSettings = scriptHandler.settings.getProfileAppSettings(profile.profileKey);

    this.scriptSettings = scriptSettings;
    this.id = this.name + '-' + this.instanceId;
    this.activeScripts = profile.activeScripts;
    this.scriptHandler = scriptHandler;
    this.scriptOptions = scriptOptions;
    this.startTime = Date.now();
    this.workingIps = [...profile.workingIps];
    super.setScript(this);
  }

  toString() {
    return `Script(name="${this.name}", id="${this.id}", running=${!!this.worker})`;
  }

  async run() {

    const workerPath = workerEntryPath();
    // Resolve this runtime profile's optional bot-extension code before
    // spawning the worker. Same plumbing as `profileUiAction` — using
    // `ProfileScripts_` so plugin/bundled/checksum logic is reused. The
    // worker receives the runnable code and plugin metadata (or undefined
    // when nothing is configured or resolution fails).
    const botExtension = await this.resolveBotExtension();
    return new Promise((resolve, reject) => {
      let startupSettled = false;
      const settleStartup = (error?: Error) => {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(startupTimer);
        if (error) reject(error);
        else resolve(true);
      };
      const startupTimer = setTimeout(() => {
        const error = new Error(`Script ${this.name} did not become ready in time.`);
        void this.worker?.terminate();
        settleStartup(error);
      }, 40_000);
      const execArgv: string[] = ['--no-deprecation'];

      const workerData: WorkerDataType = {
        scriptName: this.scriptSettings.scriptName, // Needed to run the correct file
        script: this.name, // visible script name
        id: this.id, // script id, will get assigned once the worker is created (since it includes the threadid)
        instanceId: this.instanceId,
        messaging: {
          address: this.messagingAddress,
          profileId: this.runtimeProfileId,
          scriptId: this.runtimeScriptId,
        },
        scriptId: this.scriptId, // script id, used to distinguish between multiple scripts with the same name
        pluginId: this.pluginId,
        data: this.scriptSettings.arguments, // contains arguments for the script
        appSettings: this.appSettings, //app settings
        execArgv,
        sharedArray: this.sharedArray, // shared array buffer
        settings: this.settings,
        sharedSettings: this.sharedSettings,
        profile: this.scriptHandler.settings.getProfile(this.profile.profileKey),
        paths: {
          plugins: this.scriptHandler.macros.macros_path,
          recordings: this.scriptHandler.recordings.recordingsPath,
          ai: devicePath('ai'),
          minecraftAuth: getMinecraftAuthDir(app.getPath('userData')),
        },
        scriptOptions: {
          startTime: Date.now(),
          ips: this.profile.workingIps,
          // Mobile has no desktop console UI, so retain worker output for
          // native diagnostics and Sentry forwarding.
          disableConsolePrints:
            process.env.CLI_MODE === 'true' && !global.isMobileRuntime,
        },
        actions: this.scriptHandler.getActions(),
        startCount: this.startCount,
        botExtension,
        appVersion: app.getVersion(),
        isMobileRuntime: !!global.isMobileRuntime,
      };

      let worker: Worker;

      try {
        worker = new Worker(workerPath, {
          workerData,
          execArgv: execArgv.length > 0 ? execArgv : undefined,
          env: { MC_DATA_PATH: workerDataPath() },
          //  env: SHARE_ENV,
        });
      } catch (error) {
        settleStartup(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.worker = worker;
      const aiOwner = `${workerScriptAddress(this.runtimeProfileId, this.runtimeScriptId)}:${randomUUID()}`;
      worker.once('exit', () => cancelAiOwner(aiOwner));
      this.disposeMessagingRoute = backendMessaging.registerWorker(
        worker,
        this.runtimeProfileId,
        this.runtimeScriptId,
        async (event, data) => {
          if (event === 'AI_REQUEST' || event === 'AI_CANCEL')
            return getAiService().request(
              aiOwner,
              data,
              this.scriptSettings.arguments?.macroInfo?.security?.ai?.networkAllowed !== false,
            );
          if (event === 'READY') {
            this.activeScripts.addScript(this);
            settleStartup();
            return;
          }
          if (!(event in this))
            throw new Error(`Unknown worker event: ${event}`);
          const handler = (this as unknown as Record<string, unknown>)[event];
          if (typeof handler !== 'function')
            throw new Error(`Worker event is not callable: ${event}`);
          return await (handler as (value: unknown) => unknown).call(
            this,
            data,
          );
        },
      );

      this.onExitPromise = new Promise((resolve) => {
        this.worker.once('exit', (code) => resolve([code]));
      });
      this.worker.once('error', (error) => settleStartup(error));
      this.worker.once('exit', (code) => {
        if (global.isMobileRuntime && code !== 0 && code !== 1) {
          process.emit('jnbot-mobile-error', {
            source: 'worker:exit',
            message: `Worker exited with code ${code}.`,
            script: this.name,
            instanceId: this.instanceId,
            exitCode: code,
          });
        }
        if (!startupSettled)
          settleStartup(new Error(`Script ${this.name} exited before it was ready (code ${code}).`));
      });
      this.onExitPromise.then(() => {
        this.disposeMessagingRoute?.();
        this.disposeMessagingRoute = undefined;
        this.scriptHandler.minecraftBridgeManager.unsubscribeAllClientEventsForScript(
          this.instanceId,
        );
        this.scriptHandler.automationService.releaseScriptCaptures(
          this.instanceId,
        );
        this.scriptHandler.minecraftServerManager.managedBridge.unsubscribeAll(
          this.instanceId,
        );

        if (
          !this.forceExit &&
          this.appSettings.script_finished_sound === true
        ) {
          backendMessaging.messenger.publishToProfile(
            this.profile.profileId,
            'actions',
            ['script_finished', null],
          );
        }

        this.activeBots.removeBotByScript(this);
        this.activeScripts.removeScript(this);
      });

      worker.on('error', (err) => {
        if (global.isMobileRuntime) {
          process.emit('jnbot-mobile-error', {
            source: 'worker:error',
            message: err.message,
            stack: err.stack,
            script: this.name,
            instanceId: this.instanceId,
          });
        }
        const isProfileScript = !!this.scriptHandler.profileScriptByPluginId(
          this.profile.profileId,
          this.scriptId,
        );
        if (this.name !== 'macro' || isProfileScript)
          this.scriptHandler.errorHandler.handle({
            message: '[WORKER ERROR]:' + err.message,
            stack: err.stack,
            script: this.name,
          }, this.profile.profileId);
        console.error('[WORKER ERROR]: ', err);
      });

    });
  }

  send(event: string, data: any) {
    backendMessaging.messenger.send(event, this.messagingAddress, data);
  }

  stop() {
    this.forceExit = true;
    this.activeBots.cancelBotJoinRequestsByScript(this);
    return new Promise((resolve) => {
      let terminated = false;

      this.onExitPromise?.then(() => {
        terminated = true;
        resolve(true);
      });

      this.send('TERMINATE', true);
      // Delay is needed to properly close the bot
      sleep(this.options.waitBeforeTerminate ? 1100 : 100).then(() => {
        if (!terminated) this.worker?.terminate();
      });
    });
  }
  async restart(fast = false) {
    if (fast && typeof this.progress?.current === 'number') {
      this.startCount = this.progress.current;
    }
    if (this.worker) await this.stop();
    this.forceExit = false;
    await this.run();
  }

  updateProgress(progress: Progress) {
    this.progress = progress;
    if (typeof progress?.current === 'number') {
      this.startCount = progress.current;
    }
    const p = this.activeScripts.getProgress(this.instanceId);
    this.scriptHandler.emit('PROGRESS_UPDATE', p, this);
  }

  setControls(controls: number) {
    this.controls = Number.isFinite(controls) ? controls : 0;
    // Re-broadcast the active-scripts list so the renderer can show/hide the
    // matching control buttons for this instance.
    this.activeScripts.send();
  }

  /**
   * Resolve this runtime profile's `botExtensionAction` (if any) to runnable
   * code and metadata for the bot worker. JS/TS only. Returns `undefined`
   * when nothing can be loaded (with failures logged).
   */
  private async resolveBotExtension(): Promise<{ code: string; info: MacroInfo } | undefined> {
    const active = this.scriptHandler.settings.getProfile(this.profile.profileKey);
    const ref = active?.data?.botExtensionAction;
    if (
      !ref ||
      this.scriptHandler.isPluginDisallowed(this.profile.profileId, ref.pluginId)
    )
      return undefined;

    const scripts = this.scriptHandler.settings.profiles.scripts;
    if (!scripts) return undefined;

    try {
      const resolved = await scripts.resolve(ref, true);
      if (!resolved) {
        console.warn('[Script] bot extension could not be resolved');
        return undefined;
      }
      if (resolved.info.language !== 'js' && resolved.info.language !== 'ts') {
        console.warn(
          '[Script] bot extension must use JavaScript/TypeScript — skipping',
        );
        return undefined;
      }
      const code = (resolved.code as { code?: string })?.code;
      if (typeof code !== 'string' || !code.length) return undefined;
      return {
        code: await toRunnableJs(code, resolved.info.language),
        info: resolved.info,
      };
    } catch (err) {
      console.warn('[Script] failed to resolve bot extension', err);
      return undefined;
    }
  }
}

function sleep(x: number) {
  return new Promise((resolve) => setTimeout(resolve, x));
}

export default Script_;
