import type JnbotMcBridgeServer from './JnbotMcBridgeServer';
import type {
  IMcClient,
  McApiList,
  McApiCapabilities,
  McApiVersion,
  McBiomeInfo,
  McBlockFace,
  McBlockInfo,
  McBlockPos,
  McColumnInfo,
  McEntityInfo,
  McEntityFilter,
  McExperience,
  McFindBlocksResult,
  McHand,
  McHealth,
  McHeldItems,
  McInventorySnapshot,
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
  McItemStack,
  McVec3,
  WorkerMcClientEventName,
  WorkerMcClientEventPayloads,
} from '../../../../../common/types/McClientApi';

/**
 * Main-process implementation of the Minecraft client handle. Each method
 * maps to a websocket method name on the Fabric mod. New methods should
 * prefer typed wrappers, but `request()` is exposed as an escape hatch for
 * anything the JS side hasn't caught up with yet.
 */
export default class McClient implements IMcClient {
  private readonly server: JnbotMcBridgeServer;
  readonly id: string;

  constructor(server: JnbotMcBridgeServer, clientId: string) {
    this.server = server;
    this.id = clientId;
  }

  /**
   * Send any raw method to the mod over the websocket. Useful for invoking
   * APIs that aren't yet wrapped in a typed method here. Accepts both
   *   request('mc.foo', { ... })  and
   *   request({ method: 'mc.foo', params: { ... } })
   * so it works from both the main process and the worker bridge.
   */
  request<T = unknown>(
    methodOrEnvelope: string | { method: string; params?: unknown },
    params?: unknown,
  ): Promise<T> {
    if (typeof methodOrEnvelope === 'string') {
      return this.server.sendRequest<T>(this.id, methodOrEnvelope, params);
    }
    return this.server.sendRequest<T>(
      this.id,
      methodOrEnvelope.method,
      methodOrEnvelope.params,
    );
  }

  // ---- Input ----

  chat(message: string): Promise<void> {
    return this.request<void>('mc.chat', { message }).then(() => undefined);
  }

  setMovement(state: McMovementState): Promise<void> {
    return this.request<void>('mc.input.setMovement', state).then(
      () => undefined,
    );
  }

  setKey(options: { key: McKey; pressed: boolean }): Promise<void> {
    return this.request<void>('mc.input.setKey', options).then(() => undefined);
  }

  look(params: {
    yaw: number;
    pitch: number;
    mode?: McLookMode;
  }): Promise<void> {
    return this.request<void>('mc.input.look', {
      mode: params.mode ?? 'absolute',
      yaw: params.yaw,
      pitch: params.pitch,
    }).then(() => undefined);
  }

  smoothLook(
    params: {
      yaw: number;
      pitch: number;
      mode?: McLookMode;
    } & McSmoothLookOptions,
  ): Promise<McTaskStartResult & { durationMs?: number }> {
    return this.request('mc.input.smoothLook', params);
  }

  smoothLookAt(
    params: McVec3 & McSmoothLookOptions,
  ): Promise<McTaskStartResult & { durationMs?: number }> {
    return this.request('mc.input.smoothLookAt', params);
  }

