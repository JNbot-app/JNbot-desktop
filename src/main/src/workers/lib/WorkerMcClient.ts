import type {
  IMcClient,
  McApiList,
  McApiCapabilities,
  McApiVersion,
  McBiomeInfo,
  McBlockFace,
  McBlockInfo,
  McBlockPos,
  McClientEventPayloads,
  McColumnInfo,
  McEntityInfo,
  McEntityFilter,
  McExperience,
  McFindBlocksResult,
  McHand,
  McHealth,
  McHeldItems,
  McInventorySnapshot,
  McItemStack,
  McKey,
  McLightInfo,
  McMovementState,
  McLookMode,
  McSmoothLookOptions,
  McSmoothLookStatus,
  McTaskStartResult,
  McMiningOptions,
  McMiningStatus,
  McNavigationOptions,
  McNearbyEntitiesResult,
  McOnlinePlayersResult,
  McPathfinderGotoResult,
  McPathfinderStatus,
  McPosition,
  McPlayerState,
  McBlockCube,
  McScanResult,
  McSignText,
  McStatusEffect,
  McWindowGeometry,
  McWindowInfo,
  McWorldInfo,
  McUiDefinition,
  McVec3,
  WorkerMcClientEventName,
  WorkerMcClientEventPayloads,
} from '../../../../common/types/McClientApi';

import workerScript from './workerScript';
import { isMcClientEventName, McClientEventName } from 'main/src/functions/minecraft/bridge/McClientEventSubscriptions';

const translateEvents: Record<WorkerMcClientEventName, McClientEventName> = {
  move: 'mc.position',
  chat: 'mc.chat',
  windowOpen: 'mc.window.open',
  windowClose: 'mc.window.close',
  updateSlot: 'mc.window.items',
  forceMove: 'mc.player.forcedTeleport',
  healthChanged: 'mc.health.changed',
  death: 'mc.death',
  respawn: 'mc.respawn',
  kicked: 'mc.kicked',
  pathArrived: 'mc.pathfinder.arrived',
  pathFailed: 'mc.pathfinder.failed',
  entitySpawned: 'mc.entity.spawned',
  entityDied: 'mc.entity.died',
  entityDespawned: 'mc.entity.despawned',
  playerStateChanged: 'mc.player.stateChanged',
  heldItemChanged: 'mc.player.heldItemChanged',
  effectsChanged: 'mc.player.effectsChanged',
  dimensionChanged: 'mc.dimension.changed',
  blockChanged: 'mc.block.changed',
  uiAction: 'mc.ui.action',
  taskCompleted: 'mc.task.completed',
  taskFailed: 'mc.task.failed',
  input: 'mc.automation.action',
};

export default class WorkerMcClient implements IMcClient {
  private static wired = false;
  private static readonly instances = new Set<WorkerMcClient>();

  readonly id: string;

  private readonly handlersByEvent = new Map<McClientEventName, Set<(data: any) => void>>();

  constructor(clientId: string) {
    this.id = clientId;

    WorkerMcClient.instances.add(this);

    if (!WorkerMcClient.wired) {
      WorkerMcClient.wired = true;
      workerScript.onMessage('MC_CLIENT_EVENT', (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return;
        const p = payload as { clientId?: unknown; name?: unknown; data?: unknown };
        if (typeof p.clientId !== 'string' || typeof p.name !== 'string') return;
        if (!isMcClientEventName(p.name)) return;

        for (const instance of WorkerMcClient.instances) {
          if (instance.id !== p.clientId) continue;
          instance.dispatch(p.name as McClientEventName, p.data);
        }
      });
    }
  }

  private toMcEvent(event: WorkerMcClientEventName): McClientEventName {
    if (event in translateEvents) {
      return translateEvents[event];
    }
    throw new Error(`Unknown event name: ${event}. Choose from: ${Object.keys(translateEvents).join(', ')}`);
  }

