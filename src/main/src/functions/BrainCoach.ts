/**
 * Practice with AI (DAgger): a recording's AI plays the user's own JNbot
 * Client. Pressing a movement, attack or use key takes over: the AI lets go
 * and what the player does is recorded as an example, so the AI learns to
 * recover from its own mistakes. After a moment without input it takes back
 * over. The brain decides in its own worker (BrainTrainer.drive).
 */
import path from 'path';

import {
  automationId,
  type AutomationSessionStatus,
} from '../../../common/automation';
import {
  RECORDING_BRAIN_STEP_MS,
  recordingBrainName,
} from '../../../common/brainSpec';
import type { McVec3 } from '../../../common/types/McClientApi';
import type { BrainDriveDecision } from '../workers/brain/task';
import { type ActCommand, engageRange } from '../workers/brain/actions';
import { Palette, snapshotClient } from '../workers/brain/observation';
import { brainDir, ExampleWriter } from '../workers/brain/recorder';
import type McClient from './minecraft/bridge/McClient';
import type BrainTrainer from './BrainTrainer';
import type { BrainDriver } from './BrainTrainer';
import { devicePath } from './storage/portablePaths';

/** no input for this long hands control back to the AI */
const HANDBACK_MS = 2000;
/** re-path to a moving target this often */
const RENAVIGATE_MS = 1000;
const DEFAULT_RANGE = 4;
/** the client reports starting or stopping an item use this late */
const USE_LAG_MS = 300;
/** what the AI is doing is shown at most this often, unless it changes */
const SHOW_DOING_MS = 1000;
/** the world label on the AI's target */
const MARKER_ID = 'brain-target';
/** steps failing this long in a row stop practice; shorter (a slow reply while the game saves) skips them */
const FAILING_MS = 5000;

export interface CoachHost {
  publish(status: AutomationSessionStatus): void;
  acquireCapture(
    clientId: string,
    holder: string,
    params: unknown,
  ): Promise<void>;
  releaseCapture(clientId: string, holder: string): Promise<void>;
  toast(title: string, body?: string): void;
}

const ignore = () => undefined;
const shortName = (id = '') => id.replace(/^.*[:.]/, '');

export default class BrainCoach {
  readonly sessionId = automationId('practice');

  #status: AutomationSessionStatus;

  #driver?: BrainDriver;

  #palette = new Palette();

  #sentBlocks = 0;

  #timer?: ReturnType<typeof setInterval>;

  #stepping: Promise<void> = Promise.resolve();

  #busy = false;

  /** when steps started failing, while they do */
  #failingSince?: number;

  #stopped = false;

  #writer?: ExampleWriter;

  #lastInput = 0;

  #movement = '';

  /** the client keeps digging a block until it breaks or this lets go */
  #digging = false;

  /** the AI holds right click */
  #useKey = false;

  /** drawing a bow at the target */
  #drawing = false;

  #useChangedAt = 0;

  #navigating?: { id: number | string; at: number };

  /** the target and intent the marker shows */
  #marked = '';

  #shownDoingAt = 0;

