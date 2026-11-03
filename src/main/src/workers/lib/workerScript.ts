import type {
  ActiveProfileObj,
  ActiveScriptsType,
  AltWithData,
  ButtonSnackbarProps,
  JNdata,
  MacroInfo,
  PluginSummary,
  ProfileScriptSummary,
  WorkerDataType,
  WorkerLogEntry,
} from '../../../src/types';
import { workerData as workerData_ } from 'worker_threads';
import McClient from './WorkerMcClient';
import McServer from './WorkerMcServer';
import assert from 'node:assert';
import { OptionErrorOptions } from '../compiler/scriptApi';
import { WorkerMessenger } from './WorkerMessenger';
import type {
  Address,
  MessageHandler,
  RequestOptions,
  Unsubscribe,
} from '../../../../common/messaging';
import { BACKEND, workerScriptAddress } from '../../../../common/messaging';
import type { McServerHandleSummary } from '../../../../common/minecraftServers';

/** Payload for {@link WorkerScript.startScript}. Mirrors the renderer's. */
export interface StartScriptPayload {
  script: string;
  scriptId?: string;
  arguments?: Record<string, any>;
  scriptOptions?: Record<string, any>;
  console?: string;
}

let workerData = workerData_ as WorkerDataType;

export class WorkerScript {
  private static keyCounter = 1;
  public readonly workerData: WorkerDataType = workerData_;
  public readonly messenger: WorkerMessenger;
  public readonly pluginId: string;
  public readonly settings: WorkerDataType['settings'];
  public readonly sharedSettings: WorkerDataType['sharedSettings'];
  public readonly appSettings: WorkerDataType['appSettings'] = workerData?.appSettings;
  public readonly startCount: number = workerData?.startCount ?? 0;

  constructor() {
    const messaging = workerData?.messaging ?? {
      address: workerScriptAddress(1, 1),
      profileId: 1,
      scriptId: 1,
    };
    this.messenger = new WorkerMessenger(
      messaging.address as Address,
      messaging.profileId,
      messaging.scriptId,
    );
    this.pluginId = this.workerData?.pluginId;
    this.settings = this.workerData?.settings;
    this.sharedSettings = this.workerData?.sharedSettings;
  }

  private nextKey(): number {
    return WorkerScript.keyCounter++;
  }

  send(event: string, payload?: unknown): void {
    this.messenger.send('worker:event', BACKEND, { event, data: payload });
  }

  sendToClients(event: string, payload?: any) {
    this.messenger.publishProfile(this.messenger.profileId, event, payload);
  }

  async sendAsync<T = unknown>(
    event: string,
    payload?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.messenger.request(
      'worker:action',
      BACKEND,
      {
        event,
        data: payload,
      },
      options,
    );
  }

  onMessage<T = unknown, R = unknown>(
    event: string,
    handler: MessageHandler<T, R>,
  ): Unsubscribe {
    return this.messenger.sub(event, this.messenger.address, handler);
  }

  onceMessage<T = unknown>(
    event: string,
    handler: (data: T) => unknown,
  ): Unsubscribe {
    let unsubscribe = () => {};
    unsubscribe = this.onMessage(event, (data) => {
      unsubscribe();
      return handler(data as T);
    });
    return unsubscribe;
  }

  // Running mean of milliseconds per progress unit, used to estimate the ETA.
  private etaTracker: {
    lastTime: number;
    lastCurrent: number;
    msPerUnit: number;
    samples: number;
  } | null = null;

  setProgress(progress: { current: number; total: number } | null = null) {
    if (!progress || !progress.total) {
      this.etaTracker = null;
      global.send('PROGRESS_UPDATE', progress);
      return;
    }

    const { current, total } = progress;
    const now = Date.now();
    const tracker = this.etaTracker;

    if (!tracker || current < tracker.lastCurrent) {
      // First sample, or progress reset (a new run started): start fresh.
      this.etaTracker = {
        lastTime: now,
        lastCurrent: current,
        msPerUnit: 0,
        samples: 0,
      };
    } else if (current > tracker.lastCurrent) {
      const msPerUnit =
        (now - tracker.lastTime) / (current - tracker.lastCurrent);
      tracker.samples++;
      // Incremental running mean: avg += (sample - avg) / n.
      tracker.msPerUnit += (msPerUnit - tracker.msPerUnit) / tracker.samples;
      tracker.lastTime = now;
      tracker.lastCurrent = current;
    }

    const { samples, msPerUnit } = this.etaTracker!;
    const eta =
      samples > 0
        ? Math.max(0, Math.round((msPerUnit * (total - current)) / 1000))
        : undefined;

    global.send('PROGRESS_UPDATE', { current, total, eta });
  }

  getMcClient(clientId: string) {
    assert(typeof clientId === 'string', 'clientId must be a string');
    return new McClient(clientId);
  }

  getMcClients() {
    return this.sendAsync<
      { username: string; clientId: string }[]
    >('GET_MINECRAFT_CLIENTS');
  }

  getMcServer(serverId: string) {
    assert(typeof serverId === 'string', 'serverId must be a string');
    return new McServer(serverId);
  }

