import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import {
  applyAutomationInputs,
  resolveAutomationPosition,
  resolveAutomationVector,
  resolveAutomationYaw,
  toMineflayerPitch,
  toMineflayerYaw,
  type AutomationDocument,
  type AutomationEntitySelector,
  type AutomationPathPoint,
  type AutomationReplayOptions,
  type AutomationReplayOrigin,
  type AutomationStep,
  type AutomationTargetDescriptor,
} from '../../../../../common/automation';
import type { AutomationExecutionContext, AutomationTargetAdapter } from '../../../../../common/AutomationPlayer';
import type { Bot } from '../../workerTypes';

const READY_TIMEOUT_MS = 3_000;
const READY_POLL_MS = 200;
const RECOVERY_TIMEOUT_MS = 10_000;
const normalize = (value?: string): string => (value ?? '').replace(/§./g, '').trim().toLowerCase();
const toMinecraftYaw = (yaw: number): number => ((Math.PI - yaw) * 180) / Math.PI;
export default class MineflayerAutomationAdapter implements AutomationTargetAdapter {
  readonly target: AutomationTargetDescriptor;
  private motionPaused = false;

  constructor(private readonly bot: Bot) {
    this.target = { kind: 'bot', id: bot.botId, username: bot.username };
    const trackState = (packet: any) => {
      if (typeof packet?.stateId === 'number') (bot as any)._lastStateId = packet.stateId;
    };
    bot._client?.on('window_items', trackState);
    bot._client?.on('set_slot', trackState);
  }

  async prepare(document: AutomationDocument, options: AutomationReplayOptions): Promise<AutomationReplayOrigin> {
    if (!this.bot.entity) throw new Error('Bot has not spawned');
    const current = this.bot.entity.position;
    if (options.spatialMode === 'absolute') {
      const dimension = String(this.bot.game?.dimension ?? '');
      if (document.source.dimension?.replace('minecraft:', '') && dimension !== document.source.dimension.replace('minecraft:', ''))
        throw new Error(`Wrong dimension: expected ${document.source.dimension}, found ${dimension}`);
      if (current.distanceTo(new Vec3(document.origin.x, document.origin.y, document.origin.z)) > 2)
        throw new Error('Move the bot within 2 blocks of the recorded start');
    }
    return { x: current.x, y: current.y, z: current.z, yaw: toMinecraftYaw(this.bot.entity.yaw) };
  }

