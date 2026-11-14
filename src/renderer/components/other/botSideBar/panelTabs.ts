import type { ScriptSchedule } from 'common/cooldowns';
import type { MarketEntry } from 'common/share';
import type { Trigger } from 'common/triggers';
import type { Chain, ChainOptions, ModInfo, ModpackInfo } from 'main/src/types';

export const ALT_EDITOR_TAB = 'alt-editor';
export type AltEditorPanelData = {
  originalUsername?: string;
};

export const SCHEDULE_TAB = 'script-schedule';
export type SchedulePanelData = { schedule?: ScriptSchedule };

export const SHARE_TAB = 'share-link';
/**
 * A share (web link, `jnbot://share/<id>` or id) to review before installing.
 * Reviewers pass the pending `revision` and any report reasons.
 */
export type SharePanelData = {
  link: string;
  revision?: string;
  reports?: string[];
  /** Catalog entry it was opened from: shows it without downloading until Install. */
  entry?: MarketEntry;
};

export const TRIGGER_TAB = 'trigger-editor';
export type TriggerPanelData = { trigger?: Trigger };

export const CHAIN_OPTIONS_TAB = 'chain-options';
export type ChainOptionsPanelData = {
  id: string;
  options: ChainOptions;
  /** The chain's own options, shown below its run settings. */
  config?: Chain['config'];
  creating: boolean;
  onSave: (options: ChainOptions) => void;
};

export const MINECRAFT_PROJECT_TAB = 'minecraft-project';
export type MinecraftProjectPanelData =
  | {
      kind: 'launcher';
      title: string;
      modInfo: ModInfo | ModpackInfo;
      type: 'mod' | 'modpack';
      isActive: boolean;
      canManage: boolean;
      onAdd: () => Promise<void>;
      onRemove: () => Promise<void>;
    }
  | {
      kind: 'server-plugin';
      title: string;
      serverId: string;
      projectId: string;
      installedVersionId?: string;
      onInstall: (versionId?: string) => Promise<void>;
    };

export const CHANGELOG_TAB = 'changelog';
