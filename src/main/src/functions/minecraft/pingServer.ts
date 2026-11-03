import { createConnection } from 'node:net';
import { resolveSrv } from 'node:dns/promises';

const MAX_PACKET_SIZE = 1024 * 1024;
const STATUS_PROTOCOL_VERSION = 736;

const encodeVarInt = (value: number): Buffer => {
  const bytes: number[] = [];
  let remaining = value < 0 ? value + 2 ** 32 : value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining) byte += 128;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
};

const decodeVarInt = (
  buffer: Buffer,
  offset = 0,
): { value: number; size: number } | undefined => {
  let value = 0;
  for (let size = 0; size < 5; size += 1) {
    const index = offset + size;
    if (index >= buffer.length) return undefined;
    const byte = buffer[index];
    value += (byte % 128) * 128 ** size;
    if (byte < 128) return { value, size: size + 1 };
  }
  throw new RangeError('Invalid Minecraft packet varint');
};

const encodeString = (value: string): Buffer => {
  const content = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeVarInt(content.length), content]);
};

const framePacket = (payload: Buffer): Buffer =>
  Buffer.concat([encodeVarInt(payload.length), payload]);

const readStatusResponse = (buffer: Buffer): unknown | undefined => {
  const frame = decodeVarInt(buffer);
  if (!frame) return undefined;
  if (frame.value > MAX_PACKET_SIZE)
    throw new Error('Status packet is too large');
  if (buffer.length < frame.size + frame.value) return undefined;

  const payload = buffer.subarray(frame.size, frame.size + frame.value);
  const packetId = decodeVarInt(payload);
  if (!packetId || packetId.value !== 0) {
    throw new Error('Unexpected Minecraft status packet');
  }
  const stringLength = decodeVarInt(payload, packetId.size);
  if (!stringLength) throw new Error('Incomplete Minecraft status response');
  const start = packetId.size + stringLength.size;
  const end = start + stringLength.value;
  if (end > payload.length) throw new Error('Incomplete Minecraft status JSON');
  return JSON.parse(payload.toString('utf8', start, end));
};

/** The subset of the server-list status JSON the app reads. */
interface StatusResponse {
  version?: { name?: string };
  players?: { online?: number; max?: number };
  favicon?: string;
}

const pingServer = (
  host: string,
  port: number,
  timeout: number,
): Promise<StatusResponse> => {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error('Invalid server address'));
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let received = Buffer.alloc(0);
    let settled = false;

    const finish = (error?: Error, status?: StatusResponse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(status ?? {});
    };

    socket.setTimeout(timeout, () => finish(new Error('Ping timed out')));
    socket.once('error', (error) => finish(error));
    socket.once('connect', () => {
      const portBuffer = Buffer.allocUnsafe(2);
      portBuffer.writeUInt16BE(port);
      const handshake = Buffer.concat([
        encodeVarInt(0),
        encodeVarInt(STATUS_PROTOCOL_VERSION),
        encodeString(host),
        portBuffer,
        encodeVarInt(1),
      ]);
      socket.write(
        Buffer.concat([framePacket(handshake), framePacket(encodeVarInt(0))]),
      );
    });
    socket.on('data', (chunk) => {
      try {
        received = Buffer.concat([received, chunk]);
        const status = readStatusResponse(received);
        if (status !== undefined) finish(undefined, status as StatusResponse);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
};

export interface ServerStatus {
  version?: string;
  online?: number;
  max?: number;
  /** PNG data URL of the server icon. */
  favicon?: string;
}

/** Ping a server the way the Minecraft client does, following its SRV record on the default port. */
export async function getServerStatus(host: string, port: number): Promise<ServerStatus> {
  let target = { host, port };
  if (port === 25565) {
    const [srv] = await resolveSrv(`_minecraft._tcp.${host}`).catch(() => []);
    if (srv) target = { host: srv.name, port: srv.port };
  }
  const status = await pingServer(target.host, target.port, 5000);
  const favicon = status.favicon?.startsWith('data:image/png;base64,') ? status.favicon : undefined;
  return {
    version: status.version?.name?.replace(/§./g, '').slice(0, 40),
    online: status.players?.online,
    max: status.players?.max,
    favicon,
  };
}

export default pingServer;
