/**
 * Engine adapter around a real Mineflayer bot (with the patched physics and the
 * app's movement extensions), fed from a recording instead of a server.
 *
 * Every engine (a future Rust/WASM core included) implements the same shape:
 *   receive(packets)        apply server packets (they are handled before the tick)
 *   predict(inputs)         side-effect free simulation of one tick per input; returns
 *                           the position after each tick (input inference)
 *   applyInput(input)       set keys, look, mouse, hotbar and screens for the coming tick (inputs.js)
 *   step()                  run exactly one client tick
 *   takeSent()              client packets written since the last call
 *   errors                  exceptions the engine threw while replaying
 *   state()                 { ready, skip?, x, y, z, vx, vy, vz, onGround }
 *   syncPosition(pos)       snap to the recorded position, keep velocity
 *   surroundings()          optional: non-air blocks around the player, for debugging
 *   close()
 */
const { EventEmitter } = require('events');
const path = require('path');
const mineflayer = require('mineflayer');
const conv = require('mineflayer/lib/conversions');
const { PlayerState } = require('prismarine-physics');
const { VirtualClock } = require('../clock');

const TICK_MS = 50;
const EXTENSIONS_DIR = path.resolve(__dirname, '../../../src/main/src/workers/bot/extensions');
/** App bot plugins that change how the bot moves or which packets it sends per tick. */
const APP_EXTENSIONS = [
  'packetThreadExtension',
  'mouseExtension',
  'abilitiesExtension',
  'realisticMotionExtension',
];
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];

/** Stands in for a minecraft-protocol client: emits server packets, records writes. */
class ReplayClient extends EventEmitter {
  constructor(version, clock) {
    super();
    this.version = version;
    this.state = 'play';
    this.username = 'Replay';
    this.uuid = '00000000-0000-0000-0000-000000000000';
    this.wait_connect = false;
    this.sent = [];
    this.clock = clock;
  }
  write(name, params) {
    this.sent.push({ name, params, t: this.clock.now, state: this.state });
  }
  writeRaw() {}
  writeChannel() {}
  registerChannel() {}
  chat() {}
  end(reason) {
    this.emit('end', reason);
  }
  /** Emit like node-minecraft-protocol: 'packet' then '<name>' with shared metadata. */
  receive(name, params, state) {
    this.state = state;
    const meta = { name, state, size: 0 };
    this.emit('packet', params, meta, Buffer.alloc(0), Buffer.alloc(0));
    this.emit(name, params, meta);
  }
}

