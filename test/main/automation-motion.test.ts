import { EventEmitter } from 'events';
import { Vec3 } from 'vec3';
import {
  createAutomationDocument,
  type AutomationStep,
} from '../../src/common/automation';
import type { AutomationExecutionContext } from '../../src/common/AutomationPlayer';
import McClientAutomationAdapter from '../../src/main/src/functions/minecraft/automation/McClientAutomationAdapter';
import MineflayerAutomationAdapter from '../../src/main/src/workers/bot/automation/MineflayerAutomationAdapter';

const document = createAutomationDocument({
  id: 'motion',
  name: 'Motion',
  origin: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
});
const controller = new AbortController();
const context: AutomationExecutionContext = {
  document,
  options: { spatialMode: 'relative' },
  replayOrigin: { x: 0, y: 64, z: 0, yaw: 0 },
  signal: controller.signal,
};
const motion: Extract<AutomationStep, { kind: 'movePath' }> = {
  id: 'motion-step',
  enabled: true,
  atMs: 50,
  kind: 'movePath',
  points: [
    {
      absolute: { x: 0, y: 64, z: 0.2 },
      relative: { x: 0, y: 0, z: 0.2 },
      atMs: 50,
      tick: 1,
      yaw: 0,
      pitch: 0,
      onGround: true,
      forward: true,
    },
    {
      absolute: { x: 0, y: 64, z: 0.4 },
      relative: { x: 0, y: 0, z: 0.4 },
      atMs: 100,
      tick: 2,
      yaw: 0,
      pitch: 0,
      onGround: true,
      forward: false,
    },
  ],
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('automation motion replay', () => {
  test('Minecraft client sends one tick track instead of pathfinding goals', async () => {
    const request = jest.fn(async (method: string) => {
      if (method === 'mc.automation.motion.start') return { active: false };
      return {};
    });
    const client = { id: 'client-1', request };
    const adapter = new McClientAutomationAdapter(client as any);

    await adapter.execute(motion, context);

    expect(request).toHaveBeenCalledWith(
      'mc.automation.motion.start',
      expect.objectContaining({
        frames: expect.arrayContaining([
          expect.objectContaining({
            tick: 1,
            forward: true,
            x: 0,
            y: 64,
            z: 0.2,
          }),
        ]),
      }),
    );
    expect((client as any).goto).toBeUndefined();
  });

  test('Minecraft client clicks the recorded slot even when its recorded item is gone', async () => {
    const clickSlot = jest.fn(async () => undefined);
    const client = {
      id: 'client-1',
      getCurrentWindow: jest.fn(async () => ({ syncId: 12, inventory: true, slots: [{ stack: { empty: true } }] })),
      clickSlot,
    };
    const adapter = new McClientAutomationAdapter(client as any);
    const click: Extract<AutomationStep, { kind: 'windowClick' }> = {
      id: 'empty-slot', enabled: true, atMs: 0, kind: 'windowClick',
      window: { inventory: true }, slot: 7, button: 1, actionType: 'QUICK_MOVE',
      itemBefore: { itemId: 'minecraft:diamond', count: 1 },
    };

    await adapter.execute(click, context);

    expect(clickSlot).toHaveBeenCalledWith({ slot: 7, button: 1, actionType: 'QUICK_MOVE' });
  });

  test('Minecraft client replays a block interaction with its recorded face and hand', async () => {
    const activateBlock = jest.fn(async () => ({ ok: true }));
    const client = {
      id: 'client-1',
      getBlockAt: jest.fn(async () => ({ empty: false })),
      activateBlock,
    };
    const adapter = new McClientAutomationAdapter(client as any);
    const useBlock: Extract<AutomationStep, { kind: 'useBlock' }> = {
      id: 'open-chest', enabled: true, atMs: 0, kind: 'useBlock',
      position: {
        absolute: { x: -12, y: -60, z: 10 },
        relative: { x: -12, y: -124, z: 10 },
      },
      face: 'east', hand: 'main', blockBefore: 'minecraft:chest',
    };

    await adapter.execute(useBlock, context);

    expect(activateBlock).toHaveBeenCalledWith({
      x: -12, y: -60, z: 10, face: 'east', hand: 'main',
    });
  });

  test('Mineflayer advances controls only on physics ticks', async () => {
    const bot = Object.assign(new EventEmitter(), {
      botId: 1,
      username: 'Bot',
      entity: {
        position: new Vec3(0, 64, 0),
        yaw: Math.PI,
        pitch: 0,
        onGround: true,
      },
      setControlState: jest.fn(),
      clearControlStates: jest.fn(),
      stopDigging: jest.fn(),
      deactivateItem: jest.fn(),
      look: jest.fn(async () => undefined),
    });
    const adapter = new MineflayerAutomationAdapter(bot as any);
    let completed = false;
    const replay = adapter.execute(motion, context).then(() => {
      completed = true;
    });

    await flush();
    expect(completed).toBe(false);
    expect(bot.setControlState).toHaveBeenCalledWith('forward', true);

    bot.entity.position = new Vec3(0, 64, 0.2);
    bot.emit('physicsTick');
    await flush();
    expect(completed).toBe(false);
    expect(bot.setControlState).toHaveBeenCalledWith('forward', false);

    bot.entity.position = new Vec3(0, 64, 0.4);
    bot.emit('physicsTick');
    await replay;
    expect(bot.clearControlStates).toHaveBeenCalled();
  });
});
