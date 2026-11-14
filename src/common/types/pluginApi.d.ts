// =============================================================================
// SINGLE SOURCE OF TRUTH for the evolving plugin API surface.
//
// App code imports the real types from this file, so the runtime
// implementations (jsRuntime's `buildScript`/`console`, workerTypes' `Bot`,
// BotMachine) are type-checked against the exact contract plugins see — the two
// can no longer drift.
//
// `scripts/build-jnbot-types.mjs` turns this module into the ambient plugin
// surface (fullApiTypes.txt, the @jnbot/types npm package, and the
// PLUGIN_API_TYPES constant) by:
//   1. deleting every `import …;` line, and
//   2. stripping the leading `export ` keyword from each declaration.
// The stub types that the deleted imports referred to (Bot, Item, BotActions,
// IMcClient, BotMachine) are supplied by `pluginPrelude.d.ts`, which the
// generator prepends. That is how the same `IMcClient`/`Bot` symbol resolves to
// the *real* internal type in the app and to the *curated* plugin stub in the
// generated surface.
//
// AUTHORING RULES (so the line-based generator stays correct):
//   • keep every `import` on a SINGLE line,
//   • only `export` declarations / `export declare` globals — no runtime code,
//   • don't reference internal types unless they're imported here (so they get
//     stripped) and stubbed in pluginPrelude.d.ts.
// =============================================================================

import type { Bot, BotActions } from 'main/src/workers/workerTypes';
import type { Item } from 'prismarine-item';
import type { IMcClient } from 'common/types/McClientApi';
import type { IMcServer, McServerHandleSummary } from 'common/types/mcServerApi';

import type {PluginOptionSchema } from './pluginOptions.d';

type MacroLanguage = 'js' | 'ts' | 'components' | 'recording';
type MacroScriptType = 'script' | 'action' | 'profileUi' | 'botExtension';

type MacroInfo = {
  name: string;
  description: string;

  pluginId: string; //

  editedAt: number | null;
  createdAt: number;
  public: boolean;
  language: MacroLanguage;
  downloads?: number;
  /**
   * Provenance of this plugin, used to decide whether to warn before
   * importing/running. Set during create (author) or import (verified |
   * trusted | unverified). Missing on legacy plugins — treat as trusted.
   *
   * - 'author'     — created locally by the user
   * - 'verified'   — `.jnp` carried a valid maintainer signature
   * - 'trusted'    — user explicitly accepted an unverified plugin
   * - 'unverified' — user imported despite the warning (one-time pass)
   */
  trust?: 'author' | 'verified' | 'trusted' | 'unverified';
  scriptType: MacroScriptType;
  config?: PluginOptionSchema;
  banner?: string;
};
// =========================== Plugin API ========================= \\

export type AltUpdateData = {
  password?: string;
  ranks?: Record<string, string | null>;
  gkits?: Record<string, string[]>;
};

/**
 * Alt changes keyed by username. Existing usernames are partially updated,
 * new usernames are added (and require `password`), and `null` removes an alt.
 */
export type AltUpdateRequest = Record<string, AltUpdateData | null>;

/* ===========================================================================
 * Cooldowns
 * ======================================================================== */

/**
 * A cooldown owned by your plugin. Returned by `script.getCooldowns()` and
 * `script.addCooldown()`. Use the methods to inspect or restart its countdown.
 */
export interface Cooldown {
  readonly id: string;
  /** Owning plugin (set automatically). `pluginId + reminderId` is globally unique. */
  readonly pluginId: string;
  /** Plugin-defined id (e.g. the gamemode). Unique within a pluginId. */
  reminderId?: string;
  name: string;
  /** Cooldown length in milliseconds. */
  cooldown: number;
  /** Start epoch (ms); the cooldown is ready at `time + cooldown`. */
  time: number;
  /** Option overrides replayed when this cooldown auto-runs the plugin. */
  options?: Record<string, any>;
  /** Epoch (ms) at which this cooldown becomes ready (`time + cooldown`). */
  readonly readyAt: number;
  /** `true` once the cooldown has fully elapsed. */
  isCompleted(): boolean;
  /** Milliseconds left until the cooldown is ready (0 once completed). */
  remaining(): number;
  /** Restart the countdown from now (ready again after one cooldown). */
  reset(): Promise<Cooldown>;
  /** Permanently remove this cooldown. */
  delete(): Promise<void>;
}

/** @deprecated Use {@link Cooldown} instead. */
export type Reminder = Cooldown;

/* ===========================================================================
 * Active scripts
 * ======================================================================== */

export type ActiveScriptsType = Record<
  string,
  {
    name: string;
    scriptId: string;
    scriptInstanceId: number;
    instances: { id: string; instanceId: number }[];
  }
>;

export type ServerAltInfo = {
  /** Whether this alt uses Microsoft authentication on this profile. */
  premium?: boolean;
  password?: string;
  gkits: { [gamemode: string]: string[] };
  ranks: { [gamemode: string]: string };
};

/**
 * An alt. Identity only — username, UID, email — shared across every server.
 * Per-server authentication mode, credentials/ranks/gkits live in
 * `SettingsObj.altData` of the corresponding server file. Merge the two
 * sides with `AltWithData` for in-memory use.
 */
export interface Alt {
  username: string;
  UID?: string | null;
  email?: string;
}

/**
 * Alt merged with the active server's `ServerAltInfo`. This is what UI,
 * workers, and IPC payloads pass around. An alt with no `data` for the
 * active server should be treated as "not used on this server".
 */
export type AltWithData = Alt & { data: ServerAltInfo };

type JNdataGamemodeData = {
  ranks: {
    [rank: string]: {
      price: number;
      color: string;
    };
  };
  gkits: {
    [gkit: string]: number;
  };
};

