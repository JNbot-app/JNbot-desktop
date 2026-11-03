import type { ScriptSettingsSection } from '../../general/scriptSettings/ScriptSettingsProps.d';
import type { Chain, ChainOptions } from '../../../../main/src/types';

/** Run settings a freshly created chain starts with. */
export const DEFAULT_CHAIN_OPTIONS: ChainOptions = {
  name: 'New chain',
  description: '',
  gamemode: '',
  altRange: [null, null],
  withTags: [],
  ignoreAlts: [],
  withRanks: false,
  withGkits: false,
};

/**
 * Normalize a chain into the flat {@link ChainOptions} `<ScriptSettings>`
 * expects. New chains already store options flat in `settings.scripts[id]`;
 * this also maps the legacy nested `chain.options` (with `startWith`/`endsWith`
 * /`ignoreNoRanks`/`ignoreNoGkits`) so older saved chains migrate cleanly.
 */
export function toChainOptions(chain: Chain): ChainOptions {
  const o = (chain.options ?? {}) as ChainOptions & {
    startWith?: string;
    endsWith?: string;
    ignoreNoRanks?: boolean;
    ignoreNoGkits?: boolean;
  };
  return {
    name: chain.name ?? DEFAULT_CHAIN_OPTIONS.name,
    description: o.description ?? '',
    gamemode: o.gamemode,
    altRange: o.altRange ?? [o.startWith || null, o.endsWith || null],
    withTags: o.withTags ?? [],
    ignoreAlts: o.ignoreAlts ?? [],
    withRanks: o.withRanks ?? o.ignoreNoRanks ?? false,
    withGkits: o.withGkits ?? o.ignoreNoGkits ?? false,
  };
}

/**
 * Option schema for a chain's run settings, rendered by <ScriptSettings>.
 * The ids line up 1:1 with the shared alt-filter pipeline (`filterAlts`), so
 * the chain runner hands them straight to `iterateAlts` with no translation.
 * `name` is the only non-filter field here; the description is a plain
 * form field in <ChainOptions>.
 */
export const CHAIN_OPTIONS_SCHEME: ScriptSettingsSection[] = [
  {
    name: 'General',
    options: [
      {
        id: 'name',
        type: 'input',
        label: 'Chain name',
        placeholder: 'e.g. Daily rewards',
      },
      { id: 'gamemode', type: 'gamemodeSelect', label: 'Gamemode' },
    ],
  },
  {
    name: 'Alt selection',
    options: [
      { id: 'altRange', type: 'altRange', label: 'Alt range' },
      {
        id: 'withTags',
        type: 'tagsSelect',
        label: 'Only these tags',
        defaultValue: [],
      },
      {
        id: 'ignoreAlts',
        type: 'altsSelect',
        label: 'Skip alts',
        defaultValue: [],
      },
      {
        id: 'withRanks',
        type: 'switch',
        label: 'Only alts with a rank',
        defaultValue: false,
      },
      {
        id: 'withGkits',
        type: 'switch',
        label: 'Only alts with a gkit',
        defaultValue: false,
      },
    ],
  },
];
