interface Vec3 {
  x: number;
  y: number;
  z: number;
  add(other: Vec3): this;
  offset(dx: number, dy: number, dz: number): Vec3;
  floored(): Vec3;
  subtract(other: Vec3): this;
  distanceTo(other: Vec3): number;
  clone(): Vec3;
}

interface Item {
  type: number;
  slot: number;
  count: number;
  metadata: number;
  nbt: object | null;
  stackId: number | null;
  name: string;
  displayName: string;
  stackSize: number;
  maxDurability: number;
  durabilityUsed: number;
  enchants: { name: string; lvl: number }[];
  blocksCanPlaceOn: string[][];
  blocksCanDestroy: string[][];
  repairCost: number;
  customName: string | null;
  customLore: string | string[] | null;
  customModel: string | null;
  readonly spawnEggMobName: string;
}

interface ChatMessage {
  text?: string;
  translate?: string;
  with?: ChatMessage[];
  extra?: ChatMessage[];
  toString(): string;
}

interface Entity {
  id: number;
  type:
    | 'player'
    | 'mob'
    | 'object'
    | 'global'
    | 'orb'
    | 'projectile'
    | 'hostile'
    | 'other';
  uuid?: string;
  username?: string;
  mobType?: string;
  displayName?: string;
  entityType?: number;
  kind?: string;
  name?: string;
  objectType?: string;
  count?: number;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  height: number;
  width: number;
  onGround: boolean;
  equipment: (Item | null)[];
  heldItem: Item | null;
  metadata: object[];
  isValid: boolean;
  health?: number;
  food?: number;
  foodSaturation?: number;
  elytraFlying?: boolean;
  player?: object;
  effects: Effect[];
  vehicle: Entity | null;
  passengers: Entity[];
}

interface Block {
  stateId: number;
  type: number;
  metadata: number;
  light: number;
  skyLight: number;
  blockEntity: object;
  entity: object | null;
  hash?: number;
  name: string;
  displayName: string;
  shapes: [number, number, number, number, number, number][];
  hardness: number;
  boundingBox: 'block' | 'empty';
  position: Vec3;
  digTime: number;
}

interface Window {
  id: number;
  type: number | string;
  title: string;
  slots: (Item | null)[];
  inventoryStart: number;
  inventoryEnd: number;
  hotbarStart: number;
  craftingResultSlot: number;
  requiresConfirmation: boolean;
  selectedItem: Item | null;
}

interface RecipeItem {
  id: number;
  metadata: number | null;
  count: number;
}

interface Recipe {
  result: RecipeItem;
  inShape: RecipeItem[][];
  outShape: RecipeItem[][];
  ingredients: RecipeItem[];
  delta: RecipeItem[];
  requiresTable: boolean;
}

interface Registry {
  version: string;
  [key: string]: unknown;
}

interface Client {
  write(name: string, params: object): void;
  end(reason?: string): void;
}

interface WorldSync {
  getBlock(point: Vec3): Block | null;
}

type MineflayerBotEvents = BotEvents;

