import {
  createAutomationDocument,
  type AutomationDocument,
} from '../../src/common/automation';
import AutomationService from '../../src/main/src/functions/AutomationService';

describe('AutomationService recording lifecycle', () => {
  test('keeps consecutive movement samples in one path', () => {
    (global as any).send = jest.fn();
    const document = createAutomationDocument({
      id: 'movement',
      name: 'Movement',
    });
    const bridge = {
      onRawClientEvent: jest.fn(),
      onClientDisconnected: jest.fn(),
    };
    const service = new AutomationService(
      {} as any,
      bridge as any,
      {} as any,
    );
    const startedAt = Date.now();
    (service as any).recordingsByClient.set('client-1', {
      sessionId: 'recording-1',
      clientId: 'client-1',
      document,
      startedAt,
      pausedMs: 0,
      state: 'recording',
    });

    for (let index = 1; index <= 8; index += 1)
      (service as any).capture('client-1', {
        kind: 'move',
        ts: startedAt + index * 50,
        tick: index,
        position: { x: 0, y: index === 4 ? 65.2 : 64, z: index / 4 },
        velocity: { x: 0, y: index === 4 ? 0.4 : 0, z: 0.2 },
        yaw: 0,
        pitch: 0,
        onGround: index !== 4,
        forward: true,
        jump: index >= 3 && index <= 5,
      });

    expect(document.steps).toHaveLength(1);
    expect(document.steps[0]).toMatchObject({
      kind: 'movePath',
      points: expect.arrayContaining([
        expect.objectContaining({ atMs: 50, tick: 1, forward: true }),
        expect.objectContaining({
          atMs: 200,
          tick: 4,
          onGround: false,
          jump: true,
          velocity: { x: 0, y: 0.4, z: 0.2 },
        }),
      ]),
    });
  });

  test('keeps the recorded screen context for slot clicks', () => {
    (global as any).send = jest.fn();
    const document = createAutomationDocument({ id: 'click', name: 'Click' });
    const service = new AutomationService({} as any, { onRawClientEvent: jest.fn(), onClientDisconnected: jest.fn() } as any, {} as any);
    const startedAt = Date.now();
    (service as any).recordingsByClient.set('client-1', { sessionId: 'recording-1', clientId: 'client-1', document, startedAt, pausedMs: 0, state: 'recording' });

    (service as any).capture('client-1', { kind: 'windowClick', ts: startedAt, inventory: true, windowTitle: 'Crafting', windowType: 'minecraft:inventory', slot: 36, button: 0, actionType: 'PICKUP' });

    expect(document.steps[0]).toMatchObject({ kind: 'windowClick', window: { inventory: true, title: 'Crafting', type: 'minecraft:inventory' }, slot: 36 });
  });

  test('a rejected capture start does not leave the client marked as recording', async () => {
    const pluginId = 'recordingplugin';
    const info = {
      pluginId,
      name: 'Recording',
      language: 'recording',
      editedAt: Date.now(),
    };
    const document: AutomationDocument = createAutomationDocument({
      id: pluginId,
      name: info.name,
    });
    const macros = {
      readPluginInfo: jest.fn(() => info),
      getMacro: jest.fn(() => ({
        status: 'success',
        info,
        code: document,
      })),
      toList: jest.fn(() => []),
      send: jest.fn(),
    };
    const request = jest.fn((method: string) => {
      if (method === 'mc.automation.capture.start')
        return Promise.reject(
          new Error('Unknown action: mc.automation.capture.start'),
        );
      return Promise.resolve({});
    });
    const client = {
      request,
      getCurrentPosition: jest.fn(async () => ({
        x: 0,
        y: 64,
        z: 0,
        yaw: 0,
        pitch: 0,
      })),
      getWorldInfo: jest.fn(async () => ({ dimension: 'overworld' })),
      apiVersion: jest.fn(async () => ({ mcVersion: '1.21.4' })),
    };
    const bridge = {
      onRawClientEvent: jest.fn(),
      onClientDisconnected: jest.fn(),
      getClient: jest.fn(() => client),
      getClients: jest.fn(() => [
        { clientId: 'client-1', username: 'Steve' },
      ]),
      subscribeSystemClientEvent: jest.fn(),
      unsubscribeSystemClientEvent: jest.fn(),
    };
    const sessions = { list: jest.fn(() => []) };
    const service = new AutomationService(
      macros as any,
      bridge as any,
      sessions as any,
    );

    await expect(
      service.startRecording('client-1', pluginId),
    ).rejects.toThrow('does not support task recording');
    await expect(
      service.startRecording('client-1', pluginId),
    ).rejects.toThrow('does not support task recording');

    expect(
      request.mock.calls.filter(
        ([method]) => method === 'mc.automation.capture.start',
      ),
    ).toHaveLength(2);
    expect(request).toHaveBeenCalledWith('mc.automation.capture.stop');
  });
});
