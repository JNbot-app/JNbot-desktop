import fs from 'fs';
import path from 'path';
import {
  automationId,
  automationSummary,
  automationStepId,
  assertAutomationDocument,
  isAutomationScreenAction,
  isAutomationDocument,
  isActiveSession,
  isRecordingSession,
  redactAutomationChat,
  type AutomationDocument,
  type AutomationEntitySelector,
  type AutomationItemFingerprint,
  type AutomationPositionRef,
  type AutomationReplayOptions,
  type AutomationSessionStatus,
  type AutomationStep,
  type AutomationSummary,
  type AutomationTake,
  type AutomationVec3,
} from '../../../common/automation';
import { AutomationPlayer } from '../../../common/AutomationPlayer';
import type MinecraftBridgeManager from './minecraft/MinecraftBridgeManager';
import type MinecraftSessions from './minecraft/MinecraftSessions';
import McClientAutomationAdapter from './minecraft/automation/McClientAutomationAdapter';
import type Macros from './Macros';
import { MacroInfo } from '../types';
import {
  RECORDING_BRAIN_STEP_MS,
  recordingBrainName,
} from '../../../common/brainSpec';
import {
  brainDir,
  ExampleWriter,
  isRecordingFile,
  takeStepsFile,
} from '../workers/brain/recorder';
import { devicePath } from './storage/portablePaths';
import BrainTrainer from './BrainTrainer';
import BrainCoach from './BrainCoach';

type RecordingSession = {
  sessionId: string;
  clientId: string;
  document: AutomationDocument;
  startedAt: number;
  pausedAt?: number;
  pausedMs: number;
  state: 'recording' | 'paused';
  /** the take's AI example ("Play with AI"), recorded alongside the steps */
  examples?: ExampleWriter;
};
type CaptureAction = { kind: string; ts?: number; [key: string]: unknown };
type SessionControl = 'pause' | 'resume' | 'stop';

/** capture holder id of a worker script's session (e.g. a brain recording) */
export const scriptCaptureHolder = (instanceId: number, sessionId: string) =>
  `script-${instanceId}:${sessionId}`;

export default class AutomationService {
  private readonly recordingsByClient = new Map<string, RecordingSession>();
  private readonly players = new Map<string, AutomationPlayer>();
  private readonly statuses = new Map<string, AutomationSessionStatus>();
  /** clientId -> holders sharing that client's capture stream (recordings, brains) */
  private readonly captureHolders = new Map<string, Set<string>>();

  /** clientId -> practice with AI running on that client */
  private readonly coaches = new Map<string, BrainCoach>();

  /** AI ("Play with AI") of recording plugins */
  readonly brains = new BrainTrainer(async (pluginId) => {
    try {
      return (await this.get(pluginId)).learn;
    } catch {
      return undefined;
    }
  });

  constructor(
    private readonly macros: Macros,
    private readonly bridge: MinecraftBridgeManager,
    private readonly minecraftSessions: MinecraftSessions,
  ) {
    bridge.onRawClientEvent((client, event) => {
      if (event.name === 'mc.debug.log') {
        console.error('[Minecraft][mc.debug.log]', {
          clientId: client.clientId,
          username: client.username,
          ...(event.data as Record<string, unknown> | undefined),
        });
      } else if (event.name === 'mc.automation.action')
        this.capture(client.clientId, event.data as CaptureAction);
      else if (event.name === 'mc.automation.hotkey')
        void this.handleHotkey(
          client.clientId,
          (event.data as { action?: string } | undefined)?.action,
        );
      else if (event.name === 'mc.automation.manualInput') {
        const coach = this.coaches.get(client.clientId);
        if (coach) void coach.takeover();
        else
          void this.pausePlayerForTarget(
            'minecraft',
            client.clientId,
            'Manual input detected',
          );
      }
    });
    bridge.onClientDisconnected((clientId) => {
      this.captureHolders.delete(clientId);
      void this.coaches.get(clientId)?.stop();
      if (this.recordingsByClient.has(clientId))
        void this.stopRecording(clientId, true);
      void this.stopPlayerForTarget(
        'minecraft',
        clientId,
        'Minecraft client disconnected',
      );
    });
  }