  stopSmoothLook(taskId?: string): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.input.stopSmoothLook', taskId ? { taskId } : {});
  }

  smoothLookStatus(): Promise<McSmoothLookStatus> {
    return this.request('mc.input.smoothLookStatus');
  }

  click(button: 'left' | 'right' = 'left'): Promise<void> {
    return this.request<void>('mc.input.click', { button }).then(
      () => undefined,
    );
  }

  // ---- Inventory windows ----

  clickSlot(params: {
    slot: number;
    button?: number;
    actionType?: string;
    syncId?: number;
  }): Promise<void> {
    return this.request<void>('mc.inventory.clickSlot', params).then(
      () => undefined,
    );
  }

  closeWindow(): Promise<void> {
    return this.request<void>('mc.inventory.closeWindow').then(() => undefined);
  }

  setHotbarSlot(slot: number): Promise<void> {
    return this.request<void>('mc.inventory.setHotbarSlot', { slot }).then(
      () => undefined,
    );
  }

  getInventory(): Promise<McInventorySnapshot> {
    return this.request<McInventorySnapshot>('mc.inventory.getItems');
  }

  getCurrentWindow(): Promise<McWindowInfo | null> {
    return this.request<McWindowInfo | null>('mc.getCurrentWindow');
  }

  findInventoryItems(params: {
    matching: string;
    limit?: number;
  }): Promise<{
    items: readonly (McItemStack & { readonly slot: number })[];
    totalCount: number;
    matchedSlots: number;
  }> {
    return this.request('mc.inventory.find', params);
  }

  async countInventoryItem(matching: string): Promise<number> {
    const result = await this.request<{ count: number }>('mc.inventory.count', {
      matching,
    });
    return result.count;
  }

  moveInventorySlot(params: {
    from: number;
    to: number;
  }): Promise<{ ok: boolean; affected: number; reason?: string }> {
    return this.request('mc.inventory.move', params);
  }

  swapInventorySlots(params: {
    from: number;
    to: number;
  }): Promise<{ ok: boolean; affected: number; reason?: string }> {
    return this.request('mc.inventory.swap', params);
  }

  quickMoveInventorySlot(
    slot: number,
  ): Promise<{ ok: boolean; affected: number; reason?: string }> {
    return this.request('mc.inventory.quickMove', { slot });
  }

  transferInventory(params: {
    from: 'player' | 'container';
    matching?: string;
    limit?: number;
  }): Promise<{ ok: boolean; affected: number; reason?: string }> {
    return this.request('mc.inventory.transferMatching', params);
  }

  // ---- Player info ----

  getCurrentPosition(): Promise<McPosition> {
    return this.request<McPosition>('mc.getPosition');
  }

  getHealth(): Promise<McHealth> {
    return this.request<McHealth>('mc.getHealth');
  }

  getExperience(): Promise<McExperience> {
    return this.request<McExperience>('mc.player.experience');
  }

  getHeldItems(): Promise<McHeldItems> {
    return this.request<McHeldItems>('mc.player.heldItems');
  }

  getStatusEffects(): Promise<{ effects: readonly McStatusEffect[] }> {
    return this.request<{ effects: readonly McStatusEffect[] }>(
      'mc.player.effects',
    );
  }

  getPlayerState(): Promise<McPlayerState> {
    return this.request('mc.player.state');
  }

  // ---- Player actions ----

  swingArm(params?: { hand?: McHand }): Promise<void> {
    return this.request<void>('mc.player.swingArm', params ?? {}).then(
      () => undefined,
    );
  }

  dropItem(params?: { entireStack?: boolean }): Promise<void> {
    return this.request<void>('mc.player.dropItem', params ?? {}).then(
      () => undefined,
    );
  }

  dig(
    params: McBlockPos & { face?: McBlockFace },
  ): Promise<{ ok: boolean; instant?: boolean; reason?: string }> {
    return this.request('mc.player.dig', params);
  }

  stopDig(): Promise<void> {
    return this.request<void>('mc.player.stopDig').then(() => undefined);
  }

  placeBlock(
    params: McBlockPos & { face?: McBlockFace; hand?: McHand },
  ): Promise<{ ok: boolean }> {
    return this.request('mc.player.placeBlock', params);
  }

  activateBlock(
    params: McBlockPos & { face?: McBlockFace; hand?: McHand },
  ): Promise<{ ok: boolean }> {
    return this.request('mc.player.activateBlock', params);
  }

  useOnLooked(params?: {
    maxDistance?: number;
  }): Promise<{ ok: boolean; reason?: string; block?: McBlockPos }> {
    return this.request('mc.player.useOnLooked', params ?? {});
  }

  equip(params: {
    itemId?: string;
    slot?: number;
    destination:
      | 'hand'
      | 'off-hand'
      | 'head'
      | 'chest'
      | 'legs'
      | 'feet'
      | 'hotbar';
  }): Promise<{ ok: boolean; reason?: string; destinationSlot?: number }> {
    return this.request('mc.player.equip', params);
  }

  sleep(): Promise<{ ok: boolean }> {
    return this.request('mc.player.sleep');
  }

  wake(): Promise<{ ok: boolean }> {
    return this.request('mc.player.wake');
  }

  lookAt(params: McVec3): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.player.lookAt', params);
  }

  useItem(params?: {
    hand?: McHand;
  }): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.player.useItem', params ?? {});
  }

  releaseUseItem(): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.player.releaseUseItem');
  }

  swapHands(): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.player.swapHands');
  }

  respawn(): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.player.respawn');
  }

  // ---- Entities ----

  attackEntity(params: {
    id: number;
  }): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.entity.attack', params);
  }

  useEntity(params: {
    id: number;
    hand?: McHand;
  }): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.entity.use', params);
  }

  getEntityById(params: { id: number }): Promise<McEntityInfo | null> {
    return this.request<McEntityInfo | null>('mc.entity.getById', params);
  }

  findEntities(
    params: McEntityFilter = {},
  ): Promise<{ entities: readonly McEntityInfo[]; total: number }> {
    return this.request('mc.entity.find', params);
  }

  nearestEntity(
    params: Omit<McEntityFilter, 'limit'> = {},
  ): Promise<McEntityInfo | null> {
    return this.request('mc.entity.nearest', params);
  }

  lookAtEntity(id: number): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.entity.lookAt', { id });
  }

  followEntity(params: {
    id: number;
    distance?: number;
    sprint?: boolean;
    taskId?: string;
  }): Promise<{ ok: boolean; taskId?: string; reason?: string }> {
    return this.request('mc.entity.follow', params);
  }

  attackEntityUntilDead(params: {
    id: number;
    distance?: number;
    sprint?: boolean;
    taskId?: string;
  }): Promise<{ ok: boolean; taskId?: string; reason?: string }> {
    return this.request('mc.entity.attackUntilDead', params);
  }

  stopTask(taskId?: string): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.task.stop', taskId ? { taskId } : {});
  }

  taskStatus(): Promise<{
    active: boolean;
    taskId?: string;
    type?: string;
    entityId?: number;
  }> {
    return this.request('mc.task.status');
  }

  // ---- World / blocks ----

  getNearbyEntities(params?: {
    radius?: number;
    limit?: number;
    includePlayers?: boolean;
    type?: string;
  }): Promise<McNearbyEntitiesResult> {
    return this.request<McNearbyEntitiesResult>(
      'mc.getNearbyEntities',
      params ?? {},
    );
  }

  getOnlinePlayers(): Promise<McOnlinePlayersResult> {
    return this.request<McOnlinePlayersResult>('mc.getOnlinePlayers');
  }

  getBlockAt(params: McBlockPos): Promise<McBlockInfo> {
    return this.request<McBlockInfo>('mc.world.blockAt', params);
  }

  blockAtCursor(params?: {
    maxDistance?: number;
  }): Promise<McBlockInfo | null> {
    return this.request<McBlockInfo | null>(
      'mc.world.blockAtCursor',
      params ?? {},
    );
  }

  raycast(params?: { maxDistance?: number }): Promise<McBlockInfo | null> {
    return this.request<McBlockInfo | null>('mc.world.raycast', params ?? {});
  }

  findBlock(params: {
    matching: string | readonly string[];
    maxDistance?: number;
    useExtraInfo?: boolean;
  }): Promise<McBlockInfo | null> {
    return this.request<McBlockInfo | null>('mc.world.findBlock', params);
  }

  findBlocks(params: {
    matching: string | readonly string[];
    maxDistance?: number;
    count?: number;
    useExtraInfo?: boolean;
  }): Promise<McFindBlocksResult> {
    return this.request<McFindBlocksResult>('mc.world.findBlocks', params);
  }

  scanBox(params: {
    from: McBlockPos;
    to: McBlockPos;
    matching?: string | readonly string[];
    count?: number;
    details?: boolean;
  }): Promise<McScanResult> {
    return this.request<McScanResult>('mc.world.scan', params);
  }

  getBlockCube(params: { from: McBlockPos; to: McBlockPos }): Promise<McBlockCube> {
    return this.request<McBlockCube>('mc.world.cube', params);
  }

  getColumn(params: { x: number; z: number }): Promise<McColumnInfo> {
    return this.request<McColumnInfo>('mc.world.column', params);
  }

  getBiome(params: McBlockPos): Promise<McBiomeInfo> {
    return this.request<McBiomeInfo>('mc.world.biome', params);
  }

  getLight(params: McBlockPos): Promise<McLightInfo> {
    return this.request<McLightInfo>('mc.world.light', params);
  }

  getWorldInfo(): Promise<McWorldInfo> {
    return this.request<McWorldInfo>('mc.world.info');
  }

  getSignText(params: McBlockPos): Promise<McSignText | null> {
    return this.request<McSignText | null>('mc.world.signText', params);
  }

  watchBlocks(params: {
    id?: string;
    from: McBlockPos;
    to: McBlockPos;
    intervalMs?: number;
  }): Promise<{ ok: boolean; id?: string; volume?: number; reason?: string }> {
    return this.request('mc.world.watch', params);
  }

  unwatchBlocks(id: string): Promise<{ ok: boolean }> {
    return this.request('mc.world.unwatch', { id });
  }

  clearBlockWatches(): Promise<{ ok: boolean; affected: number }> {
    return this.request('mc.world.clearWatches');
  }

  // ---- Mining automation ----

  mineBlock(
    params: McBlockPos & Omit<McMiningOptions, 'matching' | 'maxBlocks'>,
  ): Promise<McTaskStartResult> {
    return this.request('mc.mining.mineBlock', params);
  }

  mineNearest(
    params: McMiningOptions & { matching: string | readonly string[] },
  ): Promise<McTaskStartResult> {
    return this.request('mc.mining.mineNearest', params);
  }

  veinMine(
    params: McBlockPos & McMiningOptions & { diagonal?: boolean },
  ): Promise<McTaskStartResult> {
    return this.request('mc.mining.veinMine', params);
  }

  stopMining(taskId?: string): Promise<{ ok: boolean; reason?: string }> {
    return this.request('mc.mining.stop', taskId ? { taskId } : {});
  }

  miningStatus(): Promise<McMiningStatus> {
    return this.request('mc.mining.status');
  }

  // ---- Pathfinder ----

  goto(
    params: McBlockPos & McNavigationOptions,
  ): Promise<McPathfinderGotoResult> {
    return this.request<McPathfinderGotoResult>('mc.pathfinder.goto', params);
  }

  gotoEntity(
    params: { id: number } & McNavigationOptions,
  ): Promise<McPathfinderGotoResult> {
    return this.request('mc.pathfinder.gotoEntity', params);
  }

  gotoBlock(
    params: {
      matching: string | readonly string[];
      maxDistance?: number;
    } & McNavigationOptions,
  ): Promise<McPathfinderGotoResult> {
    return this.request('mc.pathfinder.gotoBlock', params);
  }

  flee(
    params: { x: number; z: number; distance?: number } & Pick<
      McNavigationOptions,
      'sprint' | 'movement' | 'maxNodes' | 'maxRange' | 'taskId'
    >,
  ): Promise<McPathfinderGotoResult> {
    return this.request('mc.pathfinder.flee', params);
  }

  stopPath(taskId?: string): Promise<void> {
    return this.request<void>(
      'mc.pathfinder.stop',
      taskId ? { taskId } : {},
    ).then(() => undefined);
  }

  pathStatus(): Promise<McPathfinderStatus> {
    return this.request<McPathfinderStatus>('mc.pathfinder.status');
  }

  // ---- Game window ----

  getWindowInfo(): Promise<McWindowGeometry> {
    return this.request<McWindowGeometry>('mc.window.info');
  }

  setWindowTitle(params: { title: string }): Promise<void> {
    return this.request<void>('mc.window.setTitle', params).then(
      () => undefined,
    );
  }

  setFullscreen(params?: { fullscreen?: boolean }): Promise<void> {
    return this.request<void>('mc.window.setFullscreen', params ?? {}).then(
      () => undefined,
    );
  }

  // ---- HUD / OS ----

  toast(params: {
    title: string;
    body?: string;
    kind?: 'info' | 'ok' | 'warn' | 'error';
    durationMs?: number;
  }): Promise<{ ok: boolean }> {
    return this.request('mc.hud.toast', params);
  }

  clearToasts(): Promise<void> {
    return this.request<void>('mc.hud.clearToasts').then(() => undefined);
  }

  marker(params: {
    id?: string;
    x: number;
    y: number;
    z: number;
    label?: string;
    color?: string;
    ttlMs?: number;
    entityId?: number;
  }): Promise<{ id: string }> {
    return this.request('mc.hud.marker', params);
  }

  removeMarker(params: { id: string }): Promise<void> {
    return this.request<void>('mc.hud.removeMarker', params).then(
      () => undefined,
    );
  }

  clearMarkers(): Promise<void> {
    return this.request<void>('mc.hud.clearMarkers').then(() => undefined);
  }

  beep(params?: {
    sound?: string;
    volume?: number;
    pitch?: number;
  }): Promise<{ ok: boolean }> {
    return this.request('mc.audio.beep', params ?? {});
  }

  flashWindow(): Promise<{ ok: boolean }> {
    return this.request('mc.window.flash');
  }

  openUi(definition: McUiDefinition): Promise<{ ok: boolean; id: string }> {
    return this.request('mc.ui.open', definition);
  }

  closeUi(id?: string): Promise<{ ok: boolean }> {
    return this.request('mc.ui.close', id ? { id } : {});
  }

  // ---- Diagnostics ----

  apiList(): Promise<McApiList> {
    return this.request<McApiList>('mc.api.list');
  }

  apiVersion(): Promise<McApiVersion> {
    return this.request<McApiVersion>('mc.api.version');
  }

  apiCapabilities(): Promise<McApiCapabilities> {
    return this.request('mc.api.capabilities');
  }

  async runSequence(
    steps: readonly { method: string; params?: unknown }[],
  ): Promise<readonly unknown[]> {
    const result = await this.request<{ results: readonly unknown[] }>(
      'mc.automation.batch',
      { steps },
    );
    return result.results;
  }

  async waitFor<T>(
    probe: () => Promise<T>,
    predicate: (value: T) => boolean,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const intervalMs = Math.max(50, options.intervalMs ?? 250);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const value = await probe();
      if (predicate(value)) return value;
      if (Date.now() >= deadline)
        throw new Error(`Minecraft waitFor timed out after ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // ---- Events (implemented by WorkerMcClient on the worker side) ----

  on<E extends WorkerMcClientEventName>(
    _event: E,
    _handler: (data: WorkerMcClientEventPayloads[E]) => void,
  ): Promise<() => void> {
    throw new Error('Method not implemented.');
  }
}