export type IterateAltsOptions = {
  /**
   * Options forwarded to the underlying `join()` call for every alt
   * (e.g. `{ gamemode: 'survival' }`). Defaults to `{ login: true }`.
   */
  join?: JoinConfig;
  options?: AltCredentials;
  /**
   * Extra per-alt predicate, applied on top of the filtering already derived
   * from `scriptOptions` (tags, ranks, gkits, altRange, ...).
   */
  altFilter?: (alt: Alt) => boolean;
  /**
   * Whether to run the standard `filterAlts` pipeline on the given alts.
   * Defaults to `true`. Set to `false` when the caller has already filtered.
   */
  filter?: boolean;

  showProgress?: boolean; // Whether to send progress updates to the UI (for scripts with many alts)
  disableControls?: boolean; // Whether to disable the pause/skip/previous buttons in the UI
  startCount?: number; // Starting index in the filtered alt list
};

type ScriptSettingsForFilter = Partial<{
  gamemode?: string;
  alts?: string[] | string;
  altRange?: [string | null, string | null];
  ignoreAlts?: string[];
  withTags?: string[];
  altFilter?: (alt: Alt) => boolean;
  withRanks?: boolean | string[];
  withGkits?: boolean | string[];
  [other: string]: any;
}>;

export type StartPluginOptions = {
  /* @deprecated use pluginId instead */
  name: string;
  /** A plugin's id, or `chain:<chainId>` to start one of the user's chains. */
  pluginId: string;
  /** Run on this preset, by name or id ("default" for Default). Unset uses the selected preset. */
  preset?: string;
  /** Applied on top of the preset's options. */
  optionOverrides?: Record<string, any>;
  /* @deprecated */
  quitOnExit?: boolean | string;
};

export type PromptOptions = {
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  description?: string;
  /** Image URL (e.g. a data URI) shown above the input */
  image?: string;
};

export type NotificationOptions = {
  type: string;
  title: string;
  message: string;
};

export type DialogButton = { label: string; type:  "link" | "text" | "default" | "primary" | "dashed" | undefined, danger?: boolean };

export type DialogOptions = {
  title: string;
  body: string;
  buttons: DialogButton[];
};

export type SnackbarOptions = { type: string; title: string };

export type ProgressUpdate = {
  current: number;
  total: number;
};

export type ActionArgs = {
  actionId: string;
  bot?: Bot;
  /** Run on this preset, by name or id ("default" for Default). Unset uses the selected preset. */
  preset?: string;
  /** Applied on top of the preset's options. */
  optionOverrides?: Record<string, unknown>;
  args: any[];
};

interface AppVersion {
  current: string;
  isLaterThan: (otherVersion: string) => boolean;
}

/* ===========================================================================
 * `script` global
 * ======================================================================== */

export type AiJson = null | boolean | number | string | AiJson[] | AiJsonObject;
export interface AiJsonObject { [key: string]: AiJson; }
/** Supported draft-07 subset. Unsupported keywords are rejected at registration. */
export interface AiSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  title?: string;
  properties?: Record<string, AiSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: AiSchema;
  enum?: AiJson[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}
export interface AiTool {
  name: string;
  description: string;
  parameters: AiSchema;
  handler?: (arguments_: AiJsonObject) => AiJson | void | Promise<AiJson | void>;
}
export interface AiRequestOptions { signal?: AbortSignal; timeoutMs?: number; }
export interface AiModelOptions {
  /** Optional HTTPS download of a compatible model, replacing the built-in one. */
  modelUrl?: string;
  /** Tokens the model can look back on (1-8192). Defaults to 512; raise it for long prompts or large tool lists. */
  windowSize?: number;
}
export interface AiPredictOptions extends AiRequestOptions {
  maxNewTokens?: number;
  /** Generate reasoning before tool calls. Defaults to false. */
  reasoning?: boolean;
}
export type AiRunOptions = AiPredictOptions;
export interface AiCall { name: string; arguments: AiJsonObject; }
export interface AiPrediction {
  status: 'calls' | 'no_match' | 'withheld';
  calls: AiCall[];
  suppressedCalls: (AiCall & { reason?: string })[];
  toolsetRevision: number;
  confidence: number | null;
  reasoning: string | null;
  modelId: string;
}
export interface AiError { code: string; message: string; }
export type AiExecutionResult = AiCall & ({ value: AiJson; error?: never } | { error: AiError; value?: never });
export interface AiRunResult {
  status: 'completed' | 'no_match' | 'withheld' | 'failed' | 'cancelled';
  toolsetRevision: number;
  modelId: string;
  steps: number;
  results: AiExecutionResult[];
  prediction?: AiPrediction;
  error?: AiError;
}
export interface AiAgent {
  predict(text: string, options?: AiPredictOptions): Promise<AiPrediction>;
  run(text: string, options?: AiRunOptions): Promise<AiRunResult>;
  setTools(tools: AiTool[]): void;
  /** Add a tool or replace its definition if its name already exists. */
  addTool(tool: AiTool): void;
  removeTool(name: string): void;
  dispose(): void;
}
export interface AiAPI {
  createAgent(options?: AiModelOptions & { tools?: AiTool[] }): AiAgent;
  extract(text: string, schema: AiSchema, options?: AiPredictOptions & AiModelOptions): Promise<AiJsonObject | null>;
}