  list(): Promise<AutomationSummary[]> {
    return Promise.resolve(
      this.macros
        .toList()
        .filter((plugin) => plugin.language === 'recording')
        .flatMap((plugin) => {
          const result = this.macros.getMacro(plugin.pluginId);
          return result.status === 'success' &&
            isAutomationDocument(result.code)
            ? [
                {
                  ...automationSummary(result.code),
                  id: plugin.pluginId,
                  name: plugin.name,
                  updatedAt: plugin.editedAt ?? result.code.updatedAt,
                },
              ]
            : [];
        })
        .sort((left, right) => right.updatedAt - left.updatedAt),
    );
  }

  async get(id: string): Promise<AutomationDocument> {
    const result = this.macros.getMacro(id);
    if (
      result.status !== 'success' ||
      result.info?.language !== 'recording' ||
      !isAutomationDocument(result.code)
    )
      throw new Error(
        `Recording plugin not found or must be recorded again: ${id}`,
      );
    return {
      ...result.code,
      id: result.info.pluginId,
      name: result.info.name,
      updatedAt: result.info.editedAt ?? result.code.updatedAt,
    };
  }

  sessionStatuses(): AutomationSessionStatus[] {
    return [...this.statuses.values()];
  }
  sessionStatus(sessionId: string): AutomationSessionStatus | null {
    return this.statuses.get(sessionId) ?? null;
  }

  async startRecording(
    clientId: string,
    pluginId?: string,
    name?: string,
  ): Promise<AutomationSessionStatus> {
    if (this.recordingsByClient.has(clientId))
      throw new Error('This client is already recording');
    if (this.playerFor('minecraft', clientId) || this.coaches.has(clientId))
      throw new Error('This client is already replaying an automation');
    const client = this.bridge.getClient(clientId);
    const [position, world, version] = await Promise.all([
      client.getCurrentPosition(),
      client.getWorldInfo(),
      client.apiVersion(),
    ]);
    const bridgeInfo = this.bridge
      .getClients()
      .find((entry) => entry.clientId === clientId);
    const gameSession = this.minecraftSessions
      .list()
      .find((entry) => entry.clientId === clientId);
    let plugin = pluginId ? this.macros.readPluginInfo(pluginId) : null;
    let createdPlugin = false;
    if (pluginId && plugin?.language !== 'recording')
      throw new Error('The selected plugin is not a recording');
    if (!plugin) {
      const created = this.macros.create({
        name: name?.trim() || `Recording ${new Date().toLocaleString()}`,
        description: 'Recorded Minecraft task',
        language: 'recording',
        scriptType: 'action',
      });
      if (created.status !== 'success' || !(created as MacroInfo).pluginId)
        throw new Error(created.message ?? 'Failed to create recording plugin');
      plugin = created as MacroInfo;
      createdPlugin = true;
      this.macros.send();
    }
    const now = Date.now();
    const previous = await this.getOrNew(plugin.pluginId, plugin.name);
    const document: AutomationDocument = {
      schemaVersion: 2,
      id: plugin.pluginId,
      name: plugin.name,
      revision: previous.revision,
      createdAt: previous.createdAt,
      updatedAt: now,
      durationMs: 0,
      source: {
        kind: 'minecraft',
        clientId,
        username: bridgeInfo?.username,
        mcVersion: version.mcVersion ?? bridgeInfo?.mcVersion,
        serverAddress: gameSession?.serverAddress,
        dimension: world.dimension,
      },
      origin: {
        x: position.x,
        y: position.y,
        z: position.z,
        yaw: position.yaw,
        pitch: position.pitch,
      },
      inputs: [],
      steps: [],
      learn: previous.learn,
    };
    const session: RecordingSession = {
      sessionId: automationId('recording'),
      clientId,
      document,
      startedAt: now,
      pausedMs: 0,
      state: 'recording',
    };
    this.recordingsByClient.set(clientId, session);
    try {
      await this.acquireCapture(clientId, session.sessionId, {
        sessionId: session.sessionId,
        origin: document.origin,
      });
    } catch (error) {
      this.recordingsByClient.delete(clientId);
      if (createdPlugin) {
        this.macros.delete(plugin.pluginId);
        this.macros.send();
      }
      const reason = error instanceof Error ? error.message : String(error);
      if (
        /unknown (action|method).*mc\.automation\.capture\.start/i.test(reason)
      )
        throw new Error(
          'This Minecraft client does not support task recording. Update the JNbot client mod and restart Minecraft.',
        );
      throw error;
    }
    session.examples = new ExampleWriter(
      this.takesDir(plugin.pluginId),
      client,
      { stepMs: RECORDING_BRAIN_STEP_MS, label: plugin.name },
    );
    return this.publishRecordingStatus(session);
  }