  async execute(step: AutomationStep, context: AutomationExecutionContext): Promise<void> {
    const point = (reference: Parameters<typeof resolveAutomationPosition>[0]) =>
      resolveAutomationPosition(reference, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw);
    switch (step.kind) {
      case 'movePath': await this.replayMotion(step, context, point); return;
      case 'chat': this.bot.chat(applyAutomationInputs(step.message, context.options.inputs)); return;
      case 'hotbar': this.bot.setQuickBarSlot(step.slot); return;
      case 'openInventory': this.bot.openInventory?.(); return;
      case 'windowClick': {
        await this.waitFor(() => Promise.resolve(this.matchesWindow(step.window)), context);
        this.clickWindow(step.slot, step.button, this.windowMode(step.actionType));
        await this.sleep(60, context.signal);
        return;
      }
      case 'closeWindow':
        if (this.bot.currentWindow && (!step.window || this.matchesWindow(step.window))) this.bot.closeWindow(this.bot.currentWindow);
        return;
      case 'attackEntity':
      case 'useEntity': {
        const entity = await this.waitForEntity(step.entity, context);
        if (step.kind === 'attackEntity') this.bot.attack(entity);
        else await this.bot.useOn(entity);
        return;
      }
      case 'breakBlock': {
        const target = point(step.position);
        const pos = new Vec3(target.x, target.y, target.z);
        await this.waitFor(() => {
          const b = this.bot.blockAt(pos);
          return Promise.resolve(Boolean(b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air'));
        }, context);
        const block = this.bot.blockAt(pos);
        if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') throw new Error('Block to break is not loaded or is air');
        await this.bot.dig(block);
        return;
      }
      case 'useBlock': {
        const target = point(step.position);
        await this.waitFor(() => Promise.resolve(Boolean(this.bot.blockAt(new Vec3(target.x, target.y, target.z)))), context);
        const block = this.bot.blockAt(new Vec3(target.x, target.y, target.z));
        if (!block) throw new Error('Block to use is not loaded');
        await this.bot.activateBlock(block, this.faceVector(step.face));
        return;
      }
      case 'useItem': this.bot.activateItem(step.hand === 'off'); return;
      case 'releaseUseItem': this.bot.deactivateItem(); return;
      case 'swingArm': this.bot.swingArm(step.hand === 'off' ? 'left' : 'right'); return;
      case 'swapHands':
        this.bot._client.write('entity_action', { entityId: this.bot.entity.id, actionId: 6, jumpBoost: 0 });
        return;
      case 'dropItem':
        if (this.bot.heldItem && step.entireStack) await this.bot.tossStack(this.bot.heldItem);
        else if (this.bot.heldItem) await this.bot.toss(this.bot.heldItem.type, this.bot.heldItem.metadata, 1);
        return;
      case 'wake': await this.bot.wake(); return;
      case 'respawn':
        await this.waitFor(() => Promise.resolve(this.bot.health <= 0), context);
        this.bot._client.write('client_command', { payload: 0 });
        return;
      case 'screenAction': await this.screenAction(step.action, step.data); return;
    }
  }

  async pause(): Promise<void> {
    this.motionPaused = true;
    this.bot.clearControlStates();
    this.bot.stopDigging?.();
    this.bot.deactivateItem();
    this.bot.pathfinder?.setGoal?.(null);
  }

  async resume(): Promise<void> { this.motionPaused = false; }
  async stop(): Promise<void> { await this.pause(); }

  private async replayMotion(
    step: Extract<AutomationStep, { kind: 'movePath' }>,
    context: AutomationExecutionContext,
    position: (point: AutomationPathPoint) => { x: number; y: number; z: number },
  ): Promise<void> {
    const frames = step.points.map((frame) => ({
      frame, target: position(frame),
      yaw: resolveAutomationYaw(frame.yaw, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw),
      velocity: frame.velocity ? resolveAutomationVector(frame.velocity, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw) : undefined,
    }));
    let index = 0;
    let driftFrames = 0;
    let recoveries = 0;
    try {
      while (index < frames.length && !context.signal.aborted) {
        while (this.motionPaused && !context.signal.aborted) await this.sleep(25, context.signal);
        if (context.signal.aborted) break;
        const current = frames[index];
        await this.applyMotionFrame(current);
        await this.nextPhysicsTick(context.signal);
        if (this.motionPaused) continue;

        const actual = this.bot.entity.position;
        const horizontalError = Math.hypot(current.target.x - actual.x, current.target.z - actual.z);
        const safe = current.frame.onGround && this.bot.entity.onGround && !current.frame.riding && !this.bot.entity.vehicle;
        driftFrames = safe && horizontalError > 0.5 ? driftFrames + 1 : 0;
        if (driftFrames >= 3) {
          if (recoveries >= 2 || !(await this.recoverToAnchor(frames, index, context.signal)))
            throw new Error('Motion recovery failed after two anchor attempts');
          recoveries += 1;
          driftFrames = 0;
          index = this.lastAnchor(frames, index);
          continue;
        }
        index += 1;
      }
    } finally {
      this.bot.clearControlStates();
    }
  }

  private async applyMotionFrame(current: { frame: AutomationPathPoint; target: { x: number; y: number; z: number }; yaw: number }): Promise<void> {
    let yaw = current.yaw;
    if (current.frame.forward && !current.frame.back && !current.frame.left && !current.frame.right) {
      const actual = this.bot.entity.position;
      const dx = current.target.x - actual.x;
      const dz = current.target.z - actual.z;
      if (dx * dx + dz * dz > 0.12) yaw += Math.max(-8, Math.min(8, this.wrapDegrees((Math.atan2(-dx, dz) * 180) / Math.PI - yaw)));
    }
    await this.bot.look(toMineflayerYaw(yaw), toMineflayerPitch(current.frame.pitch), true);
    this.bot.setControlState('forward', current.frame.forward);
    this.bot.setControlState('back', current.frame.back);
    this.bot.setControlState('left', current.frame.left);
    this.bot.setControlState('right', current.frame.right);
    this.bot.setControlState('jump', current.frame.jump);
    this.bot.setControlState('sneak', current.frame.sneak);
    this.bot.setControlState('sprint', current.frame.sprint);
  }

  private lastAnchor(frames: { frame: AutomationPathPoint }[], index: number): number {
    for (let candidate = index; candidate >= 0; candidate -= 1)
      if (frames[candidate].frame.onGround && !frames[candidate].frame.jump && !frames[candidate].frame.riding) return candidate;
    return 0;
  }

  private async recoverToAnchor(frames: { frame: AutomationPathPoint; target: { x: number; y: number; z: number } }[], index: number, signal: AbortSignal): Promise<boolean> {

    if (!this.bot.pathfinder?.goto) return false;
    this.bot.clearControlStates();
    for (let candidate = this.lastAnchor(frames, index); candidate >= 0; candidate -= 1) {
      const frame = frames[candidate];
      if (!frame.frame.onGround || frame.frame.jump || frame.frame.riding) continue;
      try {
        await this.withTimeout(this.bot.pathfinder.goto(new goals.GoalNear(frame.target.x, frame.target.y, frame.target.z, 0.5)), RECOVERY_TIMEOUT_MS, signal);
        return true;
      } catch {
        this.bot.pathfinder.setGoal(null);
      }
    }
    return false;
  }

  private matchesWindow(matcher?: { title?: string; type?: string; inventory?: boolean }): boolean {
    if (!matcher) return true;

    if (matcher.inventory === true || (!matcher.title && !matcher.type)) {
      return true;
    }

    const window = this.bot.currentWindow;
    if (!window) return false;

    if (matcher.type && window.type !== undefined) {
      const typeStr = String(window.type).toLowerCase();
      const keyStr = (window as any).key ? String((window as any).key).toLowerCase() : '';
      const matchType = matcher.type.toLowerCase();
      if (
        typeStr !== matchType &&
        keyStr !== matchType &&
        !matchType.includes(typeStr) &&
        !typeStr.includes(matchType.replace('minecraft:', '')) &&
        !keyStr.includes(matchType.replace('minecraft:', ''))
      ) {
        return false;
      }
    }

    if (matcher.title) {
      const currentTitle = normalize(this.extractWindowTitle(window.title));
      const matchTitle = normalize(matcher.title);
      if (currentTitle && matchTitle) {
        const titleWords = matchTitle.split(/\s+/).filter((w) => w.length > 2);
        const matchesAnyWord = titleWords.some((w) => currentTitle.includes(w));
        if (!currentTitle.includes(matchTitle) && !matchTitle.includes(currentTitle) && !matchesAnyWord) {
          return false;
        }
      }
    }

    return true;
  }

  private extractWindowTitle(title: unknown): string {
    if (!title) return '';
    if (typeof title === 'string') {
      try {
        const parsed = JSON.parse(title);
        return this.extractWindowTitle(parsed);
      } catch {
        return title;
      }
    }
    if (typeof title === 'object' && title !== null) {
      if (Array.isArray(title)) {
        return title.map((item) => this.extractWindowTitle(item)).join(' ');
      }
      const obj = title as Record<string, unknown>;
      let text = '';
      if (typeof obj.text === 'string') text += obj.text;
      if (typeof obj.translate === 'string') {
        const tr = obj.translate;
        if (tr.startsWith('container.')) {
          text += ' ' + tr.replace('container.', '').replace(/([A-Z])/g, ' $1');
        } else {
          text += ' ' + tr;
        }
      }
      if (Array.isArray(obj.extra)) {
        text += ' ' + obj.extra.map((item) => this.extractWindowTitle(item)).join(' ');
      }
      if (Array.isArray(obj.with)) {
        text += ' ' + obj.with.map((item) => this.extractWindowTitle(item)).join(' ');
      }
      return text.trim();
    }
    return String(title);
  }

  private async waitForEntity(selector: AutomationEntitySelector, context: AutomationExecutionContext): Promise<any> {
    let entity: any;
    await this.waitFor(() => {
      try { entity = this.resolveEntity(selector, context); return Promise.resolve(true); } catch { return Promise.resolve(false); }
    }, context);
    return entity;
  }

  private resolveEntity(selector: AutomationEntitySelector, context: AutomationExecutionContext): any {
    let entities = Object.values(this.bot.entities).filter((entity: any) => {
      if (!entity || entity === this.bot.entity || !entity.position || !this.bot.entity?.position) return false;
      const type = entity.name ?? entity.type;
      return (!selector.type || type === selector.type || selector.type.endsWith(`:${type}`)) &&
        (!selector.name || entity.username === selector.name || entity.displayName === selector.name) &&
        this.bot.entity.position.distanceTo(entity.position) <= (selector.radius ?? 16);
    }) as any[];
    if (selector.uuid) {
      const exact = entities.find((entity) => entity.uuid === selector.uuid);
      if (exact) return exact;
    }
    if (selector.position) {
      const expected = resolveAutomationPosition(selector.position, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw);
      entities.sort((a, b) => a.position.distanceTo(new Vec3(expected.x, expected.y, expected.z)) - b.position.distanceTo(new Vec3(expected.x, expected.y, expected.z)));
    } else {
      entities.sort((a, b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position));
    }
    if (!entities[0]) throw new Error('Entity target is unavailable');
    return entities[0];
  }

  private async screenAction(action: string, data: Record<string, unknown>): Promise<void> {
    const packets: Record<string, string> = {
      button: 'enchant_item', recipe: 'craft_recipe_request', trade: 'select_trade', rename: 'name_item',
      beacon: 'set_beacon_effect', bundle: 'bundle_item_selected', creativeSlot: 'set_creative_slot',
      pickItem: 'pick_item', spectatorTeleport: 'spectate',
    };
    if (action === 'sign') {
      const position = data.position as { x?: number; y?: number; z?: number } | undefined;
      const text = data.text;
      if (!position || typeof text !== 'string') throw new Error('Invalid sign action');
      const block = this.bot.blockAt(new Vec3(position.x ?? 0, position.y ?? 0, position.z ?? 0));
      if (!block) throw new Error('Sign is not loaded');
      this.bot.updateSign(block, text);
      return;
    }
    if (action === 'book') {
      const slot = data.slot;
      const pages = data.pages;
      if (typeof slot !== 'number' || !Array.isArray(pages) || pages.some((page) => typeof page !== 'string')) throw new Error('Invalid book action');
      await this.bot.writeBook(slot, pages);
      return;
    }
    const packet = packets[action];
    if (!packet) throw new Error(`Unsupported screen action: ${action}`);
    this.bot._client.write(packet, data as object);
  }

  private async waitFor(check: () => Promise<boolean>, context: AutomationExecutionContext): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!context.signal.aborted && Date.now() < deadline) {
      if (await check()) return;
      await this.sleep(READY_POLL_MS, context.signal);
    }
    if (!context.signal.aborted) throw new Error('Action was not ready within 3 seconds');
  }

