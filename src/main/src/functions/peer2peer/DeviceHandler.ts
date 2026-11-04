import { Device, DeviceObj } from '../../types';
import {
  DEFAULT_REMOTE_PERMISSIONS,
  defaultMcpPermissions,
  type ClientPermissions,
} from '../../../../common/clientPermissions';
import ClientEvents_ from '../ClientEvents';
import Settings_ from '../Settings';
import PeerConnection from './PeerConnection';
import crypto from 'crypto';
import type { Socket } from './Socket';
import EventEmitter from 'events';

function generateToken(length: number): string {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
}

export const enum Status {
  CONNECTED,
  CONNECTING,
  DISCONNECTED,
}

export const enum ServerTypes {
  PEER2PEER = 'peer2peer',
}

interface Conn {
  server: ServerTypes | null;
  status: Status;
  connectionCount: number;
}

type Devices = (Conn & Device)[];

class DeviceHandler extends EventEmitter {
  public devices: { [key: string]: DeviceObj } = {};
  private peerConnection: PeerConnection;
  private connectedPeers = new Map<string, Set<string>>();

  constructor(
    public clientEvents: ClientEvents_,
    public settings: Settings_,
  ) {
    super();
    // initialize devices

    settings.shared.devices ??= [];
    settings.shared.devices.forEach((device: Device) => {
      this.registerDevice(device);
    });

    this.peerConnection = new PeerConnection(settings, clientEvents);

    this.peerConnection.on('peer:connection', (data, _socket) => {
      const peers =
        this.connectedPeers.get(data.device.id) ?? new Set<string>();
      if (data.peerId) peers.add(data.peerId);
      this.connectedPeers.set(data.device.id, peers);
      this.setDeviceStatus(
        data.device.id,
        Status.CONNECTED,
        ServerTypes.PEER2PEER,
      );
      this.onConnected(data);
      console.info('Peer connected');
    });

    this.peerConnection.on('peer:disconnected', (data, socket) => {
      const device = data?.device;
      if (!device) return;
      console.info('Peer disconnected');
      const peers = this.connectedPeers.get(device.id);
      if (data.peerId) peers?.delete(data.peerId);
      if (peers?.size) {
        this.setDeviceStatus(
          device.id,
          Status.CONNECTED,
          ServerTypes.PEER2PEER,
        );
        return;
      }
      this.connectedPeers.delete(device.id);
      this.setDeviceStatus(
        device.id,
        Status.DISCONNECTED,
        ServerTypes.PEER2PEER,
      );
      if (this.connectedPeers.size === 0)
        this.clientEvents.unregisterSocket(socket);
    });
  }

  private onConnected(data: { peerId?: string }) {
    console.info('------ Connected to device -----');
    // Remote clients use the permission-aware messenger only. Registering the
    // legacy shared socket would let one peer impersonate another and bypass
    // per-profile grants through raw IPC events.
    if (data.peerId) this.peerConnection.sendBootstrap?.(data.peerId);
  }

  public setDeviceStatus(id: string, status: Status, serverType: ServerTypes) {
    const d = this.findDevice(id);
    if (!d) return console.error('Device not found');
    if (d.status === Status.CONNECTED && d.server !== serverType) {
      // Device is already active on another server
      // Disconnect it from that server
      this.closeConnection(id);
    }

    this.devices[id].status = status;
    this.devices[id].server = serverType;
    this.devices[id].connectionCount = this.connectedPeers.get(id)?.size ?? 0;
    if (status === Status.CONNECTED) {
      this.touchDevice(id);
    }
    if (status === Status.DISCONNECTED) {
      this.devices[id].server = null;
    }
    this.sendDevices();
  }

  public getDevices() {
    return this.devices;
  }

  public sendDevices() {
    const devices: Devices = Object.values(this.devices);
    const serverInfo = {
      [ServerTypes.PEER2PEER]: {
        status: !!this.peerConnection.isActive,
        url: this.peerConnection.url,
        room: this.peerConnection.id,
      },
    };
    this.emit('server:update', serverInfo);
    (
      global.send as (
        event: string,
        payload: unknown,
        socket?: Socket | boolean,
      ) => void
    )(
      'devices',
      {
        devices,
        ...serverInfo,
      },
      false,
    ); // IMPORTANT: ONLY send to main window!
  }

  public createDevice(
    name: string,
    permissions: ClientPermissions = {
      profiles: [this.settings.bootstrapProfileKey ?? 'jartexnetwork'],
      permissionMask: DEFAULT_REMOTE_PERMISSIONS,
      mcp: defaultMcpPermissions(),
    },
    notify = true,
  ): Device {
    const token = generateToken(64);
    let id;

    do {
      id = generateToken(32);
    } while (id in this.devices);

    const device: Device = {
      id,
      token,
      name,
      permissions,
      createdAt: Date.now(),
    };
    this.registerDevice(device);
    this.settings.updateDevice(id, device);
    this.syncCredentials();
    if (notify) this.sendDevices();
    return device;
  }

