// Server-driven input screens (sign editor, written books, 1.21.6+ dialogs) and the held map image.
// The UI gets a plain `prompt` object; dialog click actions stay here and run by button index.
const { Vec3 } = require('vec3');
const nbt = require('prismarine-nbt');
const { toChatLine } = require('./extensions/chatParts');
const { mapToPng, MAP_SIZE } = require('./mapImage');
const { prompt: askUser } = require('../compiler/scriptApi');

const MAX_MAPS = 64;
const MAP_PUBLISH_MS = 250;
// Map captchas hand the bot a map right after joining; maps held later are treated as normal items
const CAPTCHA_WINDOW_MS = 60_000;
// Wait for the map to finish drawing before showing it
const CAPTCHA_SETTLE_MS = 1000;
// Vanilla closes the sign editor beyond the block interaction range (4.5) + 4
const SIGN_EDIT_RANGE = 8.5;
const EYE_HEIGHT = 1.62;
// Click actions the UI performs itself (they need the user's clipboard/browser/chat bar)
const CLIENT_ACTIONS = new Set([
  'open_url',
  'copy_to_clipboard',
  'suggest_command',
]);

const stripNs = (id) => String(id ?? '').replace(/^minecraft:/, '');
const list = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const isFalse = (value) => value === false || value === 0;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Builds typed NBT from a simplified value (for custom_click_action payloads). */
function toNbt(value) {
  if (typeof value === 'string') return nbt.string(value);
  if (typeof value === 'boolean') return nbt.byte(value ? 1 : 0);
  if (typeof value === 'number')
    return Number.isInteger(value) ? nbt.int(value) : nbt.double(value);
  if (Array.isArray(value)) {
    const items = value.map(toNbt);
    return nbt.list(
      items.length
        ? { type: items[0].type, value: items.map((item) => item.value) }
        : undefined,
    );
  }
  return nbt.comp(
    Object.fromEntries(
      Object.entries(value ?? {}).map(([key, v]) => [key, toNbt(v)]),
    ),
  );
}

