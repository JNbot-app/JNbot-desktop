export interface McPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly onGround?: boolean;
  readonly velocity?: McVec3;
  readonly dimension?: string;
}

export type McVec3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type McBlockPos = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type McChatKind = 'chat' | 'game' | 'actionbar';

export type McChatEvent = {
  readonly message: string;
  readonly kind: McChatKind;
  readonly ts: number;
};

export type McPositionEvent = McPosition & {
  readonly ts: number;
};

export type McWindowOpenEvent = {
  readonly syncId: number;
  readonly screenClass?: string;
  readonly title?: string;
  readonly ts: number;
};

export type McWindowCloseEvent = {
  readonly syncId: number;
  readonly ts: number;
};

export type McItemStack =
  | {
      readonly empty: true;
    }
  | {
      readonly empty: false;
      readonly count: number;
      readonly itemId: string;
      readonly name: string;
      readonly maxCount?: number;
      readonly damage?: number;
      readonly maxDamage?: number;
      readonly enchantingGlint?: boolean;
      readonly components?: string;
      readonly componentsTruncated?: boolean;
    };

export type McWindowSlotUpdate = {
  readonly slot: number;
  readonly stack: McItemStack;
};

export type McWindowItemsEvent = {
  readonly syncId: number;
  readonly changedSlots: readonly McWindowSlotUpdate[];
  readonly cursorStack: McItemStack | null;
  readonly ts: number;
};

export type McForcedTeleportEvent = {
  readonly from: McVec3;
  readonly to: McVec3;
  readonly dist: number;
  readonly ts: number;
};

export interface McHealth {
  readonly health: number;
  readonly maxHealth: number;
  readonly food?: number;
  readonly saturation?: number;
  readonly air?: number;
  readonly armor?: number;
}

export interface McExperience {
  readonly level: number;
  readonly progress: number;
  readonly total: number;
}

export interface McStatusEffect {
  readonly id: string;
  readonly amplifier: number;
  readonly duration: number;
  readonly ambient: boolean;
  readonly showParticles: boolean;
}

export interface McHeldItems {
  readonly mainHand: McItemStack;
  readonly offHand: McItemStack;
  readonly selectedHotbarSlot?: number;
}

export interface McInventoryItem {
  readonly slot: number;
  readonly count: number;
  readonly itemId: string;
  readonly name: string;
  readonly damage?: number;
}

export interface McInventorySnapshot {
  readonly items: readonly McInventoryItem[];
  readonly size: number;
  readonly selectedHotbarSlot?: number;
}

export interface McWindowInfo {
  readonly syncId: number;
  readonly inventory?: boolean;
  readonly type?: string;
  readonly title?: string;
  readonly screenClass?: string;
  readonly selectedHotbarSlot?: number;
  readonly cursorStack?: unknown;
  readonly slots?: readonly unknown[];
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
}

export interface McEntityInfo {
  readonly id: number;
  readonly type: string;
  readonly name: string;
  readonly uuid?: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw?: number;
  readonly pitch?: number;
  readonly isAlive?: boolean;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly distance?: number;
  readonly hostile?: boolean;
  readonly onGround?: boolean;
  readonly sneaking?: boolean;
  readonly sprinting?: boolean;
  readonly onFire?: boolean;
  readonly vehicle?: boolean;
  readonly equipment?: readonly (McItemStack & { readonly slot?: string })[];
  /** synced numbers and flags that differ from the entity's defaults, named as minecraft-data does (`wool`, `baby`), `#index` when the game's names are obfuscated */
  readonly data?: Readonly<Record<string, number | boolean>>;
}

export interface McEntityFilter {
  readonly type?: string;
  readonly name?: string;
  readonly radius?: number;
  readonly limit?: number;
  readonly hostile?: boolean;
}

export interface McNearbyEntitiesResult {
  readonly radius: number;
  readonly entities: readonly McEntityInfo[];
}

export interface McOnlinePlayersResult {
  readonly players: readonly McEntityInfo[];
}

export type McMovementState = {
  readonly forward?: boolean;
  readonly back?: boolean;
  readonly left?: boolean;
  readonly right?: boolean;
  readonly jump?: boolean;
  readonly sneak?: boolean;
  readonly sprint?: boolean;
};

export type McLookMode = 'absolute' | 'delta';
export type McLookEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export type McPathfinderMovement = 'auto' | 'walk' | 'fly';