function createMineflayerEngine({ version, extensions = true }) {
  const clock = new VirtualClock().install();
  const client = new ReplayClient(version, clock);
  /** Errors thrown by bot code while handling packets or ticking. */
  const errors = [];
  clock.onError = (error) => errors.push(error);
  let bot;
  try {
    bot = mineflayer.createBot({
      client,
      version,
      username: client.username,
      auth: 'offline',
      hideErrors: true,
      logErrors: false,
      respawn: false,
    });
  } catch (error) {
    clock.uninstall();
    throw error;
  }
  const plugins = extensions
    ? APP_EXTENSIONS.map((name) => require(path.join(EXTENSIONS_DIR, `${name}.js`)))
    : [];
  // The client's crosshair is from its last rendered frame. When it ran two ticks in one
  // frame, the second aims with the view of the tick before. applyInput spots that from the
  // client's target and has the mouse aim with that view for the tick.
  let lastView = null; // { position, yaw, pitch } at the start of the previous tick
  let aimWithLastView = false;
  let replaced = null;
  const viewOf = () => ({ position: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch });
  const setView = ({ position, yaw, pitch }) => Object.assign(bot.entity, { position, yaw, pitch });
  bot.once('inject_allowed', () => {
    bot.prependListener('physicsTickStart', () => {
      const view = viewOf();
      if (aimWithLastView && lastView) {
        replaced = view;
        setView(lastView);
      }
      lastView = { ...view, position: view.position.clone() };
    });
    bot.loadPlugins(plugins);
    // After the mouse (an app plugin) aimed: back to the real view before the player moves.
    bot.on('physicsTickStart', () => {
      if (replaced) setView(replaced);
      replaced = null;
      aimWithLastView = false;
    });
    // Replay applies the recorded look as is; mineflayer's turn rate limit is a bot feature.
    bot.physics.yawSpeed = Infinity;
    bot.physics.pitchSpeed = Infinity;
  });

  /** Whether the client's target (inputs.js mouse.target) is what the last tick's view aims at, and not the current one. */
  function aimedWithLastView(target) {
    if (!target || !lastView || !bot.mouse?.target) return false;
    const aimAt = (view) => {
      const real = viewOf();
      setView(view);
      const hit = bot.mouse.target();
      setView(real);
      return hit?.block ? `${hit.block.position.x},${hit.block.position.y},${hit.block.position.z}` : hit?.entity ? `#${hit.entity.id}` : 'none';
    };
    const now = aimAt(viewOf());
    const before = aimAt(lastView);
    if (target.keep) return now !== before;
    const wanted = target.block ?? (target.entity !== undefined ? `#${target.entity}` : 'none');
    return now !== wanted && before === wanted;
  }
  clock.advance(0); // inject_allowed is emitted from a timeout

  let alive = true;
  bot.on('death', () => (alive = false));
  bot.on('spawn', () => (alive = true));
  const world = { getBlock: (pos) => bot.blockAt(pos, false) };

  /** Next physics tick, or a plain tick length before the bot has joined. */
  const nextTickAt = () => clock.nextIntervalDue(TICK_MS) ?? clock.now + TICK_MS;

  return {
    name: extensions ? 'mineflayer+app' : 'mineflayer',
    bot,
    errors,

    receive(packets) {
      for (const packet of packets) {
        try {
          client.receive(packet.name, packet.params, packet.state);
        } catch (error) {
          errors.push(error);
        }
      }
      // Let deferred handlers (the packet-thread frame) run before the tick.
      clock.advanceTo(nextTickAt() - 1);
    },

    predict(inputs) {
      if (!bot.entity?.position || !bot.physics) return undefined;
      const state = new PlayerState(bot, controlsOf(inputs[0]));
      return inputs.map((input) => {
        state.control = controlsOf(input);
        if (input.yaw !== undefined) state.yaw = conv.fromNotchianYaw(input.yaw);
        if (input.pitch !== undefined) state.pitch = conv.fromNotchianPitch(input.pitch);
        bot.physics.simulatePlayer(state, world);
        return { x: state.pos.x, y: state.pos.y, z: state.pos.z, onGround: state.onGround };
      });
    },

    applyInput(input) {
      if (!bot.entity?.position) return;
      for (const key of KEYS) {
        const value = Boolean(input[key]);
        if (bot.getControlState(key) !== value) bot.setControlState(key, value);
      }
      if (input.yaw !== undefined) bot.entity.yaw = conv.fromNotchianYaw(input.yaw);
      if (input.pitch !== undefined) bot.entity.pitch = conv.fromNotchianPitch(input.pitch);
      if (input.hotbar !== undefined) bot.setQuickBarSlot(input.hotbar);
      if (input.closeWindow !== undefined && bot.currentWindow?.id === input.closeWindow) bot.closeWindow(bot.currentWindow);
      if (bot.mouse && input.mouse) {
        for (const button of ['left', 'right']) applyButton(bot.mouse, button, input.mouse[button]);
        aimWithLastView = aimedWithLastView(input.mouse.target);
      }
    },

    step() {
      clock.advanceTo(nextTickAt());
    },

    takeSent() {
      return client.sent.splice(0);
    },

    state() {
      const entity = bot.entity;
      if (!entity?.position || !Number.isFinite(entity.position.x)) return { ready: false, skip: 'not-spawned' };
      const base = {
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
        vx: entity.velocity.x,
        vy: entity.velocity.y,
        vz: entity.velocity.z,
        onGround: entity.onGround,
      };
      if (!alive) return { ...base, ready: false, skip: 'dead' };
      if (bot.vehicle) return { ...base, ready: false, skip: 'vehicle' };
      if (!bot.blockAt(entity.position, false)) return { ...base, ready: false, skip: 'chunk-missing' };
      return { ...base, ready: true };
    },

    surroundings(radius = 1) {
      const pos = bot.entity?.position;
      if (!pos) return [];
      const blocks = [];
      for (let dy = -1; dy <= 2; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          for (let dz = -radius; dz <= radius; dz++) {
            const block = bot.blockAt(pos.offset(dx, dy, dz).floored(), false);
            if (block && !block.name.endsWith('air'))
              blocks.push({ x: block.position.x, y: block.position.y, z: block.position.z, name: block.name, shapes: block.shapes });
          }
      return blocks;
    },

    syncPosition({ x, y, z }) {
      bot.entity?.position.set(x, y, z);
    },

    close() {
      try {
        bot.emit('end', 'replay finished');
        bot.removeAllListeners();
      } finally {
        clock.uninstall();
      }
    },
  };
}

/** Presses (clicks, released again unless held) then holds or releases the button for the tick. */
function applyButton(mouse, button, { held, presses }) {
  for (let i = 0; i < presses; i++) {
    if (mouse.isDown(button)) mouse.release(button);
    mouse.press(button);
    if (i < presses - 1) mouse.release(button);
  }
  if (!held) mouse.release(button);
  else if (!mouse.isDown(button)) mouse.press(button);
}

function controlsOf(input) {
  return Object.fromEntries(KEYS.map((key) => [key, Boolean(input[key])]));
}

module.exports = { createMineflayerEngine, APP_EXTENSIONS };