function attachScreenPrompts(bot, publish) {
  let prompt = null; // { kind: 'sign' | 'book' | 'dialog', ... }
  let dialog = null; // Server-side half of an open dialog: actions, inputs, after_action
  let signPlaced = false; // The open sign editor edits a real sign block, not a temporary one
  const dialogRegistry = []; // Synced `minecraft:dialog` registry, index = network id
  const maps = new Map(); // map id -> { colors, version }
  let mapImage = { id: null, version: -1, uri: null };
  let mapTimer = null;
  let ChatMessage;

  function toMessage(component) {
    ChatMessage ??= require('prismarine-chat')(bot.registry);
    if (Array.isArray(component))
      return new ChatMessage({ text: '', extra: component });
    return new ChatMessage(component ?? '');
  }
  const ansi = (component) => toMessage(component).toAnsi();
  function chatLine(component) {
    const { message, parts } = toChatLine(toMessage(component));
    return parts ? { message, parts } : message;
  }

  function setPrompt(next) {
    prompt = next;
    if (next?.kind !== 'dialog') dialog = null;
    publish();
  }

  // -------------------- Sign ------------------ \\
  function onOpenSign({ location, isFrontText = true }) {
    const position = new Vec3(location.x, location.y, location.z);
    const block = bot.blockAt(position);
    signPlaced = !!block?.getSignText;
    let text = '';
    try {
      text = block?.getSignText?.()[isFrontText ? 0 : 1] ?? '';
    } catch {}
    const lines = text.split('\n');
    setPrompt({
      kind: 'sign',
      position: { x: position.x, y: position.y, z: position.z },
      front: isFrontText,
      lines: [0, 1, 2, 3].map((i) => lines[i] ?? ''),
    });
  }

  function updateSign(lines = []) {
    if (prompt?.kind !== 'sign') return;
    const { position, front } = prompt;
    const text = [0, 1, 2, 3]
      .map((i) =>
        String(lines[i] ?? '')
          .replace(/\n/g, ' ')
          .slice(0, 45),
      )
      .join('\n');
    setPrompt(null);
    bot.updateSign(
      { position: new Vec3(position.x, position.y, position.z) },
      text,
      !front,
    );
  }

  /** Vanilla's per-tick validity check: the editor closes once the sign is gone or out of reach. */
  function checkSign() {
    if (prompt?.kind !== 'sign') return;
    const { x, y, z } = prompt.position;
    const block = bot.blockAt(new Vec3(x, y, z));
    const removed = signPlaced && block && !block.getSignText;
    const eye = bot.entity.position.offset(0, EYE_HEIGHT, 0);
    const tooFar =
      eye.distanceTo(new Vec3(x + 0.5, y + 0.5, z + 0.5)) > SIGN_EDIT_RANGE;
    if (removed || tooFar) clear();
  }

  // -------------------- Book ------------------ \\
  function readBook(item) {
    const content = item?.componentMap?.get('written_book_content')?.data;
    if (content) {
      return {
        title: content.rawTitle ?? '',
        pages: content.pages.map((page) =>
          chatLine(nbt.simplify(page.content)),
        ),
      };
    }
    const tag = item?.nbt ? nbt.simplify(item.nbt) : null;
    if (!Array.isArray(tag?.pages)) return null;
    return {
      title: tag.title ?? '',
      pages: tag.pages.map((page) => chatLine(parseJson(page))),
    };
  }

  function onOpenBook({ hand }) {
    const book = readBook(hand === 1 ? bot.inventory.slots[45] : bot.heldItem);
    if (book?.pages.length) setPrompt({ kind: 'book', ...book });
  }

  // -------------------- Dialog ------------------ \\
  function onRegistryData({ id, entries }) {
    if (stripNs(id) !== 'dialog') return;
    dialogRegistry.length = 0;
    for (const { key, value } of entries)
      dialogRegistry.push({ key, dialog: value ? nbt.simplify(value) : null });
  }

  function resolveDialog(ref) {
    if (typeof ref === 'number') return dialogRegistry[ref]?.dialog ?? null;
    if (typeof ref === 'string') {
      const key = ref.includes(':') ? ref : `minecraft:${ref}`;
      return dialogRegistry.find((entry) => entry.key === key)?.dialog ?? null;
    }
    return ref ?? null;
  }

  function normalizeInput(input) {
    const type = stripNs(input.type);
    const base = {
      key: input.key,
      type,
      label: ansi(input.label ?? ''),
      showLabel: !isFalse(input.label_visible),
    };
    switch (type) {
      case 'text':
        return {
          ...base,
          initial: input.initial ?? '',
          maxLength: input.max_length ?? 32,
          multiline: input.multiline != null,
        };
      case 'boolean':
        return { ...base, initial: Boolean(input.initial) };
      case 'single_option': {
        const options = list(input.options).map((o) =>
          typeof o === 'string' ? { id: o } : o,
        );
        return {
          ...base,
          options: options.map((o) => ({
            id: o.id,
            display: ansi(o.display ?? o.id),
          })),
          initial: Math.max(
            0,
            options.findIndex((o) => o.initial),
          ),
        };
      }
      case 'number_range':
        return {
          ...base,
          start: input.start,
          end: input.end,
          step: input.step,
          initial: input.initial ?? (input.start + input.end) / 2,
        };
      default:
        return null;
    }
  }

  function dialogButtons(d, type) {
    switch (type) {
      case 'notice':
        return [d.action ?? { label: { translate: 'gui.ok' } }];
      case 'confirmation':
        return [d.yes, d.no];
      case 'multi_action':
        return list(d.actions);
      case 'dialog_list':
        // Tags (#namespace:tag) can't be resolved client-side without the tags packet
        return list(d.dialogs)
          .filter((ref) => !(typeof ref === 'string' && ref.startsWith('#')))
          .map(resolveDialog)
          .filter(Boolean)
          .map((target) => ({
            label: target.external_title ?? target.title,
            width: d.button_width,
            action: { type: 'show_dialog', dialog: target },
          }));
      default:
        return []; // server_links: only the exit button
    }
  }

  function openDialog(d) {
    const type = stripNs(d?.type);
    if (!type) return;
    const buttons = dialogButtons(d, type).filter(Boolean);
    const exit =
      type === 'notice' || type === 'confirmation' ? null : d.exit_action;
    if (exit) buttons.push(exit);
    const inputs = list(d.inputs).map(normalizeInput).filter(Boolean);

    dialog = {
      actions: buttons.map((button) => button.action),
      escape: exit?.action,
      inputs: Object.fromEntries(
        list(d.inputs).map((input) => [input.key, input]),
      ),
      afterAction: d.after_action ?? 'close',
    };
    prompt = {
      kind: 'dialog',
      title: ansi(d.title),
      body: list(d.body).map((body) =>
        stripNs(body.type) === 'item'
          ? {
              item: {
                name: stripNs(body.item?.id),
                count: body.item?.count ?? 1,
              },
              text: body.description
                ? chatLine(body.description.contents ?? body.description)
                : undefined,
            }
          : { text: chatLine(body.contents) },
      ),
      inputs,
      buttons: buttons.map((button) => {
        const actionType = stripNs(button.action?.type);
        const value =
          button.action?.url ?? button.action?.value ?? button.action?.command;
        return {
          label: ansi(button.label),
          tooltip: button.tooltip ? ansi(button.tooltip) : undefined,
          ...(CLIENT_ACTIONS.has(actionType) &&
            value != null && {
              click: { action: actionType, value: String(value) },
            }),
        };
      }),
      columns:
        type === 'confirmation' ? 2 : type === 'notice' ? 1 : d.columns ?? 2,
      canEscape: !isFalse(d.can_close_with_escape),
    };
    publish();
  }

  function onShowDialog({ dialog: holder }) {
    openDialog(
      holder.data != null
        ? nbt.simplify(holder.data)
        : resolveDialog(holder.dialog),
    );
  }

  function onClearDialog() {
    if (prompt?.kind === 'dialog') setPrompt(null);
  }

  const runCommand = (command) =>
    bot.chat(`/${String(command ?? '').replace(/^\//, '')}`);

  function templateValue(input, value) {
    if (stripNs(input?.type) === 'boolean')
      return value ? input.on_true ?? 'true' : input.on_false ?? 'false';
    return String(value ?? '');
  }

  function payloadValue(input, value) {
    switch (stripNs(input?.type)) {
      case 'boolean':
        return nbt.byte(value ? 1 : 0);
      case 'number_range':
        return nbt.float(Number(value));
      default:
        return nbt.string(String(value ?? ''));
    }
  }

  function runDialogAction(action, values, inputs) {
    switch (stripNs(action?.type)) {
      case 'run_command':
        return runCommand(action.command);
      case 'dynamic/run_command':
        return runCommand(
          String(action.template).replace(/\$\(([a-zA-Z0-9_]+)\)/g, (_, key) =>
            templateValue(inputs[key], values[key]),
          ),
        );
      case 'custom':
        return bot._client.write('custom_click_action', {
          id: action.id,
          nbt: action.payload == null ? undefined : toNbt(action.payload),
        });
      case 'dynamic/custom': {
        const payload = toNbt(action.additions ?? {});
        for (const key of Object.keys(inputs))
          payload.value[key] = payloadValue(inputs[key], values[key]);
        return bot._client.write('custom_click_action', {
          id: action.id,
          nbt: payload,
        });
      }
      case 'show_dialog':
        return openDialog(resolveDialog(action.dialog));
    }
  }

  /** @param {{ button: number, values?: Record<string, unknown> }} data button index, or -1 to close with Escape */
  function dialogAction({ button = -1, values = {} } = {}) {
    if (prompt?.kind !== 'dialog' || (button < 0 && !prompt.canEscape)) return;
    const { actions, escape, inputs, afterAction } = dialog;
    if (button < 0 || afterAction === 'close') setPrompt(null);
    runDialogAction(button < 0 ? escape : actions[button], values, inputs);
  }

  // -------------------- Map ------------------ \\
  function mapIdOf(item) {
    if (item?.name !== 'filled_map') return null;
    const id = item.componentMap?.get('map_id')?.data;
    if (id != null) return id;
    const tag = item.nbt ? nbt.simplify(item.nbt) : null;
    return tag?.map ?? item.metadata ?? null; // 1.13+ nbt tag, before that the damage value
  }
  const heldMapId = () =>
    mapIdOf(bot.heldItem) ?? mapIdOf(bot.inventory?.slots[45]);

  function onMap({ itemDamage: id, columns, rows, x, y, data }) {
    if (!columns) return;
    let entry = maps.get(id);
    if (!entry) {
      if (maps.size >= MAX_MAPS) maps.delete(maps.keys().next().value);
      entry = { colors: new Uint8Array(MAP_SIZE * MAP_SIZE), version: 0 };
      maps.set(id, entry);
    }
    for (let row = 0; row < rows; row++)
      entry.colors.set(
        data.subarray(row * columns, (row + 1) * columns),
        (y + row) * MAP_SIZE + x,
      );
    entry.version++;
    if (id !== heldMapId()) return;
    checkCaptcha();
    // Maps in view update every few ticks; batch them
    if (!mapTimer)
      mapTimer = setTimeout(() => {
        mapTimer = null;
        publish();
      }, MAP_PUBLISH_MS);
  }

  // -------------------- Map captcha ------------------ \\
  let spawnedAt = Date.now();
  let captchaTimer = null;
  let captchaAsked = null; // `${id}:${version}` of the last map shown; a redrawn map is asked again
  let captchaPending = false;

  function onSpawn() {
    spawnedAt = Date.now();
  }

  /** Asks the user to solve a map the bot holds shortly after joining (opt-in setting). */
  function checkCaptcha() {
    if (!global.appSettings?.captcha_prompt || captchaPending) return;
    if (Date.now() - spawnedAt > CAPTCHA_WINDOW_MS || !maps.has(heldMapId()))
      return;
    clearTimeout(captchaTimer);
    captchaTimer = setTimeout(askCaptcha, CAPTCHA_SETTLE_MS);
  }

  async function askCaptcha() {
    const id = heldMapId();
    const entry = maps.get(id);
    const key = `${id}:${entry?.version}`;
    if (!entry || captchaPending || captchaAsked === key) return;
    captchaAsked = key;
    captchaPending = true;
    try {
      const { response } = await askUser({
        title: `Captcha for ${bot.username}`,
        description: 'Type the code shown on the map. It is sent in chat.',
        placeholder: 'Code',
        image: getMap(),
      });
      const answer = String(response ?? '').trim();
      if (answer) bot.chat(answer);
    } catch {
      // Cancelled; ask again only when the server draws a new map
    } finally {
      captchaPending = false;
    }
  }

  /** PNG data URI of the map the bot is holding, or null. Encoded once per map update. */
  function getMap() {
    const id = heldMapId();
    const entry = id == null ? undefined : maps.get(id);
    if (!entry) return null;
    if (mapImage.id !== id || mapImage.version !== entry.version)
      mapImage = { id, version: entry.version, uri: mapToPng(entry.colors) };
    return mapImage.uri;
  }

  // -------------------- Lifecycle ------------------ \\
  /** Closes the open prompt the way vanilla does when the screen is left. */
  function closePrompt() {
    if (prompt?.kind === 'dialog') dialogAction({ button: -1 });
    else clear();
  }

  /** Vanilla sends the sign text whenever the editor screen goes away, whatever closed it. */
  function clear() {
    if (prompt?.kind === 'sign') updateSign(prompt.lines);
    else if (prompt) setPrompt(null);
  }

  const listeners = {
    open_sign_entity: onOpenSign,
    close_window: clear,
    open_book: onOpenBook,
    registry_data: onRegistryData,
    show_dialog: onShowDialog,
    clear_dialog: onClearDialog,
    map: onMap,
  };
  for (const [packet, listener] of Object.entries(listeners))
    bot._client.on(packet, listener);
  bot.on('windowOpen', clear);
  bot.on('respawn', clear);
  bot.on('physicsTickEnd', checkSign);
  bot.on('spawn', onSpawn);
  bot.on('heldItemChanged', checkCaptcha);

  function dispose() {
    for (const [packet, listener] of Object.entries(listeners))
      bot._client.removeListener(packet, listener);
    bot.removeListener('windowOpen', clear);
    bot.removeListener('respawn', clear);
    bot.removeListener('physicsTickEnd', checkSign);
    bot.removeListener('spawn', onSpawn);
    bot.removeListener('heldItemChanged', checkCaptcha);
    clearTimeout(mapTimer);
    clearTimeout(captchaTimer);
    maps.clear();
  }

  return {
    getPrompt: () => prompt,
    getMap,
    updateSign,
    dialogAction,
    closePrompt,
    dispose,
  };
}

module.exports = { attachScreenPrompts };
