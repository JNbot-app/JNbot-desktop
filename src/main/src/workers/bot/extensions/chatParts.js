// Splits a prismarine-chat ChatMessage into interactive parts (click/hover events).
// Handles legacy (1.8-1.21.4 `clickEvent`/`hoverEvent`) and 1.21.5+ (`click_event`/`hover_event`) components.

const START = '\u0002';
const START_END = '\u0003';
const END = '\u0004';
const MARKER_RE = /\u0002(\d+)\u0003|\u0004/g;
const CODE_RE = /§(#[0-9a-fA-F]{6}|[0-9a-fk-or])/g;
const MAX_DEPTH = 8;
const CLICK_ACTIONS = new Set(['run_command', 'suggest_command', 'open_url', 'copy_to_clipboard', 'change_page']);

function motdToAnsi(ChatMessage, motd) {
  return ChatMessage.prototype.toAnsi.call({ toMotd: () => motd });
}

function getClick(json) {
  const event = json.clickEvent ?? json.click_event;
  if (!event || !CLICK_ACTIONS.has(event.action)) return undefined;
  const value = String(event.value ?? event.command ?? event.url ?? event.page ?? '');
  if (!value) return undefined;
  if (event.action === 'open_url' && !/^https?:\/\//i.test(value)) return undefined;
  return { action: event.action, value };
}

function displayName(ChatMessage, name) {
  if (name == null) return '';
  try {
    return new ChatMessage(typeof name === 'string' ? tryJson(name) : name).toMotd();
  } catch {
    return String(name);
  }
}

function tryJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function stripNamespace(id) {
  return typeof id === 'string' ? id.replace(/^minecraft:/, '') : '';
}

function hoverToMotd(ChatMessage, event) {
  const content = event.contents ?? event.value;
  switch (event.action) {
    case 'show_text':
      return content == null ? '' : new ChatMessage(content).toMotd();
    case 'show_item': {
      // 1.8-1.15: mojangson parsed by prismarine-chat, 1.16+: contents, 1.21.5+: inline
      const item = event.id ? event : content ?? {};
      const nbt = item.value?.id ? item.value : null;
      const id = stripNamespace(nbt ? nbt.id.value : item.id);
      const count = (nbt ? nbt.Count?.value : item.count) ?? 1;
      const name = nbt?.tag?.value?.display?.value?.Name?.value;
      return `${name ? displayName(ChatMessage, name) + '§r ' : ''}§7${id}${count > 1 ? ` x${count}` : ''}`;
    }
    case 'show_entity': {
      const entity = event.uuid || event.id ? event : content ?? {};
      const type = stripNamespace(entity.type ?? entity.id);
      return `${displayName(ChatMessage, entity.name)}\n§7${type}`.trim();
    }
    case 'show_achievement':
      return typeof content === 'string' ? content : '';
    default:
      return '';
  }
}

function getHover(ChatMessage, json) {
  const event = json.hoverEvent ?? json.hover_event;
  if (!event) return undefined;
  try {
    const motd = hoverToMotd(ChatMessage, event);
    return motd ? motdToAnsi(ChatMessage, motd) : undefined;
  } catch {
    return undefined;
  }
}

// Wraps the toMotd output of every node with its own events in markers so the
// formatting logic (inheritance, translate args) stays prismarine-chat's.
function markEvents(ChatMessage, node, inherited, events, patched, depth) {
  if (!node || depth > MAX_DEPTH) return;
  const json = node.json ?? {};
  const click = getClick(json);
  const hover = getHover(ChatMessage, json);
  let ctx = inherited;
  if (click || hover) {
    ctx = { click: click ?? inherited?.click, hover: hover ?? inherited?.hover };
    const index = events.push(ctx) - 1;
    node.toMotd = function (...args) {
      return START + index + START_END + ChatMessage.prototype.toMotd.apply(this, args) + END;
    };
    patched.push(node);
  }
  node.with?.forEach((child) => markEvents(ChatMessage, child, ctx, events, patched, depth + 1));
  node.extra?.forEach((child) => markEvents(ChatMessage, child, ctx, events, patched, depth + 1));
}

// Tracks the active formatting so a split part keeps the style it had in the full line.
function nextStyle(style, text) {
  for (const [, code] of text.matchAll(CODE_RE)) {
    if (code[0] === '#' || /[0-9a-fr]/.test(code)) style = code === 'r' ? '' : `§${code}`;
    else style += `§${code}`;
  }
  return style;
}

/**
 * @returns {{ message: string, parts?: { text: string, click?: { action: string, value: string }, hover?: string }[] }}
 */
function toChatLine(message) {
  const ChatMessage = message.constructor;
  const events = [];
  const patched = [];
  markEvents(ChatMessage, message, undefined, events, patched, 0);
  if (!events.length) return { message: message.toAnsi() };

  let motd;
  try {
    motd = message.toMotd();
  } finally {
    for (const node of patched) delete node.toMotd;
  }

  const parts = [];
  const stack = [];
  let style = '';
  let last = 0;
  const push = (text) => {
    if (!text) return;
    const event = events[stack[stack.length - 1]];
    const prev = parts[parts.length - 1];
    if (prev && prev.event === event) prev.motd += text;
    else parts.push({ motd: style + text, event });
    style = nextStyle(style, text);
  };
  for (const match of motd.matchAll(MARKER_RE)) {
    push(motd.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[1] !== undefined) stack.push(Number(match[1]));
    else stack.pop();
  }
  push(motd.slice(last));

  return {
    message: motdToAnsi(ChatMessage, motd.replace(MARKER_RE, '')),
    parts: parts.map(({ motd: text, event }) => ({
      text: motdToAnsi(ChatMessage, text),
      ...(event?.click && { click: event.click }),
      ...(event?.hover && { hover: event.hover }),
    })),
  };
}

module.exports = { toChatLine };
