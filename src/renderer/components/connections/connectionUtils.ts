import type { Device, DeviceObj } from '../../../main/src/types';

export enum ServerTypes {
  PEER2PEER = 'peer2peer',
}

export const buildAccessUrl = (
  server: { url?: string; room?: string } | undefined,
  device: Device | DeviceObj | undefined,
) => {
  if (!server?.url || !server.room || !device) return '';
  const url = new URL(server.url);
  url.searchParams.set('room', server.room);
  url.searchParams.set('token', device.token);
  url.searchParams.set('id', device.id);
  url.searchParams.set('p2p', 'true');
  return url.toString();
};

export const buildMobileAccessUrl = (
  server: { room?: string } | undefined,
  device: Device | DeviceObj | undefined,
) => {
  if (!server?.room || !device) return '';
  const query = new URLSearchParams({
    room: server.room,
    token: device.token,
    id: device.id,
  });
  return `jnbot://connect?${query.toString()}`;
};
