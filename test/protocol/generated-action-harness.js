const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const XOR_KEY = Buffer.from('jnbot/profileScripts/xor-pad/2025/keep-this-stable-or-bundles-break');
const STOP = Symbol('script-stop');

/** Bundles are looked up by plugin name: their file names change whenever they are republished. */
function loadBundle(server, plugin) {
  const dir = path.join(ROOT, 'scripts/JNbot-updater/plugins', server);
  const raw = fs
    .readdirSync(dir)
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
    .find(({ info }) => info?.name?.toLowerCase() === plugin.toLowerCase());
  if (!raw) throw new Error(`No ${server} bundle named ${plugin}`);
  const compressed = Buffer.from(raw.codeObf, 'base64');
  for (let i = 0; i < compressed.length; i++) compressed[i] ^= XOR_KEY[i % XOR_KEY.length];
  return { info: raw.info, code: JSON.parse(zlib.gunzipSync(compressed)).code };
}

class FixtureBotMachine {
  constructor(tasks, options = {}) {
    this.tasks = tasks;
    this.bot = options.bot;
    this.state = options.state || {};
    this.finished = [];
  }

  onFinish(callback) { this.finished.push(callback); return this; }
  stop() { this.active = false; }

  start() {
    this.active = true;
    queueMicrotask(async () => {
      try {
        for (let count = 0; this.active && count < 50; count++) {
          const context = { bot: this.bot, state: this.state, machine: this };
          const task = this.tasks.find((candidate) => candidate.when(context));
          if (!task) throw new Error('BotMachine fixture became idle');
          await task.run(context);
        }
        if (this.active) throw new Error('BotMachine fixture exceeded 50 actions');
        this.finished.forEach((callback) => callback({ bot: this.bot, state: this.state }));
      } catch (error) { this.reject(error); }
    });
    return this;
  }
}

function createBot(server) {
  const actions = { commands: [], clicks: [], transfers: [], closedWindows: 0 };
  const bot = {
    username: 'fixture_alt', alt: { username: 'fixture_alt' }, currentWindow: null,
    inventory: {
      slots: Array(46).fill(null), inventoryStart: 9, inventoryEnd: 45,
      emptySlotCount: () => 36, firstEmptySlotRange: (start) => start,
    },
    chat(command) { actions.commands.push(command); server.command?.(bot, command); },
    async openWindow(command) { this.chat(command); },
    clickWindow(slot, button, mode) {
      actions.clicks.push({ slot, button, mode });
      server.click?.(bot, slot);
    },
    closeWindow() { actions.closedWindows++; this.currentWindow = null; },
    getWindowTitle() { return this.currentWindow?.title || ''; },
    itemInfo(item) { return { name: item.name, info: item.info || '' }; },
    getNextGkitPageSlot() { return server.nextPageSlot?.(bot) ?? -1; },
    async waitForTicks() {}, async onceWithTimeout() {},
    async join(gamemode) { actions.commands.push(`join:${gamemode}`); },
    openInventory() {}, end() {},
  };
  const transfer = async (mode, options) => actions.transfers.push({ mode, options });
  transfer.trash = async (options) => actions.transfers.push({ mode: 'trash', options });
  bot.transferItems = transfer;
  return { bot, actions };
}

function window(title, items, inventoryStart = 27) {
  const slots = Array(inventoryStart + 36).fill(null);
  for (const item of items) slots[item.slot] = item;
  return { title, slots, inventoryStart, inventoryEnd: inventoryStart + 36 };
}

async function runGeneratedAction({ serverName, plugin, settings, server }) {
  const bundle = loadBundle(serverName, plugin);
  const effects = { optionErrors: [], reminders: [], stopped: false };
  const script = {
    settings,
    optionError: (error) => effects.optionErrors.push(error),
    stop: () => { effects.stopped = true; throw STOP; },
    getCooldowns: async () => [],
    addCooldown: (cooldown) => effects.reminders.push(cooldown),
  };
  // Deprecated aliases, as in the real script runtime.
  script.getReminders = script.getCooldowns;
  script.addReminder = script.addCooldown;
  const { bot, actions } = createBot(server);
  const context = vm.createContext({
    require(name) {
      if (name.toLowerCase() === 'jnbot') {
        return { script, BotMachine: class extends FixtureBotMachine {
          constructor(tasks, options) { super(tasks, options); this.reject = context.__reject; }
        } };
      }
      throw new Error(`Generated fixture did not declare module ${name}`);
    },
    console: { log() {}, warn() {}, error() {}, success() {} },
    setTimeout, clearTimeout,
  });
  vm.runInContext(`${bundle.code}\n;globalThis.__generatedMain = main;`, context, { filename: `${bundle.info.name}.jnp` });
  await new Promise((resolve, reject) => {
    context.__reject = reject;
    Promise.resolve(context.__generatedMain(bot, settings)).then(resolve, (error) => {
      if (error === STOP) resolve();
      else reject(error);
    });
  });
  return { actions, effects, info: bundle.info };
}

async function runGeneratedScript({ serverName, plugin, settings, alts = [], httpResponse = {} }) {
  const bundle = loadBundle(serverName, plugin);
  const effects = { optionErrors: [], altUpdates: [], requests: [], stopped: false };
  const script = {
    settings,
    JNdata: { gamemodes: {} },
    optionError: (error) => effects.optionErrors.push(error),
    stop: () => { effects.stopped = true; throw STOP; },
    onExit() {},
    getAlts: () => alts,
    async *forEachAlt(values) { for (const value of values) yield value; },
    requestAltUpdate: (update) => effects.altUpdates.push(update),
  };
  const context = vm.createContext({
    require(name) {
      if (name.toLowerCase() === 'jnbot') return { script, BotMachine: FixtureBotMachine };
      if (name === 'axios') return { get: async (url) => { effects.requests.push(url); return { data: httpResponse }; } };
      if (name === 'vec3') return { Vec3: class Vec3 {} };
      if (name === 'prismarine-item') return () => ({ Item: class Item {} });
      throw new Error(`Generated fixture did not declare module ${name}`);
    },
    console: { log() {}, warn() {}, error() {}, success() {} },
    setTimeout: (callback) => { queueMicrotask(callback); return 1; }, clearTimeout() {},
  });
  try {
    const completion = vm.runInContext(bundle.code, context, { filename: `${bundle.info.name}.jnp` });
    await completion;
  } catch (error) {
    if (error !== STOP) throw error;
  }
  return { effects, info: bundle.info };
}

module.exports = { runGeneratedAction, runGeneratedScript, window };