interface BotEvents {
  chat: [
    username: string,
    message: string,
    translate: string | null,
    jsonMsg: ChatMessage,
    matches: string[] | null,
  ];
  whisper: [
    username: string,
    message: string,
    translate: string | null,
    jsonMsg: ChatMessage,
    matches: string[] | null,
  ];
  actionBar: [jsonMsg: ChatMessage];
  message: [jsonMsg: ChatMessage, position: string];
  messagestr: [message: string, position: string, jsonMsg: ChatMessage];
  inject_allowed: [];
  login: [];
  spawn: [];
  respawn: [];
  game: [];
  resourcePack: [url: string, hash?: string, uuid?: string];
  title: [title: string, type: 'subtitle' | 'title'];
  title_times: [fadeIn: number, stay: number, fadeOut: number];
  title_clear: [];
  rain: [];
  weatherUpdate: [];
  time: [];
  kicked: [reason: string, loggedIn: boolean];
  end: [reason: string];
  error: [err: Error];
  spawnReset: [];
  death: [];
  health: [];
  breath: [];
  entityAttributes: [entity: Entity];
  entitySwingArm: [entity: Entity];
  entityHurt: [entity: Entity, source: Entity];
  entityDead: [entity: Entity];
  entityTaming: [entity: Entity];
  entityTamed: [entity: Entity];
  entityShakingOffWater: [entity: Entity];
  entityEatingGrass: [entity: Entity];
  entityHandSwap: [entity: Entity];
  entityWake: [entity: Entity];
  entityEat: [entity: Entity];
  entityCriticalEffect: [entity: Entity];
  entityMagicCriticalEffect: [entity: Entity];
  entityCrouch: [entity: Entity];
  entityUncrouch: [entity: Entity];
  entityEquip: [entity: Entity];
  entitySleep: [entity: Entity];
  entitySpawn: [entity: Entity];
  entityElytraFlew: [entity: Entity];
  itemDrop: [entity: Entity];
  playerCollect: [collector: Entity, collected: Entity];
  entityGone: [entity: Entity];
  entityMoved: [entity: Entity];
  entityDetach: [entity: Entity, vehicle: Entity];
  entityAttach: [entity: Entity, vehicle: Entity];
  entityUpdate: [entity: Entity];
  entityEffect: [entity: Entity, effect: Effect];
  entityEffectEnd: [entity: Entity, effect: Effect];
  playerJoined: [player: Player];
  playerUpdated: [player: Player];
  playerLeft: [player: Player];
  blockUpdate: [oldBlock: Block | null, newBlock: Block];
  'blockUpdate:(x, y, z)': [oldBlock: Block | null, newBlock: Block | null];
  blockPlaced: [oldBlock: Block, newBlock: Block];
  chunkColumnLoad: [point: Vec3];
  chunkColumnUnload: [point: Vec3];
  soundEffectHeard: [
    soundName: string,
    position: Vec3,
    volume: number,
    pitch: number,
  ];
  hardcodedSoundEffectHeard: [
    soundId: number,
    soundCategory: number,
    position: Vec3,
    volume: number,
    pitch: number,
  ];
  noteHeard: [block: Block, instrument: Instrument, pitch: number];
  pistonMove: [block: Block, isPulling: number, direction: number];
  chestLidMove: [block: Block, isOpen: number, block2: Block | null];
  blockBreakProgressObserved: [block: Block, destroyStage: number];
  blockBreakProgressEnd: [block: Block];
  diggingCompleted: [block: Block];
  diggingAborted: [block: Block];
  usedFirework: [];
  move: [position: Vec3];
  forcedMove: [];
  mount: [];
  dismount: [vehicle: Entity];
  windowOpen: [window: Window];
  windowClose: [window: Window];
  sleep: [];
  wake: [];
  experience: [];
  physicsTick: [];
  physicTick: [];
  scoreboardCreated: [scoreboard: ScoreBoard];
  scoreboardDeleted: [scoreboard: ScoreBoard];
  scoreboardTitleChanged: [scoreboard: ScoreBoard];
  scoreUpdated: [scoreboard: ScoreBoard, item: number];
  scoreRemoved: [scoreboard: ScoreBoard, item: number];
  scoreboardPosition: [position: DisplaySlot, scoreboard: ScoreBoard];
  teamCreated: [team: Team];
  teamRemoved: [team: Team];
  teamUpdated: [team: Team];
  teamMemberAdded: [team: Team];
  teamMemberRemoved: [team: Team];
  bossBarCreated: [bossBar: BossBar];
  bossBarDeleted: [bossBar: BossBar];
  bossBarUpdated: [bossBar: BossBar];
  heldItemChanged: [newItem: Item | null];
  particle: [particle: Particle];
}

interface Player {
  uuid: string;
  username: string;
  displayName: ChatMessage;
  gamemode: number;
  ping: number;
  entity: Entity;
  skinData?: { url: string; model: string | null };
}

