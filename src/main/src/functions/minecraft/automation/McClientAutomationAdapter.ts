import {
  applyAutomationInputs,
  resolveAutomationPosition,
  resolveAutomationVector,
  resolveAutomationYaw,
  type AutomationDocument,
  type AutomationEntitySelector,
  type AutomationReplayOptions,
  type AutomationReplayOrigin,
  type AutomationStep,
  type AutomationTargetDescriptor,
  type AutomationVec3,
} from '../../../../../common/automation';
import type { AutomationExecutionContext, AutomationTargetAdapter } from '../../../../../common/AutomationPlayer';
import type { IMcClient, McEntityInfo, McWindowInfo } from '../../../../../common/types/McClientApi';

const READY_TIMEOUT_MS = 3_000;
const READY_POLL_MS = 200;
const normalize = (value?: string): string => (value ?? '').replace(/§./g, '').trim().toLowerCase();

export default class McClientAutomationAdapter implements AutomationTargetAdapter {
  readonly target: AutomationTargetDescriptor;

  constructor(private readonly client: IMcClient, target?: AutomationTargetDescriptor) {
    this.target = target ?? { kind: 'minecraft', id: client.id };
  }

  async prepare(document: AutomationDocument, options: AutomationReplayOptions): Promise<AutomationReplayOrigin> {
    const current = await this.client.getCurrentPosition();
    if (options.spatialMode === 'absolute') {
      const world = await this.client.getWorldInfo();
      if (document.source.dimension && world.dimension !== document.source.dimension)
        throw new Error(`Wrong dimension: expected ${document.source.dimension}, found ${world.dimension}`);
      if (Math.hypot(current.x - document.origin.x, current.y - document.origin.y, current.z - document.origin.z) > 2)
        throw new Error(`Move within 2 blocks of the recorded start (${document.origin.x.toFixed(1)}, ${document.origin.y.toFixed(1)}, ${document.origin.z.toFixed(1)})`);
    }
    return { x: current.x, y: current.y, z: current.z, yaw: current.yaw };
  }

  async execute(step: AutomationStep, context: AutomationExecutionContext): Promise<void> {
    const position = (reference: Parameters<typeof resolveAutomationPosition>[0]) =>
      resolveAutomationPosition(reference, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw);
    switch (step.kind) {
      case 'movePath': {
        const frames = step.points.map((point) => ({
          ...position(point), tick: point.tick,
          yaw: resolveAutomationYaw(point.yaw, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw),
          pitch: point.pitch, onGround: point.onGround,
          velocity: point.velocity ? resolveAutomationVector(point.velocity, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw) : undefined,
          forward: point.forward, back: point.back, left: point.left, right: point.right,
          jump: point.jump, sneak: point.sneak, sprint: point.sprint, riding: point.riding,
        }));
        let status = await this.client.request<{ active: boolean; error?: string }>('mc.automation.motion.start', { frames });
        while (status.active && !context.signal.aborted) {
          await this.sleep(50, context.signal);
          status = await this.client.request('mc.automation.motion.status');
        }
        if (context.signal.aborted) await this.client.request('mc.automation.motion.stop');
        if (status.error) throw new Error(status.error);
        return;
      }
      case 'chat':
        await this.client.chat(applyAutomationInputs(step.message, context.options.inputs));
        return;
      case 'hotbar':
        await this.client.setHotbarSlot(step.slot);
        return;
      case 'openInventory':
        await this.client.request('mc.inventory.open');
        return;
      case 'windowClick': {
        await this.waitForWindow(step.window, context);
        await this.client.clickSlot({ slot: step.slot, button: step.button, actionType: step.actionType });
        return;
      }
      case 'closeWindow':
        if (!step.window || await this.windowMatches(step.window)) await this.client.closeWindow();
        return;
      case 'attackEntity':
      case 'useEntity': {
        const entity = await this.waitForEntity(step.entity, context);
        const result = step.kind === 'attackEntity'
          ? await this.client.attackEntity({ id: entity.id })
          : await this.client.useEntity({ id: entity.id, hand: step.hand });
        if (!result.ok) throw new Error(result.reason ?? `Could not ${step.kind}`);
        return;
      }
      case 'breakBlock': {
        await this.waitFor(() => this.client.getBlockAt(position(step.position)).then((block) => !block.empty), context);
        const result = await this.client.mineBlock({ ...position(step.position), autoTool: true, maxRange: 128, blockTimeoutMs: 30_000 });
        if (!result.ok) throw new Error(result.reason ?? 'Could not break block');
        return;
      }
      case 'useBlock': {
        await this.waitFor(() => this.client.getBlockAt(position(step.position)).then((block) => !block.empty), context);
        const result = await this.client.activateBlock({ ...position(step.position), face: step.face, hand: step.hand });
        if (!result.ok) throw new Error(result.reason ?? 'Could not use block');
        return;
      }
      case 'useItem': {
        const result = await this.client.useItem({ hand: step.hand });
        if (!result.ok) throw new Error(result.reason ?? 'Could not use item');
        return;
      }
      case 'releaseUseItem': await this.client.releaseUseItem(); return;
      case 'swingArm': await this.client.swingArm({ hand: step.hand }); return;
      case 'swapHands': {
        const result = await this.client.swapHands();
        if (!result.ok) throw new Error(result.reason ?? 'Could not swap hands');
        return;
      }
      case 'dropItem': await this.client.dropItem({ entireStack: step.entireStack }); return;
      case 'wake': {
        const result = await this.client.request<{ ok?: boolean; reason?: string }>('mc.player.wake');
        if (result?.ok === false) throw new Error(result.reason ?? 'Could not wake');
        return;
      }
      case 'respawn': {
        await this.waitFor(async () => Boolean(await this.client.request('mc.player.canRespawn')), context);
        const result = await this.client.respawn();
        if (!result.ok) throw new Error(result.reason ?? 'Could not respawn');
        return;
      }
      case 'screenAction':
        await this.client.request('mc.automation.screenAction', { action: step.action, data: step.data });
        return;
    }
  }