  public ensureDefaultDevice(): Device {
    const existingId = Object.keys(this.devices)[0];
    return existingId
      ? (this.getDevice(existingId) as Device)
      : this.createDevice(
          'My device',
          {
            profiles: [this.settings.bootstrapProfileKey],
            permissionMask: DEFAULT_REMOTE_PERMISSIONS,
            mcp: defaultMcpPermissions(),
          },
          false,
        );
  }

  public async start(server: ServerTypes) {
    const device = this.ensureDefaultDevice();
    if (server !== ServerTypes.PEER2PEER){
      console.warn('Unknown server type: ', server);
      return null
    }
    try {
      await this.peerConnection.start();
    } finally {
      this.sendDevices();
    }
    return {
      device,
      server: this.getServerInfo()[server],
    };
  }

  public stop(server: ServerTypes) {
    if (server === ServerTypes.PEER2PEER) this.peerConnection.stop();
    else return console.warn('Unknown server type: ', server);

    this.sendDevices();
  }

  public isDeviceActive(id: string): boolean {
    const device = this.findDevice(id);
    if (!device) return false;
    return device.status === Status.CONNECTED;
  }

  public removeDevice(id: string) {
    if (this.findDevice(id)) {
      if (this.isDeviceActive(id)) {
        this.closeConnection(id);
      }
      this.settings.removeDevice(id);
      delete this.devices[id];
      this.connectedPeers.delete(id);
      this.syncCredentials();
      this.sendDevices();
    } else {
      console.error('No device found with id=', id);
    }
  }

  public closeConnection(id: string) {
    if (!this.findDevice(id)) return console.error('Device not found');
    if (this.devices[id].server === ServerTypes.PEER2PEER)
      this.peerConnection.closeConnection(id);
    else return console.warn('Unknown server type: ', this.devices[id].server);
    this.sendDevices();
  }

  public updateDevice(
    id: string,
    data: {
      name?: string;
      permissions?: ClientPermissions;
      createdAt?: number;
      lastActivityAt?: number;
    },
  ) {
    if (!this.devices[id]) return;
    this.devices[id] = { ...this.devices[id], ...data, id };
    this.settings.updateDevice(id, this.getDevice(id) as Device);
    this.syncCredentials();
    if (data.permissions) {
      for (const peerId of this.connectedPeers.get(id) ?? [])
        this.peerConnection.sendPermissionsUpdated?.(peerId, data.permissions);
    }
    this.sendDevices();
  }

  public touchDevice(id: string, timestamp = Date.now()) {
    if (!this.devices[id]) {
      const d = this.findDevice(id);
      if (!d) return;
    }
    this.devices[id] = { ...this.devices[id], lastActivityAt: timestamp };
    this.settings.updateDevice(id, this.getDevice(id) as Device);
  }

  public rotateToken(id: string): string | undefined {
    const device = this.getDevice(id);
    if (!device) return undefined;
    const token = generateToken(64);
    this.devices[id] = { ...this.devices[id], token };
    this.settings.updateDevice(id, { ...device, token });
    this.syncCredentials();
    this.sendDevices();
    return token;
  }

  public getDevice(id: string): Device | undefined {
    const d = this.findDevice(id);
    if (!d) return;
    return {
      name: d.name,
      id: d.id,
      token: d.token,
      permissions: d.permissions,
      createdAt: d.createdAt,
      lastActivityAt: d.lastActivityAt,
    };
  }

  public broadcast(event: string, data?: any) {
    this.peerConnection.broadcast(event, data);
  }

  public findDevice(token: string): DeviceObj | null {
    if (token in this.devices) return this.devices[token];
    const device = this.settings.shared.devices?.find((d) => d.token === token);
    if (!device) return null;
    this.registerDevice(device);

    return this.devices[device.id];
  }

  private registerDevice(device: Device) {
    this.devices[device.id] = {
      ...device,
      status: Status.DISCONNECTED,
      server: null,
      connectionCount: 0,
    };
  }

  private syncCredentials() {
    this.peerConnection.setDevices(
      Object.values(this.devices).map(({ name, id, token, permissions }) => ({
        name,
        id,
        token,
        permissions,
      })),
    );
  }

  private getServerInfo() {
    return {
      [ServerTypes.PEER2PEER]: {
        status: !!this.peerConnection.isActive,
        url: this.peerConnection.url,
        room: this.peerConnection.id,
      },
    };
  }
}

export default DeviceHandler;