/** A function the AI may call while answering, e.g. to read the bot's state. */
export interface LlmTool<Input = any> {
  name: string;
  description: string;
  /** JSON Schema of the input object. Omit for a tool without input. */
  parameters?: AiSchema;
  /** Its return value (anything JSON-serializable) is shown to the AI. */
  run(input: Input): unknown | Promise<unknown>;
}
export interface LlmAskOptions {
  /** Instructions, e.g. a persona: "You are Steve, a grumpy miner. Keep replies under 100 characters." */
  system?: string;
  /** Functions the AI may call before it answers. */
  tools?: LlmTool[];
  maxTokens?: number;
}
export interface LlmChatOptions extends LlmAskOptions {
  /** How many messages the chat remembers. Defaults to 20. */
  memory?: number;
}
export interface LlmChat {
  /** Send a message and get the reply. Replies are made one at a time, in order. */
  send(message: string): Promise<string>;
  /** The remembered conversation. */
  readonly history: { role: 'user' | 'assistant'; content: string }[];
  clear(): void;
}
/**
 * The AI provider the user set up in Settings (Claude, Gemini, OpenAI,
 * OpenRouter or a local Ollama). Most users have none: check `isAvailable()`.
 *
 * @example
 * // A chat bot that answers when its name is mentioned.
 * const chat = script.llm.createChat({
 *   system: `You are ${bot.username}, a friendly player on a Minecraft server. Reply in one short line.`,
 *   tools: [{ name: 'health', description: 'Your health and food.', run: () => ({ health: bot.health, food: bot.food }) }],
 * });
 * bot.on('chat', async (username, message) => {
 *   if (username === bot.username || !message.includes(bot.username)) return;
 *   bot.chat(await chat.send(`${username}: ${message}`));
 * });
 */
export interface LlmAPI {
  /** True when the user added an AI provider in Settings. */
  isAvailable(): Promise<boolean>;
  /** One question, one answer. */
  ask(prompt: string, options?: LlmAskOptions): Promise<string>;
  /** Like `ask`, but the answer is parsed JSON. Describe the shape you want in the prompt. */
  askJson<T = any>(prompt: string, options?: LlmAskOptions): Promise<T>;
  /** A conversation that remembers earlier messages. */
  createChat(options?: LlmChatOptions): LlmChat;
}

export interface ScriptAPI {
  /** Local inference. Agents start with no tools and do not load a model until used. */
  ai: AiAPI;
  /** Cloud AI through the user's own provider (see {@link LlmAPI}); unavailable for most users. */
  llm: LlmAPI;
  stop(): void;
  restart(): Promise<never>;
  /**
   * Register a handler invoked when this script is about to end (stop button,
   * app close, restart). You get a short grace window (~100ms) for cleanup
   * before the worker is killed, so keep the handler quick. Returns an
   * unsubscribe fn.
   */
  onExit(handler: () => void): () => void;
  /**
   * @deprecated Use `script.startPlugin()` instead.
   */
  startScript(options: { name: string; quitOnExit?: boolean | string }): void;
  /**
   * @deprecated Use `script.stopPlugin()` instead.
   */
  stopScript(options: { name: string }): void;
  startPlugin(options: StartPluginOptions): void;
  stopPlugin(options: { pluginId: string }): void;
  /** Ask the user for a value. Resolves with `{ response }` once they submit. */
  prompt(options: PromptOptions): Promise<{ response: string }>;
  notification(options: NotificationOptions): void;
  snackbar(options: SnackbarOptions): void;
  dialog(options: DialogOptions): Promise<string>;
  updateProgress(progress: ProgressUpdate): void;
  /**
   * Enable runner control buttons in the UI. `controls` is a bitfield built
   * from `script.Controls`, e.g. `script.Controls.PAUSE | script.Controls.SKIP`.
   */
  setControls(controls: number): void;
  /** Listen for control-button clicks; handler gets the pressed Controls bit. Returns an unsubscribe fn. */
  onControl(handler: (control: number) => void): () => void;
  /** Bitfield flags for setControls/onControl. */
  Controls: {
    NONE: 0;
    PAUSE: number;
    RESUME: number;
    RESTART: number;
    SKIP: number;
    PREVIOUS: number;
  };
  optionError(
    options: { field: string; message: string },
    scriptInfo?: any,
  ): void;
  getAlts(): AltWithData[];
  /**
   * Ask the user for permission to read an account password. The user can
   * grant this account or every account for the current script run. Premium
   * accounts resolve to `null`; declining throws an error.
   */
  requestAccountPassword(username: string): Promise<string | null>;
  /**
   * Iterate over your alts the easy way. Pass your alts (from `getAlts()`) and
   * the script's options (`settings`); it filters the alts (tags, ranks,
   * gkits, altRange, ignored alts, ...), wires up the pause/skip/previous
   * control buttons, joins + logs in each alt, yields the live bot and ends it
   * once your loop body finishes.
   *
   *   for await (const bot of script.forEachBot(script.getAlts(), script.settings)) {
   *     // drive `bot` here — it's already joined and logged in
   *   }
   */
  forEachBot(
    alts: AltWithData[],
    scriptOptions?: ScriptSettingsForFilter,
    options?: IterateAltsOptions,
  ): AsyncGenerator<Bot, void, unknown>;

  /**
   * Like {@link forEachBot}, but does NOT join the server: it filters your alts
   * and wires up the pause/skip/previous buttons the same way, yet yields the
   * plain alt object instead of a joined bot. Use it when you only need each
   * alt's data and don't want to log in.
   *
   *   for await (const alt of script.forEachAlt(script.getAlts(), script.settings)) {
   *     // inspect `alt` — no bot has been joined
   *   }
   */
  forEachAlt(
    alts: AltWithData[],
    scriptOptions?: ScriptSettingsForFilter,
    options?: Omit<IterateAltsOptions, 'filter' | 'join' | 'options'>,
  ): AsyncGenerator<AltWithData, void, unknown>;

  /**
   * Request changes to stored alts. Key updates by username: provide `password`,
   * `ranks`, and/or `gkits` to patch an alt; use `null` to remove one. New alts
   * require a password. JNbot presents the update to the user for confirmation.
   */
  requestAltUpdate(updates: AltUpdateRequest): void;
  /**
   * Run another script-action by name. Mirrors an action's own `main` signature:
   * the `bot` is passed first, the action's resolved settings second, and any
   * extra `args` third — i.e. the action receives `main(bot, settings, args)`.
   */
  /** @deprecated  Use `script.startAction()` instead. */
  runAction(action: string, bot?: Bot, ...args: any[]): Promise<any>;