export interface McSmoothLookOptions {
  readonly durationMs?: number;
  readonly easing?: McLookEasing;
  readonly taskId?: string;
}

export interface McTaskStartResult {
  readonly ok: boolean;
  readonly taskId?: string;
  readonly type?: string;
  readonly reason?: string;
}

export interface McSmoothLookStatus {
  readonly active: boolean;
  readonly taskId?: string;
  readonly durationMs?: number;
  readonly elapsedMs?: number;
}

export interface McNavigationOptions {
  readonly maxNodes?: number;
  readonly maxRange?: number;
  readonly sprint?: boolean;
  readonly arriveRadius?: number;
  readonly movement?: McPathfinderMovement;
  readonly taskId?: string;
}

export interface McMiningOptions {
  readonly matching?: string | readonly string[];
  readonly maxBlocks?: number;
  readonly maxDistance?: number;
  readonly reach?: number;
  readonly maxRange?: number;
  readonly autoTool?: boolean;
  readonly sprint?: boolean;
  readonly movement?: McPathfinderMovement;
  readonly blockTimeoutMs?: number;
  readonly taskId?: string;
}

export interface McMiningStatus {
  readonly active: boolean;
  readonly taskId?: string;
  readonly type?: 'block' | 'nearest' | 'vein';
  readonly phase?: string;
  readonly mined?: number;
  readonly skipped?: number;
  readonly queued?: number;
  readonly current?: McBlockPos;
}

export type McKey =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sneak'
  | 'sprint'
  | 'attack'
  | 'use';

export type McBlockFace = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
export type McHand = 'main' | 'off';

export interface McBlockInfo {
  readonly position: McBlockPos;
  readonly blockId: string;
  readonly name: string;
  readonly empty: boolean;
  readonly isAir: boolean;
  readonly isLiquid: boolean;
  readonly isSolid: boolean;
  readonly hardness: number;
  readonly luminance: number;
  readonly state?: Record<string, string>;
  readonly face?: McBlockFace;
  readonly hitPos?: McVec3;
}

export interface McFindBlocksResult {
  readonly blocks: readonly McBlockInfo[];
  readonly scannedRadius: number;
  readonly total: number;
}

export interface McScanResult {
  readonly blocks: readonly McBlockInfo[];
  readonly total: number;
  readonly volume: number;
}

/** every block of a box: the distinct blocks, and runs of [palette index, count] in y, then z, then x order */
export interface McBlockCube {
  readonly palette: readonly {
    readonly blockId: string;
    readonly isSolid: boolean;
    readonly isLiquid: boolean;
    readonly state?: Readonly<Record<string, string>>;
  }[];
  readonly runs: readonly number[];
}

export interface McColumnInfo {
  readonly x: number;
  readonly z: number;
  readonly worldSurfaceY: number;
  readonly motionBlockingY: number;
  readonly topBlockId?: string;
}

export interface McBiomeInfo {
  readonly id: string;
  readonly temperature: number;
  readonly hasPrecipitation: boolean;
}

export interface McLightInfo {
  readonly block: number;
  readonly sky: number;
  readonly total: number;
}

export interface McWorldInfo {
  readonly dimension: string;
  readonly time: number;
  readonly timeOfDay: number;
  readonly raining: boolean;
  readonly thundering: boolean;
  readonly difficulty?: string;
  readonly ambientDarkness?: number;
}

export interface McWindowGeometry {
  readonly width: number;
  readonly height: number;
  readonly scaledWidth: number;
  readonly scaledHeight: number;
  readonly framebufferWidth: number;
  readonly framebufferHeight: number;
  readonly fullscreen: boolean;
  readonly scaleFactor: number;
  readonly fps?: number;
}

export interface McSignText {
  readonly front: readonly string[];
  readonly back: readonly string[];
}

export interface McPathfinderGotoResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly searchMs: number;
  readonly visited: number;
  readonly pathLength?: number;
  readonly etaMs?: number;
  readonly start?: McBlockPos;
  readonly end?: McBlockPos;
  readonly taskId?: string;
  readonly movement?: 'walk' | 'fly';
}

export interface McPathfinderStatus {
  readonly active: boolean;
  readonly index: number;
  readonly pathLength: number;
  readonly taskId?: string;
  readonly movement: 'walk' | 'fly';
}