  /** Practice with AI: the recording's AI plays this client, the player takes over to correct it. */
  async startPractice(
    clientId: string,
    pluginId: string,
  ): Promise<AutomationSessionStatus> {
    if (
      this.recordingsByClient.has(clientId) ||
      this.playerFor('minecraft', clientId) ||
      this.coaches.has(clientId)
    )
      throw new Error('Stop what this client is doing first');
    const coach = new BrainCoach(
      this.bridge.getClient(clientId),
      clientId,
      pluginId,
      this.bridge
        .getClients()
        .find((entry) => entry.clientId === clientId)?.username,
      this.brains,
      {
        publish: (status) => {
          if (!isActiveSession(status)) this.coaches.delete(clientId);
          this.publishStatus(status);
        },
        acquireCapture: (id, holder, params) =>
          this.acquireCapture(id, holder, params),
        releaseCapture: (id, holder) => this.releaseCapture(id, holder),
        toast: (title, body) => this.toast(clientId, title, body),
      },
    );
    this.coaches.set(clientId, coach);
    void coach.start();
    return coach.status;
  }

  async pauseRecording(clientId: string): Promise<AutomationSessionStatus> {
    const session = this.requireRecording(clientId);
    if (session.state === 'paused') return this.publishRecordingStatus(session);
    // paused on our side only: the capture stream may be shared with a brain
    session.state = 'paused';
    session.pausedAt = Date.now();
    if (session.examples) session.examples.paused = true;
    return this.publishRecordingStatus(session);
  }

  async resumeRecording(clientId: string): Promise<AutomationSessionStatus> {
    const session = this.requireRecording(clientId);
    if (session.state === 'recording')
      return this.publishRecordingStatus(session);
    session.pausedMs += Date.now() - (session.pausedAt ?? Date.now());
    session.pausedAt = undefined;
    session.state = 'recording';
    if (session.examples) session.examples.paused = false;
    return this.publishRecordingStatus(session);
  }

  async stopRecording(
    clientId: string,
    interrupted = false,
  ): Promise<AutomationDocument> {
    const session = this.requireRecording(clientId);
    this.recordingsByClient.delete(clientId);
    if (session.pausedAt) session.pausedMs += Date.now() - session.pausedAt;
    session.document.durationMs = Math.max(
      session.document.steps.at(-1)?.atMs ?? 0,
      Date.now() - session.startedAt - session.pausedMs,
    );
    session.document.interrupted = interrupted || undefined;
    await this.releaseCapture(clientId, session.sessionId);
    await session.examples?.stop();
    const { steps, origin, inputs, source, durationMs } = session.document;
    const take = session.examples && path.basename(session.examples.file);
    if (take)
      fs.writeFileSync(
        takeStepsFile(session.examples!.file),
        JSON.stringify({
          steps,
          origin,
          inputs,
          source,
          durationMs,
          interrupted: session.document.interrupted,
        } satisfies AutomationTake),
      );
    // the first take is what replays; later ones only teach the AI until picked
    const current = await this.getOrNew(
      session.document.id,
      session.document.name,
    );
    const replays = !current.steps.length;
    const saved = replays
      ? this.saveTake(current, session.document, take)
      : current;
    this.publishStatus({
      ...this.recordingStatus(session),
      state: interrupted ? 'stopped' : 'completed',
      totalSteps: steps.length,
      currentStep: steps.length,
      message: `${replays ? 'Recording' : 'Take'} saved${interrupted ? ' after disconnect' : ''}`,
      updatedAt: Date.now(),
    });
    return saved;
  }

