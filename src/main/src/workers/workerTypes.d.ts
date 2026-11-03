import type {
  BotEvents as MineflayerBotEvents,
  Bot as MineflayerBot,
} from 'mineflayer';
import type BotSession from './bot/BotSession';
import type { BotPluginExtensions } from 'common/types/pluginApi';
import type { BotMessenger } from './lib/BotMessenger';
import { SettingsObj, SharedSettings } from '../types';
import type {
  AutomationDocument,
  AutomationReplayOptions,
  AutomationSessionStatus,
} from '../../../common/automation';


// Add global type
declare global {
  var sharedSettings: SharedSettings;
  var settings: SettingsObj;
}

// The PUBLIC jnbot additions live in `BotPluginExtensions` (single-sourced in
// src/common/pluginApi.d.ts, which generates the plugin-facing surface). Here we
// only add the INTERNAL-only members that plugins must never see.
export type Bot = MineflayerBot &
  BotPluginExtensions & {
    __login: (password?: string) => void;
    /**
     * Internal owner of this bot's join/reconnect/control lifecycle.
     */
    session?: BotSession;
    /** Messenger endpoint scoped to this live bot instance. */
    messenger?: BotMessenger;
  };

export type BotEvents = keyof MineflayerBotEvents;
export type BotEventMap = MineflayerBotEvents;

export interface InventoryDisplayData {
  name: string;
  lore: string[];
}

export interface InventoryItemSlot {
  display: InventoryDisplayData;
  name: string;
  count: number;
  displayName: string;
}

export interface InventoryPacket {
  items: (InventoryItemSlot | null)[];
  isInventory: boolean;
  title: string;
  inventoryStart: number;
  selected: number;
  selectedItem: InventoryItemSlot | null;
  /** Window type, e.g. `minecraft:anvil` */
  type: string;
  /** Input screen the server opened (sign editor, book, dialog) */
  prompt: ScreenPrompt | null;
  /** PNG data URI of the held map */
  map: string | null;
}

/** Plain ANSI string, or parts carrying click/hover events (see chatParts.js). */
export type PromptText =
  | string
  | { message: string; parts: { text: string; click?: { action: string; value: string }; hover?: string }[] };

export type DialogInput = { key: string; label: string; showLabel: boolean } & (
  | { type: 'text'; initial: string; maxLength: number; multiline: boolean }
  | { type: 'boolean'; initial: boolean }
  | { type: 'single_option'; options: { id: string; display: string }[]; initial: number }
  | { type: 'number_range'; start: number; end: number; step?: number; initial: number }
);

export type DialogValue = string | number | boolean;

export type ScreenPrompt =
  | { kind: 'sign'; position: { x: number; y: number; z: number }; front: boolean; lines: string[] }
  | { kind: 'book'; title: string; pages: PromptText[] }
  | {
      kind: 'dialog';
      title: string;
      body: { text?: PromptText; item?: { name: string; count: number } }[];
      inputs: DialogInput[];
      buttons: { label: string; tooltip?: string; click?: { action: string; value: string } }[];
      columns: number;
      canEscape: boolean;
    };

export interface EditorBotContext {
  position: { x: number; y: number; z: number } | null;
  yaw: number | null;
  pitch: number | null;
  heldItem: string | null;
  lookingAt: {
    name: string;
    displayName: string;
    position: { x: number; y: number; z: number };
  } | null;
  window: {
    title: string | null;
    items: { slot: number; name: string; displayName: string; count: number }[];
  } | null;
}

export interface BotActions {
  chatMessage: (msg: string) => void;
  joinGamemode: (gm: string) => ReturnType<Bot['join']>;
  respawn: () => void;
  movementPacket: () => void;
  openInventory: () => Promise<unknown> | void;
  closeInventory: () => void;
  closeWindow: () => void;
  updateSign: (lines: string[]) => void;
  dialogAction: (data: { button: number; values?: Record<string, DialogValue> }) => void;
  closePrompt: () => void;
  renameItem: (name: string) => void;
  setHotbar: (hotbar: number) => Promise<void> | void;
  infoPacket: () => void;
  inventoryClick: (data: {
    slot: number;
    button?: number;
    mode?: number;
  }) => void;
  tossItems: (count?: number) => Promise<void>;
  activateItem: () => Promise<void>;
  toggleMovement: (
    movement:
      | 'forward'
      | 'back'
      | 'left'
      | 'right'
      | 'jump'
      | 'sprint'
      | 'sneak'
      | 'fly',
  ) => void;
  stopMovement: () => void;
  startPathFinder: (pos: { x: number; y?: number; z: number }) => void;
  leave: () => void;
  setHeadRotation: (angles: { yaw: number; pitch: number }) => Promise<void>;
  eat: () => Promise<void>;
  chatPacket: () => void;
  tabComplete: (str: string) => Promise<string[]>;
  login: () => Promise<void>;
  triggersPacket: () => void;
  testTrigger: (id: string) => boolean;
  runScriptAction: (opts: { id: string; arg: unknown }) => Promise<void>;
  mcpRunPluginAction: (opts: {
    id: string;
    arg: unknown[];
    optionOverrides?: Record<string, unknown>;
  }) => Promise<unknown>;
  sendInventoryPacket: () => InventoryPacket | { items: [] } | undefined;
  getChunkDump: () => Promise<[unknown[], number[][], number[]]>;
  runCode: (code: string) => Promise<void>;
  runAutomation: (options: {
    document: AutomationDocument;
    options: AutomationReplayOptions;
  }) => AutomationSessionStatus;
  controlAutomation: (options: {
    sessionId: string;
    action: 'pause' | 'resume' | 'stop';
  }) => Promise<AutomationSessionStatus>;
  editorContext: () => EditorBotContext;
  mcpRunCode: (input: { code: string; timeoutMs?: number }) => Promise<{
    result: unknown;
    logs: Array<{ type: string; message: string }>;
  }>;
}

export type BotAction = keyof BotActions;

export type BotActionArgs = {
  [K in BotAction]: Parameters<BotActions[K]>;
};

export type BotActionReturns = {
  [K in BotAction]: ReturnType<BotActions[K]>;
};
