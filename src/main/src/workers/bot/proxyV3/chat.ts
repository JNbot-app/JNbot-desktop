/**
 * Send a system message to the client, with the packet shape the client's
 * protocol actually expects.
 *
 * Rather than hand-building chat components, we let the libraries do it from the
 * protocol definition: `minecraft-data`'s `supportFeature` tells us how chat is
 * encoded for `client.version`, and `prismarine-nbt` builds the component value
 * for the NBT era (1.20.3+). A bare string tag is a valid chat component, which
 * is all our `/jnbot` command replies need (plain, optionally §-coloured text).
 */
import minecraftData from 'minecraft-data';
import nbt from 'prismarine-nbt';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** The system chat (or action bar) packet for `version`, or undefined when it has no chat data. */
export function systemChatPacket(
  version: string | number,
  message: string,
  isActionBar = false,
): [name: string, data: Record<string, unknown>] | undefined {
  const data = minecraftData(version);
  if (!data) return undefined;
  // 1.20.3+: `content` is an NBT component.
  if (data.supportFeature('chatPacketsUseNbtComponents'))
    return ['system_chat', { content: nbt.string(message), isActionBar }];
  // 1.19–1.20.2: `content` is a JSON-encoded component.
  if (data.supportFeature('signedChat'))
    return ['system_chat', { content: JSON.stringify({ text: message }), isActionBar }];
  // ≤1.18.2: the classic chat packet; position 2 is the action bar.
  return ['chat', { message: JSON.stringify({ text: message }), position: isActionBar ? 2 : 1, sender: NIL_UUID }];
}

/** Plain text of a chat component: a JSON string, a component object or NBT (1.20.3+). */
export function chatText(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return chatText(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(chatText).join('');
  if (!value || typeof value !== 'object') return value == null ? '' : String(value);
  const component = value as Record<string, unknown>;
  if ('type' in component && 'value' in component) return chatText(nbt.simplify(component as any));
  const text = component.text ?? component[''] ?? component.translate ?? '';
  const extra = Array.isArray(component.extra) ? component.extra.map(chatText).join('') : '';
  return `${typeof text === 'string' ? text : ''}${extra}`;
}