  startAction(options: ActionArgs): Promise<any>;
  getActiveScripts(): Promise<ActiveScriptsType>;
  /**
   * Details of an installed plugin, profile script or chain (`chain:<id>`),
   * such as the ids a `scriptSelect` option stores. Resolves to `null` when
   * the id is unknown or blocked on this profile. Chains only have `pluginId`,
   * `name`, `description` and `scriptType`.
   */
  getPluginInfo(pluginId: string): Promise<MacroInfo | null>;
  /** Returns the live Minecraft-bridge client for the given id. */
  getMcClient(clientId: string): IMcClient;
  getMcClients(): Promise<{ username: string; clientId: string }[]>;
  /** Returns a managed Fabric server handle. LAN and joined servers are excluded. */
  getMcServer(serverId: string): IMcServer;
  getMcServers(): Promise<McServerHandleSummary[]>;
  /**
   * Record semantic gameplay from a JNbot Minecraft client and replay saved
   * automations on either a Minecraft client or a Mineflayer bot.
   */
  automations: AutomationAPI;
  sendDiscordMessage(options: {
    message: string;
    webhook_url: string;
  }): Promise<void>;
  /** This plugin's stored cooldowns for the active server. */
  getCooldowns(): Promise<Cooldown[]>;
  /**
   * Create (or update) a cooldown owned by this plugin. Passing a `reminderId`
   * that already exists for this plugin updates that cooldown instead of adding
   * a new one. Throws once the limit (max 10) is reached. Resolves with the
   * {@link Cooldown} — call `.reset()`, `.delete()`, `.isCompleted()` on it.
   *
   * Pass `options` (field id → value) to capture the context this cooldown
   * runs in; it's replayed over the stored settings if the user enables
   * auto-run, so the plugin runs the same way no matter what's selected later
   * (e.g. `{ gamemode: 'skyblockdream' }`).
   */
  addCooldown(options: {
    name: string;
    cooldown: number;
    reminderId?: string;
    time?: number;
    options?: Record<string, any>;
  }): Promise<Cooldown>;
  /** @deprecated Use `script.getCooldowns()` instead. */
  getReminders(): Promise<Cooldown[]>;
  /** @deprecated Use `script.addCooldown()` instead. */
  addReminder(options: {
    name: string;
    cooldown: number;
    reminderId?: string;
    time?: number;
    options?: Record<string, any>;
  }): Promise<Cooldown>;
  /**
   * Saved plugin options, keyed by option id.
   *
   * @example
   *   const message = script.settings.message ?? 'Hello';
   */
  settings: Record<string, any>;

  JNdata: { gamemodes: Record<string, JNdataGamemodeData> };
  scriptInfo: MacroInfo;
  appVersion: AppVersion;
}

export interface AutomationSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  stepCount: number;
  interrupted?: boolean;
}

export interface AutomationDocument {
  schemaVersion: 2;
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  source: {
    kind: 'minecraft';
    clientId?: string;
    username?: string;
    mcVersion?: string;
    serverAddress?: string;
    dimension?: string;
  };
  origin: AutomationVec3 & { yaw: number; pitch: number };
  inputs: {
    id: string;
    label: string;
    secret: boolean;
    required: boolean;
  }[];
  steps: AutomationStep[];
  interrupted?: boolean;
}

export interface AutomationVec3 {
  x: number;
  y: number;
  z: number;
}

export interface AutomationPosition {
  absolute: AutomationVec3;
  relative: AutomationVec3;
}

export interface AutomationEntityTarget {
  uuid?: string;
  type: string;
  name?: string;
  position?: AutomationPosition;
  radius?: number;
}

export type AutomationStep = {
  id: string;
  enabled: boolean;
  atMs: number;
  label?: string;
} & (
  | {
      kind: 'movePath';
      points: (AutomationPosition & {
        atMs: number;
        tick: number;
        yaw: number;
        pitch: number;
        onGround: boolean;
        velocity?: AutomationVec3;
        forward?: boolean;
        back?: boolean;
        left?: boolean;
        right?: boolean;
        jump?: boolean;
        sprint?: boolean;
        sneak?: boolean;
      })[];
    }
  | { kind: 'chat'; message: string }
  | { kind: 'hotbar'; slot: number }
  | { kind: 'openInventory' }
  | {
      kind: 'windowClick';
      window: { title?: string; type?: string; inventory?: boolean };
      slot: number;
      button: number;
      actionType: string;
    }
  | { kind: 'closeWindow'; window?: { title?: string; type?: string } }
  | {
      kind: 'attackEntity' | 'useEntity';
      entity: AutomationEntityTarget;
      hand?: 'main' | 'off';
    }
  | {
      kind: 'breakBlock' | 'useBlock';
      position: AutomationPosition;
      face?: 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
      hand?: 'main' | 'off';
    }
  | {
      kind: 'useItem' | 'releaseUseItem' | 'swingArm' | 'swapHands' | 'wake' | 'respawn';
      hand?: 'main' | 'off';
    }
  | { kind: 'dropItem'; entireStack?: boolean }
  | {
      kind: 'screenAction';
      action: 'button' | 'recipe' | 'trade' | 'rename' | 'beacon' | 'book' | 'sign' | 'bundle' | 'creativeSlot' | 'pickItem' | 'spectatorTeleport';
      data: Record<string, unknown>;
    }
);

export interface AutomationSessionStatus {
  sessionId: string;
  automationId: string;
  state:
    | 'recording'
    | 'playing'
    | 'paused'
    | 'failed'
    | 'completed'
    | 'stopped';
  currentStep: number;
  totalSteps: number;
  error?: string;
  issues: { stepId: string; stepIndex: number; kind: AutomationStep['kind']; atMs: number; reason: string }[];
}

