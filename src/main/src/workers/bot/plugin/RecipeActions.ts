import axios from 'axios';
import type { ControlState } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import joinBot from '../join';
import type { Bot } from '../../workerTypes';
import addPathFinder from '../pathFinderPlugin';
import {
  notification as showNotification,
  prompt as askForText,
  snackbar as showSnackbar,
  startAction,
  startPlugin as startInstalledPlugin,
  stopPlugin as stopInstalledPlugin,
  updateProgress as setPluginProgress,
} from '../../compiler/scriptApi';

export type ActionContext = {
  getBot(): Bot;
  setBot(bot: Bot): void;
};

export type ActionHandler = (
  context: ActionContext,
  inputs: Record<string, any>,
) => void | Record<string, any> | Promise<void | Record<string, any>>;

const requireNumber = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`);
  return number;
};

const position = (inputs: Record<string, any>) =>
  new Vec3(
    requireNumber(inputs.x, 'X'),
    requireNumber(inputs.y, 'Y'),
    requireNumber(inputs.z, 'Z'),
  );

const blockFaces: Record<string, Vec3> = {
  down: new Vec3(0, 1, 0),
  up: new Vec3(0, -1, 0),
  north: new Vec3(0, 0, 1),
  south: new Vec3(0, 0, -1),
  east: new Vec3(-1, 0, 0),
  west: new Vec3(1, 0, 0),
};

const nearestEntity = (bot: Bot, entityName: unknown, maxDistance: unknown) => {
  const wanted = String(entityName ?? '')
    .trim()
    .toLowerCase();
  const distance = Math.max(0, requireNumber(maxDistance ?? 4, 'Distance'));
  const entity = bot.nearestEntity((candidate) => {
    if (candidate === bot.entity) return false;
    const names = [
      candidate.name,
      candidate.displayName,
      candidate.username,
      candidate.mobType,
    ]
      .filter(Boolean)
      .map((name) => String(name).toLowerCase());
    return (
      (!wanted || names.some((name) => name.includes(wanted))) &&
      candidate.position.distanceTo(bot.entity.position) <= distance
    );
  });
  if (!entity) throw new Error('No matching entity was found nearby.');
  return entity;
};

export const recipeActions: Record<string, ActionHandler> = {
  async botJoin(context, { username, version, login }) {
    const bot = (await joinBot(
      {
        username: String(username),
        version: String(version),
      },
      { login: Boolean(login) },
    )) as Bot | null;
    if (!bot) throw new Error('Join server could not connect the bot.');
    context.setBot(bot);
    return { bot };
  },

  async botJoinGamemode(context, { gamemode }) {
    await (context.getBot() as any).join(String(gamemode), {
      optimisticJoin: true,
    }).catch((() => {}));
  },

  botChat(context, { message }) {
    context.getBot().chat(String(message));
  },

  async botMovement(context, inputs) {
    const bot = context.getBot();
    const movement = String(inputs.movement) as ControlState;
    const state = Boolean(inputs.state);
    const controls: ControlState[] = [movement];
    if (inputs.jump) controls.push('jump');
    if (inputs.sprint) controls.push('sprint');
    if (inputs.sneak) controls.push('sneak');
    controls.forEach((control) => bot.setControlState(control, state));

    const duration = requireNumber(inputs.duration ?? 0, 'Duration');
    if (state && duration > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, duration));
      controls.forEach((control) => bot.setControlState(control, false));
    }
  },

  async botLook(context, { yaw, pitch, mode }) {
    const bot = context.getBot();
    const toRadians = (degrees: unknown, label: string) =>
      (requireNumber(degrees, label) * Math.PI) / 180;
    const targetYaw =
      toRadians(yaw, 'Yaw') + (mode === 'relative' ? bot.entity.yaw : 0);
    const targetPitch =
      toRadians(pitch, 'Pitch') + (mode === 'relative' ? bot.entity.pitch : 0);
    await bot.look(targetYaw, targetPitch, true);
  },

  async botBreakBlock(context, inputs) {
    const bot = context.getBot();
    const block = bot.blockAt(position(inputs));
    if (!block) throw new Error('No loaded block exists at that position.');
    await bot.dig(block, true);
  },

  async botPlaceBlock(context, inputs) {
    const bot = context.getBot();
    if (!bot.heldItem) throw new Error('Place held block needs a held item.');
    const face = blockFaces[String(inputs.face)] ?? blockFaces.down;
    const reference = bot.blockAt(position(inputs).minus(face));
    if (!reference)
      throw new Error('The supporting block is not loaded or does not exist.');
    await bot.placeBlock(reference, face);
  },

  async botPathfind(context, inputs) {
    const bot = context.getBot();
    addPathFinder(bot);
    const target = position(inputs);
    const radius = Math.max(0, requireNumber(inputs.radius ?? 1, 'Distance'));
    await bot.pathfinder.goto(
      new goals.GoalNear(target.x, target.y, target.z, radius),
    );
  },

  botStopPathfinding(context) {
    const bot = context.getBot();
    addPathFinder(bot);
    bot.pathfinder.stop();
    bot.pathfinder.setGoal(null);
  },

  botSetHotbar(context, { slot }) {
    const selected = Math.floor(requireNumber(slot, 'Hotbar slot'));
    if (selected < 1 || selected > 9)
      throw new Error('Hotbar slot must be between 1 and 9.');
    context.getBot().setQuickBarSlot(selected - 1);
  },

  async botActivateItem(context, { ticks }) {
    const bot = context.getBot();
    bot.activateItem();
    await bot.waitForTicks(Math.max(0, requireNumber(ticks ?? 2, 'Ticks')));
    bot.deactivateItem();
  },

  botSwingArm(context, { hand }) {
    context.getBot().swingArm(hand === 'left' ? 'left' : 'right');
  },

  async botDropHeldItem(context, { entireStack }) {
    const bot = context.getBot();
    const item = bot.heldItem;
    if (!item) throw new Error('The bot is not holding an item.');
    if (entireStack) await bot.tossStack(item);
    else await bot.toss(item.type, item.metadata, 1);
  },

  async botEat(context) {
    await context.getBot().consume();
  },

  botRespawn(context) {
    context.getBot().respawn();
  },

  botCloseWindow(context) {
    const bot = context.getBot();
    if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  },


  botFindBlock(context, { blockName, maxDistance }) {
    const wanted = String(blockName)
      .replace(/^minecraft:/, '')
      .toLowerCase();
    const block = context.getBot().findBlock({
      matching: (candidate) =>
        candidate.name.toLowerCase() === wanted ||
        candidate.displayName.toLowerCase() === wanted,
      maxDistance: Math.max(1, requireNumber(maxDistance ?? 32, 'Distance')),
    });
    return {
      found: Boolean(block),
      x: block?.position.x,
      y: block?.position.y,
      z: block?.position.z,
    };
  },

  botAttackNearest(context, { entityName, maxDistance }) {
    const bot = context.getBot();
    bot.attack(nearestEntity(bot, entityName, maxDistance));
  },

  botInteractNearest(context, { entityName, maxDistance }) {
    const bot = context.getBot();
    bot.activateEntity(nearestEntity(bot, entityName, maxDistance));
  },

  async botEquipItem(context, { itemName, destination }) {
    const wanted = String(itemName)
      .replace(/^minecraft:/, '')
      .toLowerCase();
    const bot = context.getBot();
    const item = bot.inventory
      .items()
      .find(
        (candidate) =>
          candidate.name.toLowerCase() === wanted ||
          candidate.displayName.toLowerCase() === wanted,
      );
    if (!item)
      throw new Error(`No inventory item named "${itemName}" was found.`);
    await bot.equip(item, String(destination) as any);
  },

  botOpenInventory(context) {
    context.getBot().openInventory();
  },

  botClearMovement(context) {
    context.getBot().clearControlStates();
  },

  async botWindowClick(context, inputs) {
    const bot = context.getBot();
    let slotId: string | number = inputs.slotId;
    if (typeof slotId === 'string' && !/^\d+$/.test(slotId)) {
      const window = bot.currentWindow ?? bot.inventory;
      const item = window?.findItemRangeName(
        0,
        window.slots.length,
        slotId,
        null,
        false,
      );
      if (!item) throw new Error(`No item named "${slotId}" was found.`);
      slotId = item.slot;
    }
    await bot.clickWindow(
      requireNumber(slotId, 'Slot'),
      requireNumber(inputs.button ?? 0, 'Mouse button'),
      requireNumber(inputs.mode ?? 0, 'Click mode'),
    );
  },

  async botTransferItems(context, { mode, username }) {
    if (!['trade', 'gift', 'window', 'trash'].includes(mode)) {
      throw new Error(`Unknown transfer mode: ${mode}`);
    }
    if (mode !== 'trash' && !username) {
      throw new Error('Transfer items needs a player username or command.');
    }
    await context.getBot().transfer(mode, mode === 'trash' ? undefined : username);
  },

  async botWait(context, { ticks }) {
    const count = requireNumber(ticks, 'Ticks');
    if (count < 0) throw new Error('Ticks cannot be negative.');
    await context.getBot().waitForTicks(count);
  },

  async delay(_context, { delay }) {
    const milliseconds = requireNumber(delay, 'Wait duration');
    if (milliseconds < 0) throw new Error('Wait duration cannot be negative.');
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  },

  botLeave(context) {
    context.getBot().end();
  },

  log(_context, { message }) {
    (global.log ?? console.log)(message);
  },

  async runScriptAction(context, { actionId, argument }) {
    const result = await startAction({
      actionId: String(actionId),
      bot: context.getBot(),
      args: argument === undefined || argument === '' ? [] : [argument],
    });
    return { result };
  },

  notification(_context, { type, title, message }) {
    showNotification({
      type: String(type),
      title: String(title),
      message: String(message ?? ''),
    });
  },

  snackbar(_context, { type, title }) {
    showSnackbar({ type: String(type), title: String(title) });
  },

  async prompt(_context, inputs) {
    return askForText({
      title: String(inputs.title),
      label: inputs.label ? String(inputs.label) : undefined,
      placeholder: inputs.placeholder ? String(inputs.placeholder) : undefined,
      defaultValue: inputs.defaultValue
        ? String(inputs.defaultValue)
        : undefined,
      description: inputs.description ? String(inputs.description) : undefined,
    });
  },

  updateProgress(_context, { current, total }) {
    setPluginProgress({ current, total });
  },

  startPlugin(_context, { pluginId, name }) {
    startInstalledPlugin({
      pluginId: String(pluginId),
      name: name ? String(name) : String(pluginId),
    });
  },

  stopPlugin(_context, { pluginId }) {
    stopInstalledPlugin({ pluginId: String(pluginId) });
  },

  randomNumber(_context, { minimum, maximum, wholeNumber }) {
    const first = requireNumber(minimum, 'Minimum');
    const second = requireNumber(maximum, 'Maximum');
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    const value = min + Math.random() * (max - min);
    return { value: wholeNumber ? Math.floor(value) : value };
  },

  currentTime() {
    const now = new Date();
    return { timestamp: now.getTime(), iso: now.toISOString() };
  },

  async discordEmbed(_context, { webhookUrl, title, description }) {
    if (!webhookUrl) throw new Error('Discord webhook URL is required.');
    // Keep this action independent from discord.js. It only sends a webhook
    // payload, so importing the Discord client library would unnecessarily
    // make otherwise mobile-safe bot workers touch the mobile Discord shim.
    const embed = {
      title: String(title),
      ...(description ? { description: String(description) } : {}),
      timestamp: new Date().toISOString(),
      footer: { text: 'Powered by JNbot' },
    };
    await axios.post(String(webhookUrl), { embeds: [embed] });
  },
};

export function getRecipeActionHandler(actionId: string): ActionHandler {
  const handler = recipeActions[actionId];
  if (!handler) throw new Error(`Action "${actionId}" is not implemented.`);
  return handler;
}