interface GameState {
  levelType:
    | 'default'
    | 'flat'
    | 'largeBiomes'
    | 'amplified'
    | 'customized'
    | 'buffet'
    | 'default_1_1';
  gameMode: 'survival' | 'creative' | 'adventure' | 'spectator';
  hardcore: boolean;
  dimension: 'the_nether' | 'overworld' | 'the_end';
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  maxPlayers: number;
  serverBrand: string;
}

interface GameSettings {
  chat: 'enabled' | 'commandsOnly' | 'disabled';
  colorsEnabled: boolean;
  viewDistance: 'far' | 'normal' | 'short' | 'tiny' | number;
  difficulty: number;
  skinParts: SkinParts;
  mainHand: 'left' | 'right';
  enableTextFiltering?: boolean;
  enableServerListing?: boolean;
}

interface SkinParts {
  showCape: boolean;
  showJacket: boolean;
  showLeftSleeve: boolean;
  showRightSleeve: boolean;
  showLeftPants: boolean;
  showRightPants: boolean;
  showHat: boolean;
}

interface Experience {
  level: number;
  points: number;
  progress: number;
}
interface PhysicsOptions {
  [key: string]: number;
}
interface Time {
  doDaylightCycle: boolean;
  bigTime: bigint;
  time: number;
  timeOfDay: number;
  day: number;
  isDay: boolean;
  moonPhase: number;
  bigAge: bigint;
  age: number;
}
interface ControlStateStatus {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
}
type ControlState = keyof ControlStateStatus;
interface Effect {
  id: number;
  amplifier: number;
  duration: number;
}
interface Instrument {
  id: number;
  name: 'harp' | 'doubleBass' | 'snareDrum' | 'sticks' | 'bassDrum';
}
interface FindBlockOptions {
  point?: Vec3;
  matching: number | number[] | ((block: Block) => boolean);
  maxDistance?: number;
  count?: number;
  useExtraInfo?: boolean | ((block: Block) => boolean);
}
type EquipmentDestination =
  | 'hand'
  | 'head'
  | 'torso'
  | 'legs'
  | 'feet'
  | 'off-hand';
interface ChatPattern {
  pattern: RegExp;
  type: string;
  description: string;
}
interface SimpleClick {
  leftMouse(slot: number): Promise<void>;
  rightMouse(slot: number): Promise<void>;
}
interface Tablist {
  header: ChatMessage;
  footer: ChatMessage;
}
interface ScoreBoard {
  name: string;
  title: ChatMessage;
  items: Record<string, number>;
}
interface Team {
  name: string;
  displayName: ChatMessage;
  members: string[];
  prefix: ChatMessage;
  suffix: ChatMessage;
}
interface BossBar {
  title: ChatMessage;
  health: number;
  division: number;
  flags: number;
}
interface Particle {
  name: string;
  position: Vec3;
  offset: Vec3;
  quantity: number;
  size: number;
}

interface BotActions {
  chatMessage(msg: string): void;
  joinGamemode(gamemode: string): Promise<void>;
  movementPacket(): void;
  openInventory(): Promise<unknown> | void;
  closeInventory(): void;
  closeWindow(): void;
  setHotbar(hotbar: number): Promise<void> | void;
  infoPacket(): void;
  inventoryClick(data: { slot: number; button?: number; mode?: number }): void;
  tossItems(count?: number): Promise<void>;
  activateItem(): Promise<void>;
  toggleMovement(movement: ControlState | 'fly'): void;
  startPathFinder(pos: { x: number; y?: number; z: number }): void;
  leave(): void;
  setHeadRotation(angles: { yaw: number; pitch: number }): void;
  eat(): Promise<void>;
  chatPacket(): void;
  tabComplete(str: string): Promise<string[]>;
  login(): Promise<void>;
  runCode(code: string): Promise<void>;
}