export interface AutomationHandle {
  readonly id: string;
  readonly done: Promise<AutomationSessionStatus>;
  pause(): Promise<unknown>;
  resume(): Promise<unknown>;
  stop(): Promise<unknown>;
}

export interface AutomationAPI {
  list(): Promise<AutomationSummary[]>;
  get(id: string): Promise<AutomationDocument>;
  record(
    client: IMcClient,
    options?: {
      /** Existing recording-plugin id to replace. Omit to create a new plugin. */
      pluginId?: string;
      name?: string;
    },
  ): Promise<AutomationHandle>;
  replay(
    target: Bot | IMcClient,
    idOrDocument: string | AutomationDocument,
    options: {
      spatialMode: 'relative' | 'absolute';
      inputs?: Record<string, string>;
    },
  ): Promise<AutomationHandle>;
}

/* ===========================================================================
 * `console` global
 * ======================================================================== */

export interface ConsoleAPI {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  success(...data: unknown[]): void;
  clear(): void;
}

/* ===========================================================================
 * BotMachine value types  (the class shape itself lives in pluginPrelude.d.ts)
 * ======================================================================== */

export type Awaitable<T> = T | Promise<T>;

/**
 * Enters `gamemode` on servers the built-in join flow does not fit. Resolve
 * once the bot is there; return `false` or throw when it could not get there.
 */
export type JoinHandler = (gamemode: string, bot: Bot) => Awaitable<boolean | void>;

/** Reads the bot's current gamemode (scoreboard, tab list, world, ...); null when unknown. */
export type GamemodeDetector = (bot: Bot) => string | null | undefined;

export interface BotMachine<S extends object = Record<string, unknown>>
  extends BotMachineControls {
  bot: Bot | null;
  state: S;
  delay: number;
  addTask(task: Task<S>): BotMachine<S>;
  addTasks(tasks: Task<S>[]): BotMachine<S>;
  once(when: Guard<S>, run: Action<S>, name?: string): BotMachine<S>;
  /**
   * Change another plugin's tasks by name (e.g. from `chain.patch`). Each
   * throws when there is no task with that name.
   */
  insertBefore(name: string, task: Task<S>): BotMachine<S>;
  insertAfter(name: string, task: Task<S>): BotMachine<S>;
  replaceTask(name: string, task: Task<S>): BotMachine<S>;
  removeTask(name: string): BotMachine<S>;
  /** Run `wrap` instead of the task; call `run(ctx)` inside it to run the original. */
  wrapTask(
    name: string,
    wrap: (ctx: TaskContext<S>, run: Action<S>) => Awaitable<void>,
  ): BotMachine<S>;
  setState(patch: Partial<S>): BotMachine<S>;
  getState(): S;
  setDelay(ms: number): BotMachine<S>;
  resetOnce(): BotMachine<S>;
  start(): BotMachine<S>;
  pause(botId?: number): BotMachine<S>;
  resume(botId?: number): BotMachine<S>;
  stop(): BotMachine<S>;
  finish(): BotMachine<S>;
  interrupt(reason?: string): BotMachine<S>;
  onFinish(
    listener: (data: { bot: Bot | null; state: S }) => void,
  ): BotMachine<S>;
  onError(
    listener: (error: unknown, task: Task<S>, context: TaskContext<S>) => void,
  ): BotMachine<S>;
}

/** A chain step, as seen through the `chain` API. */
export interface ChainStepInfo {
  id: string;
  name: string;
  /** Plugin id of the step's action. */
  scriptId: string;
  /** The step's option overrides, including those from `chain.setOptions`. */
  options: Record<string, unknown>;
  /** False when skipped with `chain.disableStep`; `chain.runStep` still runs it. */
  enabled: boolean;
}

/**
 * The chain a plugin runs in: `require('JNbot').chain`, or `null` outside a
 * chain. A chain's setup code gets it as `chain`. Steps are referred to by id
 * or name. Changes (options, patches, disabled or added steps) last until the
 * chain moves on to the next alt.
 *
 * @example
 * // Setup code: Kit Collector keeps its kits, and Auto Salvage makes room
 * // whenever its inventory fills up, after which Kit Collector carries on.
 * chain.setOptions('Kit Collector', { itemTransfer: 'keep' });
 * chain.patch('Kit Collector', (machine) => {
 *   machine.wrapTask('Depositing items', async (ctx, run) => {
 *     if (ctx.bot.inventory.emptySlotCount() < 8) await chain.runStep('Auto Salvage');
 *     await run(ctx);
 *   });
 * });
 */
export interface ChainAPI {
  readonly id: string;
  readonly name: string;
  /** The bot the chain runs on right now. */
  readonly bot: Bot;
  /** Values returned by earlier steps (plus `alt`), filled into `{key}` placeholders. */
  readonly data: Record<string, unknown>;
  /** Every step, in order. */
  readonly steps: ChainStepInfo[];
  /** The step running right now (the innermost one when a step runs another). */
  readonly current: ChainStepInfo | null;
  /**
   * Run a step on the chain's bot, exactly as the chain would: with its option
   * overrides and `setOptions`, then `options` on top. Resolves false when it fails.
   */
  runStep(step: string, options?: Record<string, unknown>): Promise<boolean>;
  /**
   * Always run a step with these options, on top of its overrides (e.g. to
   * make sure Kit Collector keeps its kits). Merges with earlier calls.
   */
  setOptions(step: string, options: Record<string, unknown>): void;
  /**
   * Change the tasks of each `BotMachine` the step starts, right before it
   * starts. Throwing (e.g. a task name that does not exist) fails the step.
   */
  patch(step: string, patch: (machine: BotMachine<any>) => void): void;
  /** Skip a step when the chain gets to it. */
  disableStep(step: string): void;
  enableStep(step: string): void;
  /** Add a step after `after` (default: at the end). */
  addStep(
    step: { scriptId: string; name?: string; options?: Record<string, unknown> },
    after?: string,
  ): ChainStepInfo;
  /** After the current step, go to this step instead. */
  goTo(step: string): void;
  /** After the current step, move on to the next alt. */
  skipAlt(): void;
  /** After the current step, stop the chain. */
  stop(): void;
}