  /** Makes a recorded take the steps that replay. */
  async useTake(pluginId: string, file: string): Promise<AutomationDocument> {
    if (!isRecordingFile(file) || path.basename(file) !== file)
      throw new Error('Invalid take');
    const stepsFile = takeStepsFile(path.join(this.takesDir(pluginId), file));
    if (!fs.existsSync(stepsFile))
      throw new Error('This take was recorded for the AI only');
    const take = JSON.parse(
      fs.readFileSync(stepsFile, 'utf8'),
    ) as AutomationTake;
    return this.saveTake(await this.get(pluginId), take, file);
  }

  private saveTake(
    document: AutomationDocument,
    take: AutomationTake,
    file?: string,
  ): AutomationDocument {
    const saved = this.macros.save(document.id, {
      ...document,
      source: take.source,
      origin: take.origin,
      inputs: take.inputs,
      steps: take.steps,
      durationMs: take.durationMs,
      interrupted: take.interrupted,
      replayTake: file,
      updatedAt: Date.now(),
    } satisfies AutomationDocument) as AutomationDocument;
    assertAutomationDocument(saved);
    this.macros.send();
    return saved;
  }

  private takesDir(pluginId: string) {
    return path.join(
      brainDir(devicePath('ai'), recordingBrainName(pluginId)),
      'recordings',
    );
  }

  async startClientReplay(
    clientId: string,
    automationIdValue: string | AutomationDocument,
    options: AutomationReplayOptions,
  ): Promise<AutomationSessionStatus> {
    if (this.recordingsByClient.has(clientId))
      throw new Error('Stop the active recording before replaying');
    if (this.playerFor('minecraft', clientId) || this.coaches.has(clientId))
      throw new Error('This client is already replaying an automation');
    if (options.mode === 'ai')
      throw new Error(
        'Play with AI needs a bot. Select a bot instead of a Minecraft client.',
      );
    const document =
      typeof automationIdValue === 'string'
        ? await this.get(automationIdValue)
        : automationIdValue;
    assertAutomationDocument(document);
    const client = this.bridge.getClient(clientId);
    await client.request('mc.automation.playback.start');
    const player = new AutomationPlayer(
      document,
      new McClientAutomationAdapter(client, {
        kind: 'minecraft',
        id: clientId,
        username: this.bridge
          .getClients()
          .find((entry) => entry.clientId === clientId)?.username,
      }),
      options,
    );
    this.players.set(player.sessionId, player);
    player.onStatus((status) => {
      this.publishStatus(status);
      if (
        status.state === 'completed' ||
        status.state === 'stopped' ||
        status.state === 'failed'
      ) {
        this.players.delete(status.sessionId);
        void client
          .request('mc.automation.playback.stop')
          .catch(() => undefined);
      }
    });
    return player.snapshot;
  }