export interface McPlayerState {
  readonly username: string;
  readonly uuid: string;
  readonly onGround: boolean;
  readonly onFire: boolean;
  readonly swimming: boolean;
  readonly sneaking: boolean;
  readonly sprinting: boolean;
  readonly gliding: boolean;
  readonly flying: boolean;
  readonly usingItem: boolean;
  readonly sleeping: boolean;
  readonly hasVehicle: boolean;
  readonly air: number;
  readonly fallDistance: number;
  readonly gameMode?: string;
  readonly vehicleId?: number;
}

export type McUiElement =
  | { readonly type: 'label'; readonly id?: string; readonly label: string }
  | { readonly type: 'toggle'; readonly id: string; readonly label: string; readonly value?: boolean }
  | { readonly type: 'button'; readonly id: string; readonly label: string };

export interface McUiDefinition {
  readonly id: string;
  readonly title: string;
  readonly elements: readonly McUiElement[];
}

export interface McUiActionEvent {
  readonly uiId: string;
  readonly elementId: string;
  readonly action: 'click' | 'change' | 'close';
  readonly value: boolean;
  readonly ts: number;
}

export interface McBlockChangedEvent {
  readonly watchId: string;
  readonly changes: readonly McBlockInfo[];
  readonly ts: number;
}

export interface McPlayerStateEvent {
  readonly onFire: boolean;
  readonly usingItem: boolean;
  readonly swimming: boolean;
  readonly gliding: boolean;
  readonly air: number;
  readonly ts: number;
}

export interface McDimensionChangedEvent {
  readonly from: string;
  readonly to: string;
  readonly ts: number;
}

export interface McApiList {
  readonly methods: readonly string[];
  readonly count: number;
}

export interface McApiVersion {
  readonly protocolVersion: number;
  readonly modVersion: string;
  readonly mcVersion?: string;
}

export interface McApiCapabilities extends McApiList {
  readonly events: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly binaryTransport: boolean;
  readonly taskCancellation: boolean;
  readonly declarativeUi: boolean;
  readonly flightPathfinding: boolean;
  readonly miningAutomation: boolean;
  readonly smoothLook: boolean;
}

// ---- Event payloads added in this revision ----

export type McHealthChangedEvent = {
  readonly health: number;
  readonly maxHealth: number;
  readonly food: number;
  readonly ts: number;
};

export type McDeathEvent = { readonly ts: number };
export type McRespawnEvent = { readonly ts: number };
export type McKickedEvent = { readonly reason: string; readonly ts: number };
export type McPathfinderArrivedEvent = { readonly durationMs: number; readonly nodes: number; readonly taskId?: string; readonly ts: number };
export type McPathfinderFailedEvent = { readonly reason: string; readonly taskId?: string; readonly ts: number };
export type McEntitySpawnedEvent = { readonly entities: readonly McEntityInfo[]; readonly ts: number };
export type McEntityDiedEvent = { readonly ids: readonly number[]; readonly ts: number };
export type McEntityDespawnedEvent = { readonly ids: readonly number[]; readonly ts: number };
export type McTaskEvent = {
  readonly taskId: string;
  readonly type: string;
  readonly reason?: string;
  readonly mined?: number;
  readonly skipped?: number;
  readonly ts: number;
};


/** Player input captured by the client: `move` (per tick, held keys), `attackEntity`, `useItem`, … */
export type McCaptureAction = {
  readonly kind: string;
  readonly ts?: number;
  readonly [key: string]: unknown;
};

export type McClientEventPayloads = {
  readonly 'mc.chat': McChatEvent;
  readonly 'mc.position': McPositionEvent;
  readonly 'mc.window.open': McWindowOpenEvent;
  readonly 'mc.window.close': McWindowCloseEvent;
  readonly 'mc.window.items': McWindowItemsEvent;
  readonly 'mc.player.forcedTeleport': McForcedTeleportEvent;
  readonly 'mc.health.changed': McHealthChangedEvent;
  readonly 'mc.death': McDeathEvent;
  readonly 'mc.respawn': McRespawnEvent;
  readonly 'mc.kicked': McKickedEvent;
  readonly 'mc.pathfinder.arrived': McPathfinderArrivedEvent;
  readonly 'mc.pathfinder.failed': McPathfinderFailedEvent;
  readonly 'mc.entity.spawned': McEntitySpawnedEvent;
  readonly 'mc.entity.died': McEntityDiedEvent;
  readonly 'mc.entity.despawned': McEntityDespawnedEvent;
  readonly 'mc.player.stateChanged': McPlayerStateEvent;
  readonly 'mc.player.heldItemChanged': McHeldItems & { readonly ts: number };
  readonly 'mc.player.effectsChanged': { readonly effects: readonly McStatusEffect[]; readonly ts: number };
  readonly 'mc.dimension.changed': McDimensionChangedEvent;
  readonly 'mc.block.changed': McBlockChangedEvent;
  readonly 'mc.ui.action': McUiActionEvent;
  readonly 'mc.task.completed': McTaskEvent;
  readonly 'mc.task.failed': McTaskEvent;
  readonly 'mc.automation.action': McCaptureAction;
};