export interface TaskContext<S extends object = Record<string, unknown>> {
  /** The bot. */
  bot: Bot;
  /** Shared, mutable state for this run — persists across ticks. */
  state: S;
  /** The machine itself, so a task can pause/stop/setDelay/addTask, etc. */
  machine: BotMachine<S>;
}

export type Guard<S extends object = Record<string, unknown>> = (
  ctx: TaskContext<S>,
) => boolean;

export type Action<S extends object = Record<string, unknown>> = (
  ctx: TaskContext<S>,
) => Awaitable<void>;

export interface Task<S extends object = Record<string, unknown>> {
  /** Optional label, logged (when `debug`) each time the task runs. */
  name?: string;
  /** Task runs only when this returns true AND no earlier task matched. */
  when: Guard<S>;
  /** What to do when this task is the first match of the tick. */
  run: Action<S>;
  /** Run at most once (re-armed on rejoin when `resetOnceOnRejoin`). */
  once?: boolean;
  /** Internal: set once a `once` task has fired. */
  _done?: boolean;
}

export interface AltCredentials {
  username: string;
  version?: string;
  host?: string;
  port?: number;
  /** Route this bot through a ProxyServer created by the current plugin. */
  minecraftProxy?: {
    host?: string;
    port?: number;
    onlineMode?: boolean;
    /** Join an existing ProxySession without running login or backend selection. */
    takeover?: boolean;
  };
  [k: string]: unknown;
}

export interface JoinConfig {
  /** When set, the machine drives the bot into this gamemode first. */
  gamemode?: string;
  /** Extra options forwarded to the underlying join() call. */
  login?: boolean;
  /** Treat a gamemode-join attempt as successful without confirmation. */
  optimisticJoin?: boolean;
  chunkLoadLimit?: number | null
}

export interface BotMachineControls {
  readonly active: boolean;
  readonly paused: boolean;
  pause(botId?: number): BotMachineControls;
  resume(botId?: number): BotMachineControls;
  finish(): BotMachineControls;
  interrupt(reason?: string): BotMachineControls;
  setDelay(ms: number): unknown;
}

export interface BotMachineOptions<S extends object = Record<string, unknown>> {
  /** Existing bot to drive. Omit (or pass null) to let `join.joinOptions` create one. */
  bot?: Bot | null;
  /** Initial shared state. */
  state?: S;
  /** Delay between ticks (ms). Default: appSettings.delay_between_actions ?? 250. */
  delay?: number;
  /** Built-in join-server / join-gamemode steps. */
  join?: JoinConfig;
  options?: AltCredentials;
  /** Stop the machine when a tick matches no task. Default: false. */
  stopWhenIdle?: boolean;
  /** Re-arm `once` tasks whenever the bot rejoins the server. Default: true. */
  resetOnceOnRejoin?: boolean;
  /** Log each task that runs. Default: true. */
  debug?: boolean;
  /** Used for BOT_STATUS_UPDATE on pause/resume. Defaults to bot.botId. */
  botId?: number;

  disableAutoReconnect?: boolean;
}

/* ===========================================================================
 * Bot — custom (jnbot-added) members on top of the mineflayer Bot.
 *
 * Only the PUBLIC members live here. Internal-only members (`__login`,
 * `botMachine`) are added in workerTypes.d.ts so they never reach plugins.
 * `Item` and `BotActions` are imported above purely so the app sees their real
 * types; the generator strips those imports and pluginPrelude.d.ts stubs them
 * as `any`.
 * ======================================================================== */

export type TransferItemMode =
  | 'keep'
  | 'trade'
  | 'gift'
  | 'window'
  | 'trash'
  | 0
  | 1
  | 2
  | 3
  | 4 // legacy: trade with `sendKeys: true`
  | 5;

export interface TransferItemsOptions {
  username?: string;
  command?: string;
  ignore?: (string | number)[];
  filter?: (string | number)[];
  itemFilter?: (item: Item) => boolean;
  keep?: boolean; // whether to pass/keep the item if not filtered
  sendKeys?: boolean; // Also send crate keys (trade/gift only). @default false
  keys?: string[]; // Keys to send with `sendKeys` ("<keyType>,<amount>")
  forceKeys?: boolean; // Send the keys even when no other items are in the player inventory. @default true
  timeout?: number | null;
  shiftClick?: boolean; // Whether to shift click items into window (windowBehaviour only)
}

export interface TransferItemsFn {
  (
    mode: 'keep' | 0,
    options?: TransferItemsOptions,
  ): Promise<void>;
  (
    mode: 'trade' | 'gift' | 'window' | 'trash' | 1 | 2 | 3 | 4 | 5,
    options?: TransferItemsOptions,
  ): Promise<boolean>;
  (
    mode: TransferItemMode | number,
    options?: TransferItemsOptions,
  ): Promise<boolean | void>;
  trade: (options?: TransferItemsOptions) => Promise<boolean>;
  gift: (options?: TransferItemsOptions) => Promise<boolean>;
  window: (options?: TransferItemsOptions) => Promise<boolean>;
  trash: (options?: TransferItemsOptions) => Promise<boolean>;
  /** This bot's server-specific transfer config; see {@link TransferConfig}. */
  config: TransferConfig;
  /**
   * Deep-merge overrides into this bot's transfer config. Call it from the
   * server's bot extension when a server changes its trade/gift/trash GUI.
   *
   * @example
   *   bot.transferItems.configure({
   *     gift: { command: '/send {username}', confirmButton: ['lime_dye', 'confirm'] },
   *     trash: { windowTitle: ['bin'] },
   *   });
   */
  configure: (overrides: TransferConfigOverrides) => TransferConfig;
  /** Restore the built-in defaults. */
  resetConfig: () => TransferConfig;
}