  async pause(): Promise<void> {
    await Promise.allSettled([
      this.client.stopMining(), this.client.stopDig(), this.client.releaseUseItem(),
      this.client.setMovement({ forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false }),
      this.client.request('mc.automation.playback.pause'),
    ]);
  }

  async resume(): Promise<void> { await this.client.request('mc.automation.playback.resume'); }
  async stop(): Promise<void> { await this.pause(); }

  private async waitForWindow(matcher: { title?: string; type?: string; inventory?: boolean }, context: AutomationExecutionContext): Promise<McWindowInfo> {
    let current: McWindowInfo | undefined;
    await this.waitFor(async () => {
      const window = await this.client.getCurrentWindow();
      if (!window || !this.matchesWindow(window, matcher)) return false;
      current = window;
      return true;
    }, context);
    return current!;
  }

  private async windowMatches(matcher: { title?: string; type?: string; inventory?: boolean }): Promise<boolean> {
    const window = await this.client.getCurrentWindow();
    return Boolean(window && this.matchesWindow(window, matcher));
  }

  private matchesWindow(window: McWindowInfo, matcher: { title?: string; type?: string; inventory?: boolean }): boolean {
    if (matcher.inventory === true && window.inventory !== true) return false;
    if (matcher.title) {
      const currentTitle = normalize(window.title);
      const matchTitle = normalize(matcher.title);
      if (currentTitle && matchTitle && !currentTitle.includes(matchTitle) && !matchTitle.includes(currentTitle)) {
        return false;
      }
    }
    if (matcher.type) {
      const matchType = matcher.type.toLowerCase().replace('minecraft:', '');
      const winType = (window.type ?? '').toLowerCase().replace('minecraft:', '');
      const screenClass = (window.screenClass ?? '').toLowerCase();
      if (
        winType &&
        matchType &&
        winType !== matchType &&
        !winType.includes(matchType) &&
        !matchType.includes(winType) &&
        !screenClass.includes(matchType)
      ) {
        return false;
      }
    }
    return true;
  }

  private async waitForEntity(selector: AutomationEntitySelector, context: AutomationExecutionContext): Promise<McEntityInfo> {
    let entity: McEntityInfo | undefined;
    await this.waitFor(async () => {
      try { entity = await this.resolveEntity(selector, context); return true; } catch { return false; }
    }, context);
    return entity!;
  }

  private async resolveEntity(selector: AutomationEntitySelector, context: AutomationExecutionContext): Promise<McEntityInfo> {
    const result = await this.client.findEntities({ type: selector.type, name: selector.name, radius: selector.radius ?? 16, limit: 32 });
    let candidates = [...result.entities];
    if (selector.uuid) {
      const exact = candidates.find((entity) => entity.uuid === selector.uuid);
      if (exact) return exact;
    }
    if (selector.position) {
      const expected = resolveAutomationPosition(selector.position, context.options.spatialMode, context.replayOrigin, context.document.origin.yaw);
      candidates.sort((a, b) => Math.hypot(a.x - expected.x, a.y - expected.y, a.z - expected.z) - Math.hypot(b.x - expected.x, b.y - expected.y, b.z - expected.z));
    }
    if (!candidates[0]) throw new Error('Entity target is unavailable');
    return candidates[0];
  }

  private async waitFor(check: () => Promise<boolean>, context: AutomationExecutionContext): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!context.signal.aborted && Date.now() < deadline) {
      if (await check()) return;
      await this.sleep(READY_POLL_MS, context.signal);
    }
    if (!context.signal.aborted) throw new Error('Action was not ready within 3 seconds');
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const onAbort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, ms));
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