export type WorkerMcClientEventName =
  | 'move'
  | 'chat'
  | 'windowOpen'
  | 'windowClose'
  | 'updateSlot'
  | 'forceMove'
  | 'healthChanged'
  | 'death'
  | 'respawn'
  | 'kicked'
  | 'pathArrived'
  | 'pathFailed'
  | 'entitySpawned'
  | 'entityDied'
  | 'entityDespawned'
  | 'playerStateChanged'
  | 'heldItemChanged'
  | 'effectsChanged'
  | 'dimensionChanged'
  | 'blockChanged'
  | 'uiAction'
  | 'taskCompleted'
  | 'taskFailed'
  | 'input';

export type WorkerMcClientEventPayloads = {
  readonly move: McPositionEvent;
  readonly chat: McChatEvent;
  readonly windowOpen: McWindowOpenEvent;
  readonly windowClose: McWindowCloseEvent;
  readonly updateSlot: McWindowItemsEvent;
  readonly forceMove: McForcedTeleportEvent;
  readonly healthChanged: McHealthChangedEvent;
  readonly death: McDeathEvent;
  readonly respawn: McRespawnEvent;
  readonly kicked: McKickedEvent;
  readonly pathArrived: McPathfinderArrivedEvent;
  readonly pathFailed: McPathfinderFailedEvent;
  readonly entitySpawned: McEntitySpawnedEvent;
  readonly entityDied: McEntityDiedEvent;
  readonly entityDespawned: McEntityDespawnedEvent;
  readonly playerStateChanged: McPlayerStateEvent;
  readonly heldItemChanged: McHeldItems & { readonly ts: number };
  readonly effectsChanged: { readonly effects: readonly McStatusEffect[]; readonly ts: number };
  readonly dimensionChanged: McDimensionChangedEvent;
  readonly blockChanged: McBlockChangedEvent;
  readonly uiAction: McUiActionEvent;
  readonly taskCompleted: McTaskEvent;
  readonly taskFailed: McTaskEvent;
  /** per-tick player input; only streamed while a capture (task recording or brain recording) runs */
  readonly input: McCaptureAction;
};


export interface IMcClient {
  readonly id: string;

  // Chat / input
  chat(message: string): Promise<void>;
  setMovement(state: McMovementState): Promise<void>;
  setKey(params: { key: McKey; pressed: boolean }): Promise<void>;
  look(params: { yaw: number; pitch: number; mode?: McLookMode }): Promise<void>;
  smoothLook(params: { yaw: number; pitch: number; mode?: McLookMode } & McSmoothLookOptions): Promise<McTaskStartResult & { durationMs?: number }>;
  smoothLookAt(params: McVec3 & McSmoothLookOptions): Promise<McTaskStartResult & { durationMs?: number }>;
  stopSmoothLook(taskId?: string): Promise<{ ok: boolean; reason?: string }>;
  smoothLookStatus(): Promise<McSmoothLookStatus>;
  click(button?: 'left' | 'right'): Promise<void>;

  // Inventory windows
  clickSlot(params: { slot: number; button?: number; actionType?: string; syncId?: number }): Promise<void>;
  closeWindow(): Promise<void>;
  setHotbarSlot(slot: number): Promise<void>;
  getInventory(): Promise<McInventorySnapshot>;
  getCurrentWindow(): Promise<McWindowInfo | null>;
  findInventoryItems(params: { matching: string; limit?: number }): Promise<{ items: readonly (McItemStack & { readonly slot: number })[]; totalCount: number; matchedSlots: number }>;
  countInventoryItem(matching: string): Promise<number>;
  moveInventorySlot(params: { from: number; to: number }): Promise<{ ok: boolean; affected: number; reason?: string }>;
  swapInventorySlots(params: { from: number; to: number }): Promise<{ ok: boolean; affected: number; reason?: string }>;
  quickMoveInventorySlot(slot: number): Promise<{ ok: boolean; affected: number; reason?: string }>;
  transferInventory(params: { from: 'player' | 'container'; matching?: string; limit?: number }): Promise<{ ok: boolean; affected: number; reason?: string }>;