/**
 * Text pattern, matched case-insensitively with color codes stripped. Strings
 * may contain `{username}`. Pass a list to accept several titles/texts.
 */
export type TextMatcher = string | ((text: string) => boolean) | TextMatcher[];
/** Like {@link TextMatcher}, checked against the item id, display name and lore. */
export type ItemMatcher = string | ((item: Item, bot: Bot) => boolean) | ItemMatcher[];

export interface TransferConfig {
  trade: {
    /** @default '/trade {username}' */
    command: string;
    /** @default ['{username}'] */
    windowTitle: TextMatcher;
    /** Your accept button, searched on your side of the window. @default 'glass' */
    acceptButton: ItemMatcher;
    /** Fallback accept slot. @default 45 */
    acceptSlot: number;
    /** Accept button state meaning that side accepted. @default green/lime glass */
    acceptedButton: ItemMatcher;
    /** Columns (from the left) that form your side. @default 4 */
    offerColumns: number;
    /** Slots from your accept button to the partner's. @default 6 */
    partnerAcceptOffset: number;
    /** With `sendKeys`: button that opens / cycles the key page. */
    keyButton: ItemMatcher;
    /** With `sendKeys`: fallback key button slot. @default 36 */
    keySlot: number;
    /** @default 'tripwire_hook' */
    keyItem: ItemMatcher;
    /** With `sendKeys`: fallback accept slot. @default 27 */
    keyAcceptSlot: number;
  };
  gift: {
    /** @default '/gift {username}' */
    command: string;
    /** @default ['{username}'] */
    windowTitle: TextMatcher;
    /** @default ['are you sure'] */
    confirmWindowTitle: TextMatcher;
    confirmButton: ItemMatcher;
    /** Fallback confirm slot. @default 11 */
    confirmSlot: number;
    /** @default ['select items to send'] */
    depositWindowTitle: TextMatcher;
    /** With `sendKeys`: item name that opens the key page. @default 'send crate keys' */
    keyButton: string | RegExp | (string | RegExp)[];
  };
  trash: {
    /** @default '/trash' */
    command: string;
    /** @default ['trash', 'disposal'] */
    windowTitle: TextMatcher;
    /** Searched in the bottom row once the window is full. @default 'delete all items' */
    confirmButton: ItemMatcher;
  };
  /** Other names a key type shows up as. @default { vote: ['voting'] } */
  keyAliases: Record<string, string[]>;
}

export type TransferConfigOverrides = {
  [K in keyof TransferConfig]?: Partial<TransferConfig[K]>;
};

/**
 * A string matches as a case-insensitive substring; RegExp and functions get the color-stripped text.
 * An array matches when any entry matches: `['kit', 'confirm']` matches "Starters Kit" and "Confirmation of trade".
 */
export type ItemTextFilter =
  | string
  | RegExp
  | ((text: string) => boolean)
  | (string | RegExp | ((text: string) => boolean))[];

/** `bot.items()` filter: a name filter, an item predicate, or an object (all given fields must match). */
export type ItemQueryFilter =
  | ItemTextFilter
  | ((item: Item) => boolean)
  | {
      /** Custom (display) name. */
      name?: ItemTextFilter;
      /** Lore, lines joined with `\n`. */
      lore?: ItemTextFilter;
      /** Minecraft item id(s), e.g. `'diamond_sword'`. */
      type?: string | string[];
      where?: (item: Item) => boolean;
      /** Match strings case-sensitively (colors are still stripped). */
      caseSensitive?: boolean;
    };

/** Lazy, chainable item search. Scope methods return the same query; iterate with `for…of`. */
export interface ItemQuery extends Iterable<Item> {
  /** Container slots, then the player inventory (default). Without a window: only the inventory. */
  any(): ItemQuery;
  /** Only the top part of the open window; nothing when no window is open. */
  container(): ItemQuery;
  /** Only the player inventory, whether or not a window is open. */
  inventory(): ItemQuery;
  /** Only the 9 hotbar slots. */
  hotbar(): ItemQuery;
  /** Container rows (0-based, 9 slots each). With `cols`, only slots in both. */
  rows(...rows: number[]): ItemQuery;
  /** Container columns (0-8). */
  cols(...cols: number[]): ItemQuery;
  /** Exact window slot indexes. */
  slots(...slots: number[]): ItemQuery;
  first(): Item | null;
  all(): Item[];
  has(): boolean;
  /** Sum of `item.count` over all matches. */
  count(): number;
  /** Clicks the first match and returns it, or null when nothing matched. */
  click(mouseButton?: number, mode?: number): Promise<Item | null>;
  /** Resolves with the first match as soon as it appears (also in a window opened later), or null after `ticks` (default 100). */
  wait(ticks?: number): Promise<Item | null>;
}