  private dispatch(event: McClientEventName, data: unknown): void {
    const handlers = this.handlersByEvent.get(event);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch {
        // swallow handler errors to avoid breaking the worker event loop
      }
    }
  }

  async on<E extends WorkerMcClientEventName>(
    event: E,
    handler: (data: WorkerMcClientEventPayloads[E]) => void,
  ): Promise<() => void> {
    const name = this.toMcEvent(event);
    let handlers = this.handlersByEvent.get(name);
    const wasEmpty = !handlers || handlers.size === 0;

    if (!handlers) {
      handlers = new Set();
      this.handlersByEvent.set(name, handlers);
    }

    handlers.add(handler as unknown as (data: McClientEventPayloads[typeof name]) => void);

    if (wasEmpty) {
      workerScript.send('SUBSCRIBE_MC_EVENT', { clientId: this.id, event: name });
    }

    return async () => {
      const set = this.handlersByEvent.get(name);
      if (!set) return;
      set.delete(handler);
      if (set.size > 0) return;
      this.handlersByEvent.delete(name);
      workerScript.send('UNSUBSCRIBE_MC_EVENT', { clientId: this.id, event: name });
    };
  }

  /** Forward a typed call to the main process's McClient by name. */
  private call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return workerScript.sendAsync('MC_CLIENT_METHOD', {
      clientId: this.id,
      method,
      params,
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  request<T = unknown>(envelope: { method: string; params?: unknown }): Promise<T>;
  request<T = unknown>(methodOrEnvelope: string | { method: string; params?: unknown }, params?: unknown): Promise<T> {
    if (typeof methodOrEnvelope === 'string') {
      return this.call<T>('request', { method: methodOrEnvelope, params });
    }
    return this.call<T>('request', methodOrEnvelope);
  }

  // ---- Input ----
  chat(message: string): Promise<void> { return this.call('chat', message); }
  setMovement(state: McMovementState): Promise<void> { return this.call('setMovement', state); }
  setKey(params: { key: McKey; pressed: boolean }): Promise<void> { return this.call('setKey', params); }
  look(params: { yaw: number; pitch: number; mode?: McLookMode }): Promise<void> { return this.call('look', params); }
  smoothLook(params: { yaw: number; pitch: number; mode?: McLookMode } & McSmoothLookOptions): Promise<McTaskStartResult & { durationMs?: number }> { return this.call('smoothLook', params); }
  smoothLookAt(params: McVec3 & McSmoothLookOptions): Promise<McTaskStartResult & { durationMs?: number }> { return this.call('smoothLookAt', params); }
  stopSmoothLook(taskId?: string): Promise<{ ok: boolean; reason?: string }> { return this.call('stopSmoothLook', taskId ?? null); }
  smoothLookStatus(): Promise<McSmoothLookStatus> { return this.call('smoothLookStatus'); }
  click(button: 'left' | 'right' = 'left'): Promise<void> { return this.call('click', button); }

  // ---- Inventory ----
  clickSlot(params: { slot: number; button?: number; actionType?: string; syncId?: number }): Promise<void> { return this.call('clickSlot', params); }
  closeWindow(): Promise<void> { return this.call('closeWindow'); }
  setHotbarSlot(slot: number): Promise<void> { return this.call('setHotbarSlot', slot); }
  getInventory(): Promise<McInventorySnapshot> { return this.call('getInventory'); }
  getCurrentWindow(): Promise<McWindowInfo | null> { return this.call('getCurrentWindow'); }
  findInventoryItems(params: { matching: string; limit?: number }): Promise<{ items: readonly (McItemStack & { readonly slot: number })[]; totalCount: number; matchedSlots: number }> { return this.call('findInventoryItems', params); }
  countInventoryItem(matching: string): Promise<number> { return this.call('countInventoryItem', matching); }
  moveInventorySlot(params: { from: number; to: number }): Promise<{ ok: boolean; affected: number; reason?: string }> { return this.call('moveInventorySlot', params); }
  swapInventorySlots(params: { from: number; to: number }): Promise<{ ok: boolean; affected: number; reason?: string }> { return this.call('swapInventorySlots', params); }
  quickMoveInventorySlot(slot: number): Promise<{ ok: boolean; affected: number; reason?: string }> { return this.call('quickMoveInventorySlot', slot); }
  transferInventory(params: { from: 'player' | 'container'; matching?: string; limit?: number }): Promise<{ ok: boolean; affected: number; reason?: string }> { return this.call('transferInventory', params); }

  // ---- Player info ----
  getCurrentPosition(): Promise<McPosition> { return this.call('getCurrentPosition'); }
  getHealth(): Promise<McHealth> { return this.call('getHealth'); }
  getExperience(): Promise<McExperience> { return this.call('getExperience'); }
  getHeldItems(): Promise<McHeldItems> { return this.call('getHeldItems'); }
  getStatusEffects(): Promise<{ effects: readonly McStatusEffect[] }> { return this.call('getStatusEffects'); }
  getPlayerState(): Promise<McPlayerState> { return this.call('getPlayerState'); }

  // ---- Player actions ----
  swingArm(params?: { hand?: McHand }): Promise<void> { return this.call('swingArm', params ?? {}); }
  dropItem(params?: { entireStack?: boolean }): Promise<void> { return this.call('dropItem', params ?? {}); }
  dig(params: McBlockPos & { face?: McBlockFace }): Promise<{ ok: boolean; instant?: boolean; reason?: string }> { return this.call('dig', params); }
  stopDig(): Promise<void> { return this.call('stopDig'); }
  placeBlock(params: McBlockPos & { face?: McBlockFace; hand?: McHand }): Promise<{ ok: boolean }> { return this.call('placeBlock', params); }
  activateBlock(params: McBlockPos & { face?: McBlockFace; hand?: McHand }): Promise<{ ok: boolean }> { return this.call('activateBlock', params); }
  useOnLooked(params?: { maxDistance?: number }): Promise<{ ok: boolean; reason?: string; block?: McBlockPos }> { return this.call('useOnLooked', params ?? {}); }
  equip(params: { itemId?: string; slot?: number; destination: 'hand' | 'off-hand' | 'head' | 'chest' | 'legs' | 'feet' | 'hotbar' }): Promise<{ ok: boolean; reason?: string; destinationSlot?: number }> { return this.call('equip', params); }
  sleep(): Promise<{ ok: boolean }> { return this.call('sleep'); }
  wake(): Promise<{ ok: boolean }> { return this.call('wake'); }
  lookAt(params: McVec3): Promise<{ ok: boolean; reason?: string }> { return this.call('lookAt', params); }
  useItem(params?: { hand?: McHand }): Promise<{ ok: boolean; reason?: string }> { return this.call('useItem', params ?? {}); }
  releaseUseItem(): Promise<{ ok: boolean; reason?: string }> { return this.call('releaseUseItem'); }
  swapHands(): Promise<{ ok: boolean; reason?: string }> { return this.call('swapHands'); }
  respawn(): Promise<{ ok: boolean; reason?: string }> { return this.call('respawn'); }

  // ---- Entities ----
  attackEntity(params: { id: number }): Promise<{ ok: boolean; reason?: string }> { return this.call('attackEntity', params); }
  useEntity(params: { id: number; hand?: McHand }): Promise<{ ok: boolean; reason?: string }> { return this.call('useEntity', params); }
  getEntityById(params: { id: number }): Promise<McEntityInfo | null> { return this.call('getEntityById', params); }
  findEntities(params: McEntityFilter = {}): Promise<{ entities: readonly McEntityInfo[]; total: number }> { return this.call('findEntities', params); }
  nearestEntity(params: Omit<McEntityFilter, 'limit'> = {}): Promise<McEntityInfo | null> { return this.call('nearestEntity', params); }
  lookAtEntity(id: number): Promise<{ ok: boolean; reason?: string }> { return this.call('lookAtEntity', id); }
  followEntity(params: { id: number; distance?: number; sprint?: boolean; taskId?: string }): Promise<{ ok: boolean; taskId?: string; reason?: string }> { return this.call('followEntity', params); }
  attackEntityUntilDead(params: { id: number; distance?: number; sprint?: boolean; taskId?: string }): Promise<{ ok: boolean; taskId?: string; reason?: string }> { return this.call('attackEntityUntilDead', params); }
  stopTask(taskId?: string): Promise<{ ok: boolean; reason?: string }> { return this.call('stopTask', taskId ?? null); }
  taskStatus(): Promise<{ active: boolean; taskId?: string; type?: string; entityId?: number }> { return this.call('taskStatus'); }

  // ---- World / blocks ----
  getNearbyEntities(params?: { radius?: number; limit?: number; includePlayers?: boolean; type?: string }): Promise<McNearbyEntitiesResult> { return this.call('getNearbyEntities', params ?? {}); }
  getOnlinePlayers(): Promise<McOnlinePlayersResult> { return this.call('getOnlinePlayers'); }
  getBlockAt(params: McBlockPos): Promise<McBlockInfo> { return this.call('getBlockAt', params); }
  blockAtCursor(params?: { maxDistance?: number }): Promise<McBlockInfo | null> { return this.call('blockAtCursor', params ?? {}); }
  raycast(params?: { maxDistance?: number }): Promise<McBlockInfo | null> { return this.call('raycast', params ?? {}); }
  findBlock(params: { matching: string | readonly string[]; maxDistance?: number; useExtraInfo?: boolean }): Promise<McBlockInfo | null> { return this.call('findBlock', params); }
  findBlocks(params: { matching: string | readonly string[]; maxDistance?: number; count?: number; useExtraInfo?: boolean }): Promise<McFindBlocksResult> { return this.call('findBlocks', params); }
  getBlockCube(params: { from: McBlockPos; to: McBlockPos }): Promise<McBlockCube> { return this.call('getBlockCube', params); }
  scanBox(params: { from: McBlockPos; to: McBlockPos; matching?: string | readonly string[]; count?: number; details?: boolean }): Promise<McScanResult> { return this.call('scanBox', params); }
  getColumn(params: { x: number; z: number }): Promise<McColumnInfo> { return this.call('getColumn', params); }
  getBiome(params: McBlockPos): Promise<McBiomeInfo> { return this.call('getBiome', params); }
  getLight(params: McBlockPos): Promise<McLightInfo> { return this.call('getLight', params); }
  getWorldInfo(): Promise<McWorldInfo> { return this.call('getWorldInfo'); }
  getSignText(params: McBlockPos): Promise<McSignText | null> { return this.call('getSignText', params); }
  watchBlocks(params: { id?: string; from: McBlockPos; to: McBlockPos; intervalMs?: number }): Promise<{ ok: boolean; id?: string; volume?: number; reason?: string }> { return this.call('watchBlocks', params); }
  unwatchBlocks(id: string): Promise<{ ok: boolean }> { return this.call('unwatchBlocks', id); }
  clearBlockWatches(): Promise<{ ok: boolean; affected: number }> { return this.call('clearBlockWatches'); }

  // ---- Mining automation ----
  mineBlock(params: McBlockPos & Omit<McMiningOptions, 'matching' | 'maxBlocks'>): Promise<McTaskStartResult> { return this.call('mineBlock', params); }
  mineNearest(params: McMiningOptions & { matching: string | readonly string[] }): Promise<McTaskStartResult> { return this.call('mineNearest', params); }
  veinMine(params: McBlockPos & McMiningOptions & { diagonal?: boolean }): Promise<McTaskStartResult> { return this.call('veinMine', params); }
  stopMining(taskId?: string): Promise<{ ok: boolean; reason?: string }> { return this.call('stopMining', taskId ?? null); }
  miningStatus(): Promise<McMiningStatus> { return this.call('miningStatus'); }

  // ---- Pathfinder ----
  goto(params: McBlockPos & McNavigationOptions): Promise<McPathfinderGotoResult> { return this.call('goto', params); }
  gotoEntity(params: { id: number } & McNavigationOptions): Promise<McPathfinderGotoResult> { return this.call('gotoEntity', params); }
  gotoBlock(params: { matching: string | readonly string[]; maxDistance?: number } & McNavigationOptions): Promise<McPathfinderGotoResult> { return this.call('gotoBlock', params); }
  flee(params: { x: number; z: number; distance?: number } & Pick<McNavigationOptions, 'sprint' | 'movement' | 'maxNodes' | 'maxRange' | 'taskId'>): Promise<McPathfinderGotoResult> { return this.call('flee', params); }
  stopPath(taskId?: string): Promise<void> { return this.call('stopPath', taskId ?? null); }
  pathStatus(): Promise<McPathfinderStatus> { return this.call('pathStatus'); }

  // ---- Game window ----
  getWindowInfo(): Promise<McWindowGeometry> { return this.call('getWindowInfo'); }
  setWindowTitle(params: { title: string }): Promise<void> { return this.call('setWindowTitle', params); }
  setFullscreen(params?: { fullscreen?: boolean }): Promise<void> { return this.call('setFullscreen', params ?? {}); }

  // ---- HUD / OS ----
  toast(params: { title: string; body?: string; kind?: 'info' | 'ok' | 'warn' | 'error'; durationMs?: number }): Promise<{ ok: boolean }> { return this.call('toast', params); }
  clearToasts(): Promise<void> { return this.call('clearToasts'); }
  marker(params: { id?: string; x: number; y: number; z: number; label?: string; color?: string; ttlMs?: number }): Promise<{ id: string }> { return this.call('marker', params); }
  removeMarker(params: { id: string }): Promise<void> { return this.call('removeMarker', params); }
  clearMarkers(): Promise<void> { return this.call('clearMarkers'); }
  beep(params?: { sound?: string; volume?: number; pitch?: number }): Promise<{ ok: boolean }> { return this.call('beep', params ?? {}); }
  flashWindow(): Promise<{ ok: boolean }> { return this.call('flashWindow'); }
  openUi(definition: McUiDefinition): Promise<{ ok: boolean; id: string }> { return this.call('openUi', definition); }
  closeUi(id?: string): Promise<{ ok: boolean }> { return this.call('closeUi', id ?? null); }

  // ---- Diagnostics ----
  apiList(): Promise<McApiList> { return this.call('apiList'); }
  apiVersion(): Promise<McApiVersion> { return this.call('apiVersion'); }
  apiCapabilities(): Promise<McApiCapabilities> { return this.call('apiCapabilities'); }
  runSequence(steps: readonly { method: string; params?: unknown }[]): Promise<readonly unknown[]> { return this.call('runSequence', steps); }
  async waitFor<T>(probe: () => Promise<T>, predicate: (value: T) => boolean, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const intervalMs = Math.max(50, options.intervalMs ?? 250);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const value = await probe();
      if (predicate(value)) return value;
      if (Date.now() >= deadline) throw new Error(`Minecraft waitFor timed out after ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