  getMcServers() {
    return this.sendAsync<McServerHandleSummary[]>('GET_MINECRAFT_SERVERS');
  }

  getProfile(): ActiveProfileObj | null {
    return (workerData as WorkerDataType).profile;
  }

  prompt(data: {
    title: string;
    label: string;
    placeholder: string;
    defaultValue?: string;
  }): Promise<string | null> {
    const promptID = 'prompt-' + Math.random();
    this.sendToClients('macro-prompt', {
      title: data.title,
      label: data.label,
      placeholder: data.placeholder,
      defaultValue: data.defaultValue ?? '',
      promptID,
      scriptInstance: workerData.id,
      scriptId: workerData.pluginId,
      messageAddress: workerData.messaging.address,
    });

    return new Promise((resolve) => {
      const unsubscribe = this.onMessage<{
        promptID: string;
        value: string;
        cancel?: boolean;
      }>('macro-prompt', (response) => {
        if (response.promptID === promptID) {
          unsubscribe();
          resolve(response?.cancel ? null : response.value);
        }
      });
    });
  }

  async showSnackbarWithButtons({
    title,
    body,
    buttons,
  }: {
    title: string;
    body: string;
    buttons: ButtonSnackbarProps['btns'];
  }) {
    const promptID = this.nextKey();

    this.sendToClients('popup-buttons', {
      title,
      body,
      buttons,
      popupID: promptID,
      messageAddress: workerData.messaging.address,
    });

    return new Promise<string>((resolve) => {
      this.onceMessage(
        'popup-buttons-' + promptID,
        (response: { popupID: number; response: string }) => {
          resolve(response.response);
        },
      );
    });
  }

  public getJNdata(): Promise<JNdata> {
    return this.sendAsync('GET_JNDATA');
  }

  /* ---------------------------------------------------------------- */
  /*  Main-process actions (shared bridge — see BotEvents/ClientEvents) */
  /* ---------------------------------------------------------------- */

  /** Fire-and-forget a main-process client action (the SIMULATE bridge). */
  public simulate(event: string, data?: any): void {
    this.send('SIMULATE', [event, data]);
  }

  /** Start a script or macro on the main process. Fire-and-forget. */
  public startScript(payload: StartScriptPayload): void {
    this.simulate('START_SCRIPT', payload);
  }

  /** Stop running script(s) by instance id, or all instances of a name. */
  public stopScript(target: number | string): void {
    this.simulate('STOP_ALL', target);
  }

  /** Currently active scripts, keyed by instance id. */
  public getActiveScripts(): Promise<ActiveScriptsType> {
    return this.sendAsync('GET_ACTIVE_SCRIPTS');
  }

  /** Runnable library plugins (scriptType 'script'). */
  public getPlugins(): Promise<PluginSummary[]> {
    return this.sendAsync('GET_PLUGINS');
  }

  /** The active server profile's runnable dashboard scripts. */
  public getProfileScripts(): Promise<ProfileScriptSummary[]> {
    return this.sendAsync('GET_PROFILE_SCRIPTS');
  }

  /** Recent console logs, optionally filtered to a single script. */
  public getLogs(filter?: {
    scriptName?: string;
    limit?: number;
  }): Promise<WorkerLogEntry[]> {
    return this.sendAsync('GET_LOGS', filter);
  }

  public getAlts(
    options: { fullAlts: boolean } = { fullAlts: true },
  ): AltWithData[] {
    let alts: AltWithData[] = [];
    for (const alt of workerData.sharedSettings.alts) {
      if (!(alt.username in workerData.settings.altData)) continue;
      const altData = { ...workerData.settings.altData[alt.username] };
      if (!options.fullAlts) {
        delete altData.password;
      }

      alts.push({
        username: alt.username,
        UID: alt.UID,
        data: altData,
      });
    }

    return alts;
  }

  public stop() {
    process.exit(0);
  }

  /**
   * Declare which runner control buttons (PAUSE/RESUME/RESTART/SKIP/PREVIOUS,
   * a `ScriptControl` bitfield) should be shown in the UI for this script.
   * Call again to change the visible set (e.g. swap PAUSE for RESUME).
   */
  public setControls(controls: number) {
    this.send('SET_SCRIPT_CONTROLS', controls);
  }

  /**
   * Listen for control-button clicks. The handler receives the single pressed
   * `ScriptControl` bit. Returns an unsubscribe function.
   */
  public onControl(handler: (control: number) => void): () => void {
    return this.onMessage('SCRIPT_CONTROL', handler);
  }

  optionError({ field, message }: OptionErrorOptions, scriptInfo?: MacroInfo) {
    if (!field || typeof field !== 'string') {
      throw new Error('optionError: field is required');
    }
    if (!message || typeof message !== 'string') {
      throw new Error('optionError: message is required');
    }
    if (message.length > 200) {
      throw new Error('optionError: message too long (max 200)');
    }

    global.sendToClients('option-error', {
      pluginId: scriptInfo?.pluginId,
      scriptName: scriptInfo?.name,
      field,
      message,
    });
  }
}

const workerScript = new WorkerScript();

export default workerScript;