  // Player info
  getCurrentPosition(): Promise<McPosition>;
  getHealth(): Promise<McHealth>;
  getExperience(): Promise<McExperience>;
  getHeldItems(): Promise<McHeldItems>;
  getStatusEffects(): Promise<{ effects: readonly McStatusEffect[] }>;
  getPlayerState(): Promise<McPlayerState>;

  // Player actions
  swingArm(params?: { hand?: McHand }): Promise<void>;
  dropItem(params?: { entireStack?: boolean }): Promise<void>;
  dig(params: McBlockPos & { face?: McBlockFace }): Promise<{ ok: boolean; instant?: boolean; reason?: string }>;
  stopDig(): Promise<void>;
  placeBlock(params: McBlockPos & { face?: McBlockFace; hand?: McHand }): Promise<{ ok: boolean }>;
  activateBlock(params: McBlockPos & { face?: McBlockFace; hand?: McHand }): Promise<{ ok: boolean }>;
  useOnLooked(params?: { maxDistance?: number }): Promise<{ ok: boolean; reason?: string; block?: McBlockPos }>;
  equip(params: { itemId?: string; slot?: number; destination: 'hand' | 'off-hand' | 'head' | 'chest' | 'legs' | 'feet' | 'hotbar' }): Promise<{ ok: boolean; reason?: string; destinationSlot?: number }>;
  sleep(): Promise<{ ok: boolean }>;
  wake(): Promise<{ ok: boolean }>;
  lookAt(params: McVec3): Promise<{ ok: boolean; reason?: string }>;
  useItem(params?: { hand?: McHand }): Promise<{ ok: boolean; reason?: string }>;
  releaseUseItem(): Promise<{ ok: boolean; reason?: string }>;
  swapHands(): Promise<{ ok: boolean; reason?: string }>;
  respawn(): Promise<{ ok: boolean; reason?: string }>;

  // Entities
  attackEntity(params: { id: number }): Promise<{ ok: boolean; reason?: string }>;
  useEntity(params: { id: number; hand?: McHand }): Promise<{ ok: boolean; reason?: string }>;
  getEntityById(params: { id: number }): Promise<McEntityInfo | null>;
  findEntities(params?: McEntityFilter): Promise<{ entities: readonly McEntityInfo[]; total: number }>;
  nearestEntity(params?: Omit<McEntityFilter, 'limit'>): Promise<McEntityInfo | null>;
  lookAtEntity(id: number): Promise<{ ok: boolean; reason?: string }>;
  followEntity(params: { id: number; distance?: number; sprint?: boolean; taskId?: string }): Promise<{ ok: boolean; taskId?: string; reason?: string }>;
  attackEntityUntilDead(params: { id: number; distance?: number; sprint?: boolean; taskId?: string }): Promise<{ ok: boolean; taskId?: string; reason?: string }>;
  stopTask(taskId?: string): Promise<{ ok: boolean; reason?: string }>;
  taskStatus(): Promise<{ active: boolean; taskId?: string; type?: string; entityId?: number }>;