  async controlSession(
    sessionId: string,
    action: SessionControl,
  ): Promise<AutomationSessionStatus> {
    const coach = [...this.coaches.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    // practice only stops: taking over is how the player pauses the AI
    if (coach) {
      if (action === 'stop') await coach.stop();
      return coach.status;
    }
    const player = this.players.get(sessionId);
    if (player) {
      if (action === 'pause') await player.pause();
      if (action === 'resume') await player.resume();
      if (action === 'stop') await player.stop();
      return player.snapshot;
    }
    const recording = [...this.recordingsByClient.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (!recording)
      throw new Error(`Automation session not found: ${sessionId}`);
    if (action === 'pause') return this.pauseRecording(recording.clientId);
    if (action === 'resume') return this.resumeRecording(recording.clientId);
    await this.stopRecording(recording.clientId);
    return this.statuses.get(sessionId)!;
  }

  receiveWorkerStatus(status: AutomationSessionStatus): void {
    this.publishStatus(status);
  }

  /** Starts the client's capture stream for the first holder; later holders share it. */
  async acquireCapture(
    clientId: string,
    holder: string,
    params: unknown,
  ): Promise<void> {
    const holders = this.captureHolders.get(clientId) ?? new Set<string>();
    holders.add(holder);
    this.captureHolders.set(clientId, holders);
    if (holders.size > 1) return;
    try {
      await this.bridge
        .getClient(clientId)
        .request('mc.automation.capture.start', params);
    } catch (error) {
      await this.releaseCapture(clientId, holder);
      throw error;
    }
  }

  /** Stops the client's capture stream once its last holder is gone. */
  async releaseCapture(clientId: string, holder: string): Promise<void> {
    const holders = this.captureHolders.get(clientId);
    if (!holders?.delete(holder) || holders.size) return;
    this.captureHolders.delete(clientId);
    try {
      await this.bridge
        .getClient(clientId)
        .request('mc.automation.capture.stop');
    } catch {
      // Client already disconnected
    }
  }

  /** Releases every capture a (now stopped) script still held. */
  releaseScriptCaptures(instanceId: number): void {
    const prefix = scriptCaptureHolder(instanceId, '');
    for (const [clientId, holders] of this.captureHolders)
      for (const holder of holders)
        if (holder.startsWith(prefix))
          void this.releaseCapture(clientId, holder);
  }

  private capture(clientId: string, action: CaptureAction): void {
    this.coaches.get(clientId)?.onAction(action);
    const session = this.recordingsByClient.get(clientId);
    session?.examples?.push(action);
    if (!session || session.state !== 'recording') return;
    const step = this.captureStep(session, action);
    if (!step) return;
    if (step.kind === 'movePath') {
      const previous = session.document.steps.at(-1);
      const previousTick =
        previous?.kind === 'movePath'
          ? previous.points.at(-1)?.tick
          : undefined;
      if (
        previous?.kind === 'movePath' &&
        previousTick !== undefined &&
        step.points[0].tick - previousTick <= 2
      ) {
        previous.points.push(...step.points);
        session.document.durationMs = step.atMs;
        this.publishRecordingStatus(session);
        return;
      }
    }
    session.document.steps.push(step);
    session.document.durationMs = step.atMs;
    this.publishRecordingStatus(session);
  }

  private captureStep(
    session: RecordingSession,
    action: CaptureAction,
  ): AutomationStep | null {
    const atMs = this.recordingTime(session, action.ts);
    const base = { id: automationStepId(), enabled: true, atMs };
    const position = (value: unknown): AutomationPositionRef | null => {
      const point = value as Partial<AutomationVec3> | null;
      if (
        !point ||
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        typeof point.z !== 'number'
      )
        return null;
      return {
        absolute: { x: point.x, y: point.y, z: point.z },
        relative: {
          x: point.x - session.document.origin.x,
          y: point.y - session.document.origin.y,
          z: point.z - session.document.origin.z,
        },
      };
    };
    switch (action.kind) {
      case 'move': {
        const point = position(action.position);
        if (!point) return null;
        return {
          ...base,
          kind: 'movePath',
          points: [
            {
              ...point,
              atMs,
              tick: this.number(action.tick) ?? 0,
              yaw: this.number(action.yaw) ?? 0,
              pitch: this.number(action.pitch) ?? 0,
              onGround: action.onGround === true,
              velocity: position(action.velocity)?.absolute,
              forward: action.forward === true,
              back: action.back === true,
              left: action.left === true,
              right: action.right === true,
              jump: action.jump === true,
              sprint: action.sprint === true,
              sneak: action.sneak === true,
              riding: action.riding === true,
            },
          ],
        };
      }
      case 'chat': {
        if (typeof action.message !== 'string') return null;
        const redacted = redactAutomationChat(action.message);
        if (
          redacted.input &&
          !session.document.inputs.some(
            (input) => input.id === redacted.input!.id,
          )
        )
          session.document.inputs.push(redacted.input);
        return { ...base, kind: 'chat', message: redacted.message };
      }
      case 'hotbar':
        return { ...base, kind: 'hotbar', slot: this.number(action.slot) ?? 0 };
      case 'openInventory':
        return { ...base, kind: 'openInventory' };
      case 'windowClick':
        return {
          ...base,
          kind: 'windowClick',
          window: {
            title: this.string(action.windowTitle),
            type: this.string(action.windowType),
            inventory: action.inventory === true ? true : undefined,
          },
          slot: this.number(action.slot) ?? 0,
          button: this.number(action.button) ?? 0,
          actionType: this.string(action.actionType) ?? 'PICKUP',
          itemBefore: this.itemFingerprint(action.item),
        };
      case 'closeWindow':
        return { ...base, kind: 'closeWindow' };
      case 'attackEntity':
      case 'useEntity': {
        const entity = action.entity as
          | (AutomationEntitySelector & { position?: AutomationVec3 })
          | undefined;
        if (!entity?.type) return null;
        return {
          ...base,
          kind: action.kind,
          entity: {
            sourceRuntimeId: this.number(entity.sourceRuntimeId),
            uuid: entity.uuid,
            type: entity.type,
            name: entity.name,
            radius: entity.radius ?? 16,
            position: entity.position
              ? position(entity.position) ?? undefined
              : undefined,
          },
          hand: action.hand === 'off' ? 'off' : 'main',
        };
      }
      case 'breakBlock':
      case 'useBlock': {
        const blockPosition = position(action.position);
        if (!blockPosition) return null;
        return {
          ...base,
          kind: action.kind,
          position: blockPosition,
          face: action.face as
            | 'up'
            | 'down'
            | 'north'
            | 'south'
            | 'east'
            | 'west',
          hand: action.hand === 'off' ? 'off' : 'main',
          blockBefore: this.string(action.blockBefore),
        };
      }
      case 'useItem':
      case 'releaseUseItem':
      case 'swingArm':
      case 'swapHands':
      case 'wake':
      case 'respawn':
        return {
          ...base,
          kind: action.kind,
          hand: action.hand === 'off' ? 'off' : 'main',
        } as AutomationStep;
      case 'dropItem':
        return {
          ...base,
          kind: 'dropItem',
          entireStack: action.entireStack === true,
        };
      case 'screenAction': {
        const screenAction = this.string(action.action);
        const data = action.data;
        if (
          !isAutomationScreenAction(screenAction) ||
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data)
        )
          return null;
        return {
          ...base,
          kind: 'screenAction',
          action: screenAction,
          data: data as Record<string, unknown>,
        };
      }
      default:
        return null;
    }
  }

  private async handleHotkey(clientId: string, action?: string): Promise<void> {
    try {
      const recording = this.recordingsByClient.get(clientId);
      const player = this.playerFor('minecraft', clientId);
      const coach = this.coaches.get(clientId);
      if (action === 'toggleRecording') {
        if (coach) await coach.stop();
        else if (recording) await this.stopRecording(clientId);
        else if (player) await player.stop();
        else await this.startRecording(clientId);
      } else if (action === 'togglePause') {
        if (recording?.state === 'recording')
          await this.pauseRecording(clientId);
        else if (recording?.state === 'paused')
          await this.resumeRecording(clientId);
        else if (player?.snapshot.state === 'paused') await player.resume();
        else if (player) await player.pause();
      }
    } catch (error) {
      this.toast(
        clientId,
        'Automation',
        error instanceof Error ? error.message : String(error),
        'error',
      );
    }
  }

  private async pausePlayerForTarget(
    kind: 'minecraft' | 'bot',
    id: string | number,
    message: string,
  ): Promise<void> {
    await this.playerFor(kind, id)?.pause(message);
  }
  private async stopPlayerForTarget(
    kind: 'minecraft' | 'bot',
    id: string | number,
    message: string,
  ): Promise<void> {
    const player = this.playerFor(kind, id);
    if (player) {
      await player.stop();
      this.publishStatus({ ...player.snapshot, message });
    }
  }
  private playerFor(
    kind: 'minecraft' | 'bot',
    id: string | number,
  ): AutomationPlayer | undefined {
    for (const player of this.players.values())
      if (
        player.snapshot.target.kind === kind &&
        player.snapshot.target.id === id
      )
        return player;
    return undefined;
  }
  private toast(
    clientId: string,
    title: string,
    body?: string,
    kind: 'info' | 'ok' | 'warn' | 'error' = 'info',
  ): void {
    try {
      void this.bridge
        .getClient(clientId)
        .toast({ title, body, kind, durationMs: 4000 })
        .catch(() => undefined);
    } catch {
      // Client already disconnected
    }
  }
  /** In-game feedback whenever a client recording/replay changes state. */
  private notifyClient(status: AutomationSessionStatus): void {
    const clientId = String(status.target.id);
    const recording = isRecordingSession(status);
    switch (status.state) {
      case 'recording':
        return this.toast(clientId, 'Recording', 'F8 stop · F9 pause', 'warn');
      case 'playing':
        return this.toast(clientId, 'Replaying', 'F9 pause · F8 stop');
      case 'paused':
        return recording
          ? this.toast(clientId, 'Recording paused', 'F9 resume · F8 stop')
          : this.toast(
              clientId,
              `Replay paused${status.message && status.message !== 'Paused' ? ` (${status.message})` : ''}`,
              'F9 resume · F8 stop',
              'warn',
            );
      case 'completed':
        return this.toast(
          clientId,
          recording ? 'Recording saved' : 'Replay finished',
          status.issues.length
            ? `${status.issues.length} step(s) skipped`
            : undefined,
          status.issues.length ? 'warn' : 'ok',
        );
      case 'failed':
        return this.toast(clientId, 'Replay failed', status.error, 'error');
      case 'stopped':
        return this.toast(
          clientId,
          recording ? 'Recording saved' : 'Replay stopped',
          recording ? status.message : 'Press F8 to record',
        );
    }
  }
  private recordingTime(session: RecordingSession, eventTime?: number): number {
    return Math.max(
      0,
      (eventTime ?? Date.now()) - session.startedAt - session.pausedMs,
    );
  }
  private requireRecording(clientId: string): RecordingSession {
    const session = this.recordingsByClient.get(clientId);
    if (!session) throw new Error('This client is not recording');
    return session;
  }
  private recordingStatus(session: RecordingSession): AutomationSessionStatus {
    return {
      sessionId: session.sessionId,
      automationId: session.document.id,
      target: {
        kind: 'minecraft',
        id: session.clientId,
        username: session.document.source.username,
      },
      state: session.state,
      currentStep: session.document.steps.length,
      totalSteps: session.document.steps.length,
      issues: [],
      startedAt: session.startedAt,
      updatedAt: Date.now(),
    };
  }
  private publishRecordingStatus(
    session: RecordingSession,
  ): AutomationSessionStatus {
    const status = this.recordingStatus(session);
    this.publishStatus(status);
    return status;
  }
  private publishStatus(status: AutomationSessionStatus): void {
    const previous = this.statuses.get(status.sessionId);
    for (const issue of status.issues.slice(previous?.issues.length ?? 0))
      console.warn(
        `[Automation] ${status.target.username ?? status.target.id} skipped ${issue.kind} at step ${issue.stepIndex}: ${issue.reason}`,
      );
    // Keep only the latest finished session per target so the list stays small.
    if (!isActiveSession(status))
      for (const [sessionId, entry] of this.statuses)
        if (
          sessionId !== status.sessionId &&
          !isActiveSession(entry) &&
          entry.target.kind === status.target.kind &&
          entry.target.id === status.target.id
        )
          this.statuses.delete(sessionId);
    this.statuses.set(status.sessionId, status);
    // practice toasts on its own (BrainCoach)
    if (
      status.target.kind === 'minecraft' &&
      !status.practice &&
      previous?.state !== status.state
    )
      this.notifyClient(status);
    global.send('AUTOMATION_SESSION_UPDATE', status);
  }
  private async getOrNew(
    pluginId: string,
    name: string,
  ): Promise<AutomationDocument> {
    try {
      return await this.get(pluginId);
    } catch {
      return {
        schemaVersion: 2,
        id: pluginId,
        name,
        revision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        durationMs: 0,
        source: { kind: 'minecraft' },
        origin: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
        inputs: [],
        steps: [],
      };
    }
  }
  private number(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }
  private string(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }
  private itemFingerprint(
    value: unknown,
  ): AutomationItemFingerprint | undefined {
    const item = value as
      | {
          empty?: boolean;
          itemId?: unknown;
          name?: unknown;
          count?: unknown;
          components?: unknown;
        }
      | undefined;
    return !item || item.empty || typeof item.itemId !== 'string'
      ? undefined
      : {
          itemId: item.itemId,
          name: this.string(item.name),
          count: this.number(item.count),
          components: this.string(item.components),
        };
  }
}
