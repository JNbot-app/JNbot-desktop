import EventEmitter from 'events';

jest.mock('../../src/main/src/functions/peer2peer/PeerConnection', () => {
  const instances: unknown[] = [];
  return {
    __esModule: true,
    default: class MockPeerConnection extends EventEmitter {
      public isActive = false;
      public url = 'https://remote.example/';
      public id = 'room-id';
      public devices: unknown[] = [];
      public closeConnection = jest.fn();
      public broadcast = jest.fn();

      constructor() {
        super();
        instances.push(this);
      }

      public async start() {
        this.isActive = true;
      }

      public stop() {
        this.isActive = false;
      }

      public setDevices(devices: unknown[]) {
        this.devices = devices;
      }
    },
    instances,
  };
});

import DeviceHandler, {
  ServerTypes,
  Status,
} from '../../src/main/src/functions/peer2peer/DeviceHandler';

const device = {
  id: 'phone-id',
  token: 'phone-token',
  name: 'My phone',
};

function setup(initialDevices = [device]) {
  (global as any).send = jest.fn();
  const settings = {
    shared: { devices: initialDevices.map((entry) => ({ ...entry })) },
    updateDevice: jest.fn((id, updated) => {
      const index = settings.shared.devices.findIndex((entry) => entry.id === id);
      if (index === -1) settings.shared.devices.push(updated);
      else settings.shared.devices[index] = updated;
    }),
    removeDevice: jest.fn((id) => {
      settings.shared.devices = settings.shared.devices.filter(
        (entry) => entry.id !== id,
      );
    }),
  };
  const clientEvents = {
    registerSocket: jest.fn(),
    unregisterSocket: jest.fn(),
    sendDetails: jest.fn(),
  };
  const handler = new DeviceHandler(clientEvents as any, settings as any);
  const { instances } = require(
    '../../src/main/src/functions/peer2peer/PeerConnection',
  );
  const connection = instances.at(-1);
  return { handler, connection, settings, clientEvents };
}

describe('DeviceHandler remote access lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates the default device once and persists it', () => {
    const { handler, settings } = setup([]);

    const first = handler.ensureDefaultDevice();
    const second = handler.ensureDefaultDevice();

    expect(first).toEqual(second);
    expect(first.name).toBe('My device');
    expect(settings.updateDevice).toHaveBeenCalledTimes(1);
    expect(Object.values(handler.getDevices())).toHaveLength(1);
  });

  test('first start publishes one ready state with the default link', async () => {
    const { handler } = setup([]);
    const update = jest.fn();
    handler.on('server:update', update);

    const result = await handler.start(ServerTypes.PEER2PEER);

    expect(result?.device.name).toBe('My device');
    expect(result?.server.status).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        peer2peer: expect.objectContaining({ status: true }),
      }),
    );
  });

  test('synchronizes new and revoked credentials with WebRTC', () => {
    const { handler, connection } = setup([]);

    const created = handler.createDevice('Tablet');
    expect(connection.devices).toEqual([
      expect.objectContaining({
        id: created.id,
        token: created.token,
        name: created.name,
        permissions: created.permissions,
      }),
    ]);

    handler.removeDevice(created.id);
    expect(connection.devices).toEqual([]);
  });

  test('stays online until the last session for a link disconnects', () => {
    const { handler, connection, settings } = setup();
    const socket = {};

    connection.emit('peer:connection', { device, peerId: 'peer-1' }, socket);
    connection.emit('peer:connection', { device, peerId: 'peer-2' }, socket);
    expect(handler.getDevices()[device.id]).toMatchObject({
      status: Status.CONNECTED,
      connectionCount: 2,
      server: ServerTypes.PEER2PEER,
    });

    connection.emit(
      'peer:disconnected',
      { device, peerId: 'peer-1' },
      socket,
    );
    expect(handler.getDevices()[device.id]).toMatchObject({
      status: Status.CONNECTED,
      connectionCount: 1,
    });

    connection.emit(
      'peer:disconnected',
      { device, peerId: 'peer-2' },
      socket,
    );
    expect(handler.getDevices()[device.id]).toMatchObject({
      status: Status.DISCONNECTED,
      connectionCount: 0,
      server: null,
    });
    expect(settings.removeDevice).not.toHaveBeenCalled();
  });

  test('disconnects only the selected active access link', () => {
    const { handler, connection } = setup();
    connection.emit('peer:connection', { device, peerId: 'peer-1' }, {});

    handler.closeConnection(device.id);

    expect(connection.closeConnection).toHaveBeenCalledWith(device.id);
  });
});