  constructor(
    private readonly client: McClient,
    private readonly clientId: string,
    private readonly pluginId: string,
    username: string | undefined,
    private readonly trainer: BrainTrainer,
    private readonly host: CoachHost,
  ) {
    const now = Date.now();
    this.#status = {
      sessionId: this.sessionId,
      automationId: pluginId,
      target: { kind: 'minecraft', id: clientId, username },
      state: 'playing',
      currentStep: 0,
      totalSteps: 0,
      message: 'Learning from your examples…',
      issues: [],
      startedAt: now,
      updatedAt: now,
      practice: { control: 'learning', corrections: 0 },
    };
  }

  get status() {
    return this.#status;
  }

  get #control() {
    return this.#status.practice!.control;
  }

  async start(): Promise<void> {
    this.#publish({});
    try {
      await this.trainer.train(this.pluginId);
      if (this.#stopped) return;
      this.#driver = await this.trainer.drive(this.pluginId);
      if (this.#stopped) return this.#driver.close();
      await this.client.request('mc.automation.playback.start');
      this.#setControl('ai');
      this.host.toast(
        'AI is playing',
        'Take over anytime with your keys · F8 stops',
      );
      this.#timer = setInterval(() => {
        if (!this.#busy) this.#stepping = this.#step();
      }, RECORDING_BRAIN_STEP_MS);
    } catch (error) {
      await this.stop(error);
    }
  }

  /** the player pressed a gameplay key: let go and record what they do */
  async takeover(): Promise<void> {
    if (this.#control !== 'ai' || this.#stopped) return;
    this.#setControl('you');
    this.#lastInput = Date.now();
    await this.#stepping;
    await this.#release();
    this.#writer = new ExampleWriter(
      path.join(
        brainDir(devicePath('ai'), recordingBrainName(this.pluginId)),
        'recordings',
      ),
      this.client,
      { stepMs: RECORDING_BRAIN_STEP_MS, label: this.pluginId },
    );
    const origin = await this.client.getCurrentPosition();
    await this.host.acquireCapture(this.clientId, this.sessionId, {
      sessionId: this.sessionId,
      origin: {
        x: origin.x,
        y: origin.y,
        z: origin.z,
        yaw: origin.yaw,
        pitch: origin.pitch,
      },
    });
    this.host.toast("You're in control", 'Let go to hand back to the AI');
  }

  /** a captured player action (only flows while the player is in control) */
  onAction(action: Parameters<ExampleWriter['push']>[0]): void {
    if (this.#control !== 'you') return;
    this.#writer?.push(action);
    this.#lastInput = Date.now();
  }

  async stop(error?: unknown): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    clearInterval(this.#timer);
    await this.#stepping;
    await this.#saveCorrection();
    await this.#release();
    await this.client.request('mc.automation.playback.stop').catch(ignore);
    this.#driver?.close();
    const { corrections } = this.#status.practice!;
    if (error)
      this.#publish({
        state: 'failed',
        message: undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    else
      this.#publish({
        state: 'stopped',
        message: corrections
          ? `${corrections} correction${corrections === 1 ? '' : 's'} saved`
          : 'Stopped',
      });
    this.host.toast(
      'Practice stopped',
      corrections ? `${corrections} correction(s) saved` : undefined,
    );
  }

  async #step(): Promise<void> {
    this.#busy = true;
    try {
      if (this.#control === 'you') {
        if (Date.now() - this.#lastInput > HANDBACK_MS) {
          await this.#saveCorrection();
          this.#setControl('ai');
          this.host.toast('AI is playing again');
        }
        return;
      }
      const snap = await snapshotClient(this.client, {}, this.#palette);
      // until the client catches up, what the AI just did is the truth: seeing
      // "not using" right after pressing, the brain would let go again
      if (Date.now() - this.#useChangedAt < USE_LAG_MS)
        snap.self.usingItem = this.#useKey;
      const { blocks } = this.#palette;
      const added = blocks.slice(this.#sentBlocks);
      this.#sentBlocks = blocks.length;
      const decision = await this.#driver!.decide(snap, added);
      if (this.#control === 'ai' && !this.#stopped)
        await this.#apply(decision, snap.self);
      this.#failingSince = undefined;
    } catch (error) {
      const now = Date.now();
      this.#failingSince ??= now;
      if (this.#stopped) return;
      if (now - this.#failingSince > FAILING_MS) void this.stop(error);
      else console.warn('[practice] step skipped:', error);
    } finally {
      this.#busy = false;
    }
  }

  async #saveCorrection() {
    const writer = this.#writer;
    if (!writer) return;
    this.#writer = undefined;
    await this.host.releaseCapture(this.clientId, this.sessionId);
    await writer.stop();
    const practice = this.#status.practice!;
    if (writer.steps)
      this.#publish({
        practice: { ...practice, corrections: practice.corrections + 1 },
      });
  }

  async #apply(
    { values: v, intent, target, commands }: BrainDriveDecision,
    self: { held: string },
  ) {
    const { client } = this;
    this.#show(intent, target);

    // movement and aim pause while walking to a far target; the other heads keep deciding, like Brain.run
    if (!this.#navigate(target, Date.now())) {
      const movement = {
        forward: v.forward === 2,
        back: v.forward === 0,
        left: v.strafe === 0,
        right: v.strafe === 2,
        jump: v.jump === 1,
        sprint: v.sprint === 1,
        sneak: v.sneak === 1,
      };
      const key = JSON.stringify(movement);
      if (key !== this.#movement) {
        this.#movement = key;
        void client.setMovement(movement).catch(ignore);
      }

      if (target)
        void client
          .lookAt(
            target.kind === 'entity'
              ? { x: target.x, y: target.y + 1.2, z: target.z }
              : { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 },
          )
          .catch(ignore);
    }

    for (const command of commands) await this.#act(command);
    if (this.#digging && !commands.some((c) => c.do === 'break')) {
      this.#digging = false;
      void client.stopDig().catch(ignore);
    }

    // hold right click like a player: while the key is held the client keeps
    // drawing a bow or eating, letting go shoots or stops
    const useKey = v.useItem === 1 || this.#drawing;
    if (useKey !== this.#useKey) {
      this.#useKey = useKey;
      this.#useChangedAt = Date.now();
      void client
        .setKey({ key: 'use', pressed: useKey })
        .then(() => (useKey ? client.useItem() : client.releaseUseItem()))
        .catch(ignore);
    }

    const item = v.hold && this.#driver!.hold?.[v.hold - 1];
    if (item && self.held !== item) await this.#equip(item);
  }

  /** one step of the target's action (see workers/brain/actions.ts Actor) */
  async #act(command: ActCommand) {
    const { client } = this;
    if (command.do === 'equip') return this.#equip(command.item);
    if (command.do === 'draw' || command.do === 'release') {
      this.#drawing = command.do === 'draw';
      return;
    }
    const { target } = command;
    if (target.kind === 'entity') {
      const id = target.id as number;
      void (
        command.do === 'use'
          ? client.useEntity({ id })
          : client.attackEntity({ id })
      ).catch(ignore);
    } else if (command.do === 'use')
      void client
        .activateBlock({ ...blockPos(target), face: target.action?.face })
        .catch(ignore);
    else {
      // repeating it is a no-op while the client digs the same block
      this.#digging = true;
      void client.dig(blockPos(target)).catch(ignore);
    }
  }

  async #equip(item: string) {
    const { items } = await this.client.getInventory();
    const slot = items.find(
      (stack) => stack.slot < 9 && shortName(stack.itemId) === item,
    );
    if (slot) await this.client.setHotbarSlot(slot.slot).catch(ignore);
    // not in the hotbar: swap it in from the inventory
    else
      await this.client
        .equip({ itemId: item, destination: 'hand' })
        .catch(ignore);
  }

  /** walks to a far target with the client's pathfinder; true while walking (the learned movement takes over within range) */
  #navigate(target: BrainDriveDecision['target'], now: number): boolean {
    const range = engageRange(target, this.#driver!.range ?? DEFAULT_RANGE);
    if (!target || target.dist <= range) {
      if (this.#navigating) {
        this.#navigating = undefined;
        void this.client.stopPath().catch(ignore);
      }
      return false;
    }
    if (
      this.#navigating?.id !== target.id ||
      now - this.#navigating.at > RENAVIGATE_MS
    ) {
      this.#navigating = { id: target.id, at: now };
      this.#movement = '';
      const options = { sprint: true, arriveRadius: Math.max(1, range - 1) };
      void (
        target.kind === 'entity'
          ? this.client.gotoEntity({ id: target.id as number, ...options })
          : this.client.goto({ ...blockPos(target), ...options })
      ).catch(ignore);
    }
    return true;
  }

  /** shows what the AI is doing: a label on its target in the world, the chances in the app */
  #show(
    intent: BrainDriveDecision['intent'],
    target: BrainDriveDecision['target'],
  ) {
    const names = this.#driver!.intents;
    const name = names[intent?.chosen ?? 0];
    const marked = target ? `${target.id}|${name}` : '';
    if (marked !== this.#marked) {
      this.#marked = marked;
      void (
        target
          ? this.client.marker({
              id: MARKER_ID,
              label: name,
              x: target.x + (target.kind === 'block' ? 0.5 : 0),
              y: target.y + (target.kind === 'block' ? 0.5 : 0),
              z: target.z + (target.kind === 'block' ? 0.5 : 0),
              entityId:
                target.kind === 'entity' ? (target.id as number) : undefined,
            })
          : this.client.removeMarker({ id: MARKER_ID })
      ).catch(ignore);
    }
    const now = Date.now();
    const doing = this.#status.practice!.doing;
    if (
      !intent ||
      (doing?.name === name && now - this.#shownDoingAt < SHOW_DOING_MS)
    )
      return;
    this.#shownDoingAt = now;
    this.#publish({
      practice: {
        ...this.#status.practice!,
        doing: {
          name,
          chances: intent.chances
            .map((chance, k): [string, number] => [names[k], chance])
            .sort((a, b) => b[1] - a[1]),
        },
      },
    });
  }

  /** lets go of everything the AI was doing */
  async #release() {
    const { client } = this;
    this.#marked = '';
    this.#movement = '';
    this.#navigating = undefined;
    this.#digging = false;
    this.#useKey = false;
    this.#drawing = false;
    await Promise.all([
      client.setMovement({}).catch(ignore),
      client.stopPath().catch(ignore),
      client.stopDig().catch(ignore),
      client.setKey({ key: 'use', pressed: false }).catch(ignore),
      client.releaseUseItem().catch(ignore),
      client.removeMarker({ id: MARKER_ID }).catch(ignore),
    ]);
  }

  #setControl(control: 'ai' | 'you') {
    this.#publish({
      practice: { ...this.#status.practice!, control, doing: undefined },
      message: control === 'ai' ? 'AI is playing' : "You're in control",
    });
  }

  #publish(patch: Partial<AutomationSessionStatus>) {
    this.#status = { ...this.#status, ...patch, updatedAt: Date.now() };
    this.host.publish(this.#status);
  }
}

const blockPos = (target: McVec3) => ({
  x: Math.floor(target.x),
  y: Math.floor(target.y),
  z: Math.floor(target.z),
});
