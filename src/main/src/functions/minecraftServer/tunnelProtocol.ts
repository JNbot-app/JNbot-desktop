export const TUNNEL_VERSION = 1;
export const TUNNEL_CHUNK_BYTES = 16 * 1024;
export const TUNNEL_HIGH_WATER = 1024 * 1024;
export const TUNNEL_LOW_WATER = 256 * 1024;

export const enum TunnelFrameType {
  AUTH = 1,
  AUTH_OK = 2,
  OPEN = 3,
  DATA = 4,
  END = 5,
  RESET = 6,
  PING = 7,
  PONG = 8,
}

export type TunnelFrame = {
  type: TunnelFrameType;
  streamId: number;
  payload: Buffer;
};

const HEADER_BYTES = 6;

export function encodeTunnelFrame(
  type: TunnelFrameType,
  streamId = 0,
  payload: Buffer | string = Buffer.alloc(0),
): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  if (body.length > TUNNEL_CHUNK_BYTES)
    throw new Error('Minecraft tunnel frame is too large');
  const frame = Buffer.allocUnsafe(HEADER_BYTES + body.length);
  frame.writeUInt8(TUNNEL_VERSION, 0);
  frame.writeUInt8(type, 1);
  frame.writeUInt32BE(streamId >>> 0, 2);
  body.copy(frame, HEADER_BYTES);
  return frame;
}

export function decodeTunnelFrame(value: unknown): TunnelFrame {
  const frame = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : null;
  if (!frame || frame.length < HEADER_BYTES || frame.length > HEADER_BYTES + TUNNEL_CHUNK_BYTES)
    throw new Error('Malformed Minecraft tunnel frame');
  if (frame.readUInt8(0) !== TUNNEL_VERSION)
    throw new Error('Unsupported Minecraft tunnel version');
  const type = frame.readUInt8(1) as TunnelFrameType;
  if (type < TunnelFrameType.AUTH || type > TunnelFrameType.PONG)
    throw new Error('Unknown Minecraft tunnel frame');
  return {
    type,
    streamId: frame.readUInt32BE(2),
    payload: frame.subarray(HEADER_BYTES),
  };
}