  private wrapDegrees(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180; }
  private faceVector(face?: string): Vec3 {
    return ({ up: new Vec3(0, 1, 0), down: new Vec3(0, -1, 0), north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) } as Record<string, Vec3>)[face ?? 'up'];
  }
  private windowMode(actionType: string): number {
    const normalized = (actionType ?? '').toUpperCase().replace(/[-_]/g, '');
    return (
      {
        PICKUP: 0,
        '0': 0,
        QUICKMOVE: 1,
        SHIFT: 1,
        SHIFTCLICK: 1,
        '1': 1,
        SWAP: 2,
        NUMBER: 2,
        HOTBAR: 2,
        '2': 2,
        CLONE: 3,
        MIDDLE: 3,
        '3': 3,
        THROW: 4,
        DROP: 4,
        '4': 4,
        QUICKCRAFT: 5,
        DRAG: 5,
        '5': 5,
        PICKUPALL: 6,
        DOUBLECLICK: 6,
        DOUBLE: 6,
        '6': 6,
      }[normalized] ?? 0
    );
  }
  private async nextPhysicsTick(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => { signal.removeEventListener('abort', done); this.bot.off('physicsTick', done); resolve(); };
      signal.addEventListener('abort', done, { once: true }); this.bot.once('physicsTick', done);
    });
  }
  private async withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pathfinder recovery timed out')), ms);
      const abort = () => reject(new Error('Stopped'));
      signal.addEventListener('abort', abort, { once: true });
      promise.then((value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(value); }, (error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const abort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.max(0, ms));
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  private clickWindow(slot: number, button: number, mode: number): void {
    const window = this.bot.currentWindow || this.bot.inventory;
    if (!window) return;

    const Item = require('prismarine-item')(this.bot.registry);
    let changedSlots: any[] = [];
    if (mode >= 0 && mode <= 4) {
      const oldSlots = JSON.parse(JSON.stringify(window.slots));
      window.acceptClick({ slot, mouseButton: button, mode, id: 0, windowId: window.id, item: slot === -999 ? null : window.slots[slot] });
      for (let i = 0; i < window.slots.length; i++) {
        if (!Item.equal(oldSlots[i], window.slots[i])) {
          changedSlots.push({ location: i, item: Item.toNotch(window.slots[i]) });
        }
      }
    }

    const stateId = (this.bot as any)._lastStateId ?? (window as any).stateId ?? 0;
    const cursorItem = Item.toNotch(window.selectedItem);

    if (this.bot.supportFeature('stateIdUsed')) {
      this.bot._client.write('window_click', {
        windowId: window.id,
        stateId,
        slot,
        mouseButton: button,
        mode,
        changedSlots,
        cursorItem,
      });
    } else if (this.bot.supportFeature('actionIdUsed')) {
      this.bot._client.write('window_click', {
        windowId: window.id,
        slot,
        mouseButton: button,
        action: 1,
        mode,
        item: Item.toNotch((mode === 2 || mode === 4) ? null : (slot === -999 ? null : window.slots[slot])),
      });
    } else {
      this.bot._client.write('window_click', {
        windowId: window.id,
        slot,
        mouseButton: button,
        mode,
        changedSlots,
        cursorItem,
      });
    }
  }
}