interface MineflayerBot {
  /**
   * Listen to a bot event.
   *
   * @example
   *   bot.on('messagestr', (message) => console.log(message));
   */
  on<K extends keyof BotEvents>(
    event: K,
    listener: (...args: BotEvents[K]) => void,
  ): this;
  once<K extends keyof BotEvents>(
    event: K,
    listener: (...args: BotEvents[K]) => void,
  ): this;
  off<K extends keyof BotEvents>(
    event: K,
    listener: (...args: BotEvents[K]) => void,
  ): this;
  username: string;
  protocolVersion: string;
  majorVersion: string;
  version: string;
  spawnPoint: Vec3;
  heldItem: Item | null;
  usingHeldItem: boolean;
  game: GameState;
  entity: Entity;
  entities: Record<string, Entity>;
  player: Player;
  players: Record<string, Player>;
  tablist: Tablist;
  isRaining: boolean;
  rainState: number;
  thunderState: number;
  chatPatterns: ChatPattern[];
  settings: GameSettings;
  experience: Experience;
  health: number;
  food: number;
  foodSaturation: number;
  oxygenLevel: number;
  physics: PhysicsOptions;
  fireworkRocketDuration: number;
  simpleClick: SimpleClick;
  time: Time;
  quickBarSlot: number;
  inventory: Window;
  currentWindow: Window | null;
  targetDigBlock: Block | null;
  isSleeping: boolean;
  scoreboards: Record<string, ScoreBoard>;
  scoreboard: Partial<Record<DisplaySlot, ScoreBoard>>;
  teams: Record<string, Team>;
  teamMap: Record<string, Team>;
  controlState: ControlStateStatus;
  physicsEnabled: boolean;
  world: WorldSync;
  _client: Client;
  registry: Registry;
  /**
   * Send a chat message or command.
   *
   * @example
   *   bot.chat('/spawn');
   */
  chat(message: string): void;
  whisper(username: string, message: string): void;
  clickWindow(slot: number, mouseButton: number, mode: number): Promise<void>;
  closeWindow(window: Window): void;
  end(reason?: string): void;
  connect(options: object): void;
  supportFeature(name: string): boolean;
  waitForChunksToLoad(): Promise<void>;
  /**
   * Block at a position, or null when its chunk is not loaded.
   *
   * @example
   *   const block = bot.blockAt(bot.entity.position.offset(0, -1, 0));
   */
  blockAt(point: Vec3, extraInfos?: boolean): Block | null;
  blockInSight(maxSteps: number, vectorLength: number): Block | null;
  blockAtCursor(maxDistance?: number): Block | null;
  entityAtCursor(maxDistance?: number): Entity | null;
  blockAtEntityCursor(entity?: Entity, maxDistance?: number): Block | null;
  canSeeBlock(block: Block): boolean;
  findBlocks(options: FindBlockOptions): Vec3[];
  /**
   * Nearest block matching the options.
   *
   * @example
   *   const chest = bot.findBlock({
   *     matching: bot.registry.blocksByName.chest.id,
   *     maxDistance: 16,
   *   });
   */
  findBlock(options: FindBlockOptions): Block | null;
  canDigBlock(block: Block): boolean;
  recipesFor(
    itemType: number,
    metadata: number | null,
    minResultCount: number | null,
    craftingTable: Block | boolean | null,
  ): Recipe[];
  recipesAll(
    itemType: number,
    metadata: number | null,
    craftingTable: Block | boolean | null,
  ): Recipe[];
  /**
   * Nearest entity, optionally filtered.
   *
   * @example
   *   const player = bot.nearestEntity((e) => e.type === 'player');
   */
  nearestEntity(match?: (entity: Entity) => boolean): Entity | null;
  quit(reason?: string): void;
  tabComplete(
    str: string,
    assumeCommand?: boolean,
    sendBlockInSight?: boolean,
    timeout?: number,
  ): Promise<string[]>;
  setSettings(options: Partial<GameSettings>): void;
  loadPlugin(plugin: (bot: MineflayerBot) => void): void;
  loadPlugins(plugins: ((bot: MineflayerBot) => void)[]): void;
  hasPlugin(plugin: (bot: MineflayerBot) => void): boolean;
  sleep(bedBlock: Block): Promise<void>;
  isABed(bedBlock: Block): boolean;
  wake(): Promise<void>;
  setControlState(control: ControlState, state: boolean): void;
  getControlState(control: ControlState): boolean;
  clearControlStates(): void;
  getExplosionDamages(
    entity: Entity,
    position: Vec3,
    radius: number,
    rawDamages?: boolean,
  ): number | null;
  /**
   * Turn the head towards a position.
   *
   * @example
   *   await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
   */
  lookAt(point: Vec3, force?: boolean): Promise<void>;
  look(yaw: number, pitch: number, force?: boolean): Promise<void>;
  updateSign(block: Block, text: string, back?: boolean): void;
  equip(
    item: Item | number,
    destination: EquipmentDestination | null,
  ): Promise<void>;
  unequip(destination: EquipmentDestination | null): Promise<void>;
  tossStack(item: Item): Promise<void>;
  toss(
    itemType: number,
    metadata: number | null,
    count: number | null,
  ): Promise<void>;
  dig(
    block: Block,
    forceLook?: boolean | 'ignore',
    digFace?: 'auto' | Vec3 | 'raycast',
  ): Promise<void>;
  stopDigging(): void;
  digTime(block: Block): number;
  acceptResourcePack(): void;
  denyResourcePack(): void;
  placeBlock(referenceBlock: Block, faceVector: Vec3): Promise<void>;
  placeEntity(referenceBlock: Block, faceVector: Vec3): Promise<Entity>;
  activateBlock(
    block: Block,
    direction?: Vec3,
    cursorPos?: Vec3,
  ): Promise<void>;
  activateEntity(entity: Entity): Promise<void>;
  activateEntityAt(entity: Entity, position: Vec3): Promise<void>;
  consume(): Promise<void>;
  fish(): Promise<void>;
  activateItem(offHand?: boolean): void;
  deactivateItem(): void;
  useOn(targetEntity: Entity): void;
  attack(entity: Entity, swing?: boolean): void;
  swingArm(hand?: 'left' | 'right', showHand?: boolean): void;
  /** Vanilla-accurate mouse buttons: click once, or press and hold until released. */
  mouse: {
    click(button: 'left' | 'right'): void;
    press(button: 'left' | 'right'): void;
    release(button: 'left' | 'right'): void;
    isDown(button: 'left' | 'right'): boolean;
  };
  mount(entity: Entity): void;
  dismount(): void;
  moveVehicle(left: number, forward: number): void;
  setQuickBarSlot(slot: number): void;
  craft(recipe: Recipe, count?: number, craftingTable?: Block): Promise<void>;
  writeBook(slot: number, pages: string[]): Promise<void>;
  openContainer(
    container: Block | Entity,
    direction?: Vec3,
    cursorPos?: Vec3,
  ): Promise<Window>;
  openChest(
    chest: Block | Entity,
    direction?: number,
    cursorPos?: Vec3,
  ): Promise<Window>;
  openFurnace(furnace: Block): Promise<Window>;
  openDispenser(dispenser: Block): Promise<Window>;
  openEnchantmentTable(table: Block): Promise<Window>;
  openAnvil(anvil: Block): Promise<Window>;
  openVillager(villager: Entity): Promise<Window>;
  trade(
    villager: Entity,
    tradeIndex: string | number,
    times?: number,
  ): Promise<void>;
  setCommandBlock(
    pos: Vec3,
    command: string,
    options: Record<string, boolean | number>,
  ): void;
  /**
   * Wait for a number of game ticks (20 ticks = 1 second).
   *
   * @example
   *   await bot.waitForTicks(20);
   */
  waitForTicks(ticks: number): Promise<void>;
  respawn(): void;
  putSelectedItemRange(
    start: number,
    end: number,
    window: Window,
    slot: number,
  ): Promise<void>;
  putAway(slot: number): Promise<void>;
  transfer(options: {
    window: Window;
    itemType: number;
    metadata: number | null;
    count?: number;
    sourceStart: number;
    sourceEnd: number;
    destStart: number;
    destEnd: number;
  }): Promise<void>;
  openBlock(block: Block, direction?: Vec3, cursorPos?: Vec3): Promise<Window>;
  openEntity(entity: Entity): Promise<Window>;
  moveSlotItem(sourceSlot: number, destSlot: number): Promise<void>;
  updateHeldItem(): void;
  getEquipmentDestSlot(destination: EquipmentDestination): number;
  awaitMessage(...args: (string | RegExp)[]): Promise<string>;
  addChatPattern(
    name: string,
    pattern: RegExp,
    options?: { repeat: boolean; parse: boolean },
  ): number;
  addChatPatternSet(
    name: string,
    patterns: RegExp[],
    options?: { repeat: boolean; parse: boolean },
  ): number;
  removeChatPattern(name: string | number): void;
  creative: {
    setInventorySlot(slot: number, item: Item | null): Promise<void>;
    clearSlot(slot: number): Promise<void>;
    clearInventory(): Promise<void>;
    flyTo(destination: Vec3): Promise<void>;
    startFlying(): void;
    stopFlying(): void;
  };
}

