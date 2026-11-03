import type { GamemodeJoinBehaviour, JNdataDataSection } from '../main/src/types';
import { gamemodeKey } from './profiles';

export type { GamemodeJoinBehaviour };

export type JoinBehaviourKind = GamemodeJoinBehaviour['kind'];

export const DEFAULT_JOIN_BEHAVIOUR: GamemodeJoinBehaviour = { kind: 'auto' };
export const DEFAULT_COMMAND_TEMPLATE = '/server <gamemode>';
export const GAMEMODE_PLACEHOLDER = '<gamemode>';

export const JOIN_KIND_LABELS: Record<JoinBehaviourKind, string> = {
  auto: 'Auto',
  direct: 'Already there on connect',
  command: 'Run a command',
  selector: 'Open a server selector',
};

export const JOIN_KIND_DESCRIPTIONS: Record<JoinBehaviourKind, string> = {
  auto: 'Send the command and, if that fails, open the selector and look for the gamemode by name.',
  direct: 'No extra steps, connecting to the server already lands the bot in this gamemode.',
  command: 'Run a chat command. Use <gamemode> as a placeholder for the gamemode name.',
  selector: 'Right-click the selector item in the bot’s hotbar, then click the gamemode in the menu.',
};

export function makeDefaultBehaviour(kind: JoinBehaviourKind): GamemodeJoinBehaviour {
  switch (kind) {
    case 'auto':
      return { kind: 'auto' };
    case 'direct':
      return { kind: 'direct' };
    case 'command':
      return { kind: 'command', command: DEFAULT_COMMAND_TEMPLATE };
    case 'selector':
      return { kind: 'selector', hotbarSlot: 9, pick: 'name' };
  }
}

/** Resolve the configured behaviour for a gamemode label, with a safe default. */
export function getJoinBehaviour(
  data: Pick<JNdataDataSection, 'joinBehaviours'> | null | undefined,
  gamemode: string,
): GamemodeJoinBehaviour {
  const key = gamemodeKey(gamemode);
  return data?.joinBehaviours?.[key] ?? DEFAULT_JOIN_BEHAVIOUR;
}

/** Replace the `<gamemode>` placeholder in a command template. */
export function applyCommandTemplate(template: string, gamemode: string): string {
  if (!template) return '';
  if (template.includes(GAMEMODE_PLACEHOLDER)) {
    return template.split(GAMEMODE_PLACEHOLDER).join(gamemode);
  }
  return template;
}