  // World / blocks
  getNearbyEntities(params?: { radius?: number; limit?: number; includePlayers?: boolean; type?: string }): Promise<McNearbyEntitiesResult>;
  getOnlinePlayers(): Promise<McOnlinePlayersResult>;
  getBlockAt(params: McBlockPos): Promise<McBlockInfo>;
  blockAtCursor(params?: { maxDistance?: number }): Promise<McBlockInfo | null>;
  raycast(params?: { maxDistance?: number }): Promise<McBlockInfo | null>;
  findBlock(params: { matching: string | readonly string[]; maxDistance?: number; useExtraInfo?: boolean }): Promise<McBlockInfo | null>;
  findBlocks(params: { matching: string | readonly string[]; maxDistance?: number; count?: number; useExtraInfo?: boolean }): Promise<McFindBlocksResult>;
  /** non-air blocks in a box; `details` adds isSolid, isLiquid and state (properties) to each */
  scanBox(params: { from: McBlockPos; to: McBlockPos; matching?: string | readonly string[]; count?: number; details?: boolean }): Promise<McScanResult>;
  /** every block of a box (at most 262,144), compact */
  getBlockCube(params: { from: McBlockPos; to: McBlockPos }): Promise<McBlockCube>;
  getColumn(params: { x: number; z: number }): Promise<McColumnInfo>;
  getBiome(params: McBlockPos): Promise<McBiomeInfo>;
  getLight(params: McBlockPos): Promise<McLightInfo>;
  getWorldInfo(): Promise<McWorldInfo>;
  getSignText(params: McBlockPos): Promise<McSignText | null>;
  watchBlocks(params: { id?: string; from: McBlockPos; to: McBlockPos; intervalMs?: number }): Promise<{ ok: boolean; id?: string; volume?: number; reason?: string }>;
  unwatchBlocks(id: string): Promise<{ ok: boolean }>;
  clearBlockWatches(): Promise<{ ok: boolean; affected: number }>;

  // Mining automation
  mineBlock(params: McBlockPos & Omit<McMiningOptions, 'matching' | 'maxBlocks'>): Promise<McTaskStartResult>;
  mineNearest(params: McMiningOptions & { matching: string | readonly string[] }): Promise<McTaskStartResult>;
  veinMine(params: McBlockPos & McMiningOptions & { diagonal?: boolean }): Promise<McTaskStartResult>;
  stopMining(taskId?: string): Promise<{ ok: boolean; reason?: string }>;
  miningStatus(): Promise<McMiningStatus>;

  // Pathfinder
  goto(params: McBlockPos & McNavigationOptions): Promise<McPathfinderGotoResult>;
  gotoEntity(params: { id: number } & McNavigationOptions): Promise<McPathfinderGotoResult>;
  gotoBlock(params: { matching: string | readonly string[]; maxDistance?: number } & McNavigationOptions): Promise<McPathfinderGotoResult>;
  flee(params: { x: number; z: number; distance?: number } & Pick<McNavigationOptions, 'sprint' | 'movement' | 'maxNodes' | 'maxRange' | 'taskId'>): Promise<McPathfinderGotoResult>;
  stopPath(taskId?: string): Promise<void>;
  pathStatus(): Promise<McPathfinderStatus>;

  // Game window
  getWindowInfo(): Promise<McWindowGeometry>;
  setWindowTitle(params: { title: string }): Promise<void>;
  setFullscreen(params?: { fullscreen?: boolean }): Promise<void>;

  // HUD / OS
  toast(params: { title: string; body?: string; kind?: 'info' | 'ok' | 'warn' | 'error'; durationMs?: number }): Promise<{ ok: boolean }>;
  clearToasts(): Promise<void>;
  /** a world label; with entityId it follows that entity */
  marker(params: { id?: string; x: number; y: number; z: number; label?: string; color?: string; ttlMs?: number; entityId?: number }): Promise<{ id: string }>;
  removeMarker(params: { id: string }): Promise<void>;
  clearMarkers(): Promise<void>;
  beep(params?: { sound?: string; volume?: number; pitch?: number }): Promise<{ ok: boolean }>;
  flashWindow(): Promise<{ ok: boolean }>;

  // Declarative Minecraft UI
  openUi(definition: McUiDefinition): Promise<{ ok: boolean; id: string }>;
  closeUi(id?: string): Promise<{ ok: boolean }>;

  // Diagnostics
  apiList(): Promise<McApiList>;
  apiVersion(): Promise<McApiVersion>;
  apiCapabilities(): Promise<McApiCapabilities>;

  // Ergonomic orchestration helpers
  runSequence(steps: readonly { method: string; params?: unknown }[]): Promise<readonly unknown[]>;
  waitFor<T>(probe: () => Promise<T>, predicate: (value: T) => boolean, options?: { timeoutMs?: number; intervalMs?: number }): Promise<T>;

  // Escape hatch — call any websocket method by name
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  request<T = unknown>(envelope: { method: string; params?: unknown }): Promise<T>;

  // Events
  on<E extends WorkerMcClientEventName>(
    event: E,
    handler: (data: WorkerMcClientEventPayloads[E]) => void,
  ): Promise<() => void>;
}