type DisplaySlot = 'list' | 'sidebar' | 'below_name' | `sidebar.team.${string}`;
export type Bot = MineflayerBot & BotPluginExtensions;

type BotPluginExtensions = {
  botId: number;
  mainVersion: number;
  join(gamemode: string, options?: Record<string, unknown>): Promise<void>;
  isOnline(): boolean;
  itemInfo: {
    (item: Item | null): { name: string; info: string };
    /** Only the custom name (cheaper than the full call). */
    name(item: Item | null): string;
    /** Only the lore, lines joined with `\n`. */
    lore(item: Item | null): string;
  };
  login(password?: string): Promise<void>;
  /**
   * Run a command and wait for the window it opens.
   *
   * @example
   *   const window = await bot.openWindow('/shop', { timeout: 5000 });
   *   if (window) console.log(bot.getWindowTitle(window));
   */
  openWindow(
    command: string,
    options?: {
      timeout?: number;
      check?: (window: Window) => boolean;
      commandInverval?: number;
      ticks?: number;
      signal?: { aborted: boolean };
    },
  ): Promise<Window | null>;
  transferItems(
    mode: number | 'trade' | 'gift' | 'window' | 'tradeWithKeys',
    options: {
      username?: string;
      command?: string;
      ignore?: string[];
      filter?: string[];
      itemFilter?: (item: Item) => boolean;
      keep?: boolean;
      keys?: string[];
      forceTradeKeys?: boolean;
      timeout?: number | null;
      shiftClick?: boolean;
    },
  ): Promise<void>;
  /**
   * Items in the open window matching a name or lore.
   *
   * @example
   *   const [diamond] = bot.findWindowSlots({ name: 'Diamond' });
   *   if (diamond) await bot.clickWindow(diamond.slot, 0, 0);
   */
  findWindowSlots(
    filter: { name?: string; lore?: string } | string,
    options?: {
      caseSensitive?: boolean;
      rows?: number[] | null;
      columns?: number[] | null;
      slotRange?: number[] | null;
      window?: Pick<Window, 'slots' | 'inventoryStart'>;
      toAlpha?: boolean;
    },
  ): Item[];
  openInventory(): void;
  onceWithTimeout<K extends keyof BotEvents>(
    event: K,
    timeoutInTicks: number,
  ): Promise<BotEvents[K]>;
  getWindowTitle(window?: Window): string | null;
  hasFullInventory(): boolean;
  countInventoryItems(): number;
  dumpChunk(chunk: unknown): number[];
  dumpChunkWithPos(chunk: unknown, position: Vec3): number[];
  actions: BotActions;
};