export type BotPluginExtensions = {
  botId: number;
  mainVersion: number;
  join: (gamemode: string, options?: Record<string, unknown>) => Promise<void>;
  isOnline: () => boolean;
  /** Current gamemode from the detector, else the last gamemode a join confirmed. */
  getGamemode: () => string | null;
  /**
   * Replace how this bot enters a gamemode; used by `bot.join`, `BotMachine`
   * and `Bot.join({ gamemode })`. Set it from the profile's on-join action,
   * before any `await`. Pass `null` to restore the built-in flow.
   *
   * @example
   *   bot.setJoinHandler(async (gamemode, bot) => {
   *     bot.chat(`/warp ${gamemode}`);
   *     await bot.waitForTicks(40);
   *   });
   */
  setJoinHandler: (handler: JoinHandler | null) => void;
  /**
   * Tell `bot.getGamemode()` how to read the current gamemode on this server.
   *
   * @example
   *   bot.setGamemodeDetector((bot) => bot.scoreboard.sidebar?.title ?? null);
   */
  setGamemodeDetector: (detector: GamemodeDetector | null) => void;
  itemInfo: {
    (item: Item | null): { name: string; info: string };
    /** Only the custom name (cheaper than the full call). */
    name(item: Item | null): string;
    /** Only the lore, lines joined with `\n`. */
    lore(item: Item | null): string;
  };
  login: (password?: string) => Promise<void>; // Only works if you call this in the start of bot
  /**
   * Send a command that opens a GUI and wait for the matching window. Prefer
   * this over manually combining `bot.chat(command)` with `windowOpen` waits.
   */
  openWindow: (
    command: string,
    options?: {
      timeout?: number;
      check?: (window: unknown) => boolean;
      commandInverval?: number;
      ticks?: number;
      signal?: { aborted: boolean };
    },
  ) => Promise<unknown | null>;
  transferItems: TransferItemsFn;
  /**
   * Search items by name, lore or type in the open window and/or the player inventory.
   * Strings match as a case-insensitive substring after stripping `§` color codes and
   * small caps (`'kit'` matches `§6ᴋɪᴛ Warrior`). Results are lazy and plain `Item`s.
   *
   * @example
   *   const kit = bot.items('kit').first();                 // window first, then inventory
   *   const button = bot.items(['confirm', 'accept']).first(); // any of these
   *   await bot.items({ name: 'shard', lore: 'buy' }).container().click();
   *   const diamonds = bot.items({ type: 'diamond' }).inventory().count();
   *   const confirm = await bot.items('Confirm').wait(40);  // null after 40 ticks
   */
  items: (query?: ItemQueryFilter) => ItemQuery;
  /** Strips color codes and small caps and lowercases, e.g. `'§lᴋɪᴛ'` → `'kit'`. */
  cleanText: (text: string) => string;
  /** @deprecated Use `bot.items(query)`, e.g. `bot.items('Diamond').first()`. */
  findWindowSlots: (
    filter: { name?: string; lore?: string } | string,
    options?: {
      caseSensitive?: boolean;
      rows?: number[] | null;
      columns?: number[] | null;
      slotRange?: number[] | null;
      window?: { slots: (Item | null)[]; inventoryStart: number };
      toAlpha?: boolean;
    },
  ) => Item[];
  openInventory: () => void;
  onceWithTimeout: <K extends string>(
    event: K,
    timeoutInTicks: number,
  ) => Promise<unknown>;
  getWindowTitle: (window?: unknown) => string | null;
  hasFullInventory: () => boolean;
  countInventoryItems: () => number;
  dumpChunk: (chunk: unknown) => number[];
  dumpChunkWithPos: (
    chunk: unknown,
    position: { x: number; y: number; z: number },
  ) => number[];
  actions: BotActions;
};

interface Behaviour {
  shouldTrigger: (bot?: Bot | null, targets?: any) => boolean;
  action:
    | (() => void)
    | (() => Promise<void>)
    | Statemachine
    | (() => Statemachine)
    | Array<() => Promise<any>>;
  name: string;
  once?: boolean;
  ignore?: boolean;
}

interface StatemachineOptions {
  delay?: number;
  stopOnIdle?: boolean;
  resetOnceOnEnd?: boolean;
  targets?: any;
  debug?: boolean;
  extensions?: {
    reconnect?: boolean;
    rejoinGm?: boolean;
  };
}

/**
 * @deprecated use `BotMachine` (from require('JNbot')) instead
 */
interface Statemachine {
  active: boolean;
  bot: Bot | null;
  targets: any;
  behaviours: Behaviour[];
  onFinishCallbacks: any[];
  options: StatemachineOptions;
  new (behaviours?: Behaviour[], options?: StatemachineOptions): Statemachine;
  addBehaviour(behaviour: Behaviour): void;
  onFinish(cb: any): void;
  resetOnce(): void;
  activate(): this;
  start(): this;
  callStopCallbacks(bot?: Bot | null, targets?: any): void;
  stop(bot?: Bot | null, targets?: any): void;
  interrupt(reason?: string): void;
  clock(): Promise<void>;
  trigger(
    bot?: Bot | null,
    targets?: any,
    behaviours?: Behaviour[],
  ): Promise<void>;
}

/** The account / connection options used to create a bot. */
interface BotProfile {
  username: string;
  host?: string;
  port?: number;
  version?: string;
  plugins?: any;
  password?: string;
  auth?: string;
  onMsaCode?: (code: any) => void;
  [k: string]: unknown;
}

/** Options controlling how a bot joins the server. */
interface JoinOptions {
  stopOnEnd?: boolean;
  gamemode?: string | null;
  joinGamemode?: boolean;
  login?: boolean;
  verbose?: boolean;
  retryOnLoginFail?: boolean;
  onKick?: (reason: string) => void;
  onEnd?: () => void;
  joinServerTimeout?: number;
  requiresConfirmation?: boolean;
}

/** A bot handle created from a profile. Call `join()` to connect. */
interface BotHandle {
  readonly profile: BotProfile;
  /** Join the server with this bot's profile. Resolves with the connected {@link Bot}. */
  join(options?: JoinOptions): Promise<Bot>;
}

/**
 * The `Bot` class — the entry point for creating a bot and joining a server.
 *
 * @example
 *   const { Bot } = require('JNbot');
 *   const bot = new Bot({ username: 'Zola' });
 *   await bot.join({ gamemode: 'skyblockdream', login: true });
 *
 * @example
 *   const bot = await Bot.join({ username: 'Zola' }, { gamemode: 'skyblockdream' });
 */
interface BotConstructor {
  new (profile: BotProfile): BotHandle;
  /** Create a bot from a profile and join in one call. */
  join(profile: BotProfile, options?: JoinOptions): Promise<Bot>;
}
