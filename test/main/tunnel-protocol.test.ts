import {
  TUNNEL_VERSION,
  TUNNEL_CHUNK_BYTES,
  TunnelFrameType,
  encodeTunnelFrame,
  decodeTunnelFrame,
} from '../../src/main/src/functions/minecraftServer/tunnelProtocol';

describe('tunnelProtocol', () => {
  describe('encodeTunnelFrame', () => {
    it('encodes a minimal frame with default streamId and empty payload', () => {
      const frame = encodeTunnelFrame(TunnelFrameType.PING);
      expect(frame.length).toBe(6);
      expect(frame.readUInt8(0)).toBe(TUNNEL_VERSION);
      expect(frame.readUInt8(1)).toBe(TunnelFrameType.PING);
      expect(frame.readUInt32BE(2)).toBe(0);
    });

    it('encodes with string payload converted to utf8 bytes', () => {
      const payloadStr = 'hello-tunnel';
      const frame = encodeTunnelFrame(TunnelFrameType.DATA, 42, payloadStr);
      expect(frame.length).toBe(6 + Buffer.byteLength(payloadStr, 'utf8'));
      expect(frame.readUInt8(0)).toBe(TUNNEL_VERSION);
      expect(frame.readUInt8(1)).toBe(TunnelFrameType.DATA);
      expect(frame.readUInt32BE(2)).toBe(42);
      expect(frame.subarray(6).toString('utf8')).toBe(payloadStr);
    });

    it('encodes with buffer payload', () => {
      const buf = Buffer.from([1, 2, 3, 4, 5]);
      const frame = encodeTunnelFrame(TunnelFrameType.AUTH, 100, buf);
      expect(frame.length).toBe(6 + buf.length);
      expect(frame.readUInt32BE(2)).toBe(100);
      expect(frame.subarray(6)).toEqual(buf);
    });

    it('handles maximum allowed chunk size (16KB)', () => {
      const maxPayload = Buffer.alloc(TUNNEL_CHUNK_BYTES, 0xaa);
      const frame = encodeTunnelFrame(TunnelFrameType.DATA, 1, maxPayload);
      expect(frame.length).toBe(6 + TUNNEL_CHUNK_BYTES);
    });

    it('throws when payload exceeds TUNNEL_CHUNK_BYTES', () => {
      const oversized = Buffer.alloc(TUNNEL_CHUNK_BYTES + 1);
      expect(() => encodeTunnelFrame(TunnelFrameType.DATA, 1, oversized)).toThrow(
        'Minecraft tunnel frame is too large',
      );
    });

    it('handles streamId uint32 rollover for negative numbers', () => {
      // streamId >>> 0
      const frame = encodeTunnelFrame(TunnelFrameType.OPEN, -1);
      expect(frame.readUInt32BE(2)).toBe(0xffffffff);
    });
  });

  describe('decodeTunnelFrame', () => {
    it('decodes every valid frame type cleanly', () => {
      const types = [
        TunnelFrameType.AUTH,
        TunnelFrameType.AUTH_OK,
        TunnelFrameType.OPEN,
        TunnelFrameType.DATA,
        TunnelFrameType.END,
        TunnelFrameType.RESET,
        TunnelFrameType.PING,
        TunnelFrameType.PONG,
      ];

      for (const type of types) {
        const payload = Buffer.from(`test-payload-type-${type}`);
        const encoded = encodeTunnelFrame(type, 12345, payload);
        const decoded = decodeTunnelFrame(encoded);

        expect(decoded.type).toBe(type);
        expect(decoded.streamId).toBe(12345);
        expect(decoded.payload.toString('utf8')).toBe(payload.toString('utf8'));
      }
    });

    it('decodes Uint8Array instances as well as Buffers', () => {
      const encoded = encodeTunnelFrame(TunnelFrameType.PING, 7);
      const uint8 = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
      const decoded = decodeTunnelFrame(uint8);
      expect(decoded.type).toBe(TunnelFrameType.PING);
      expect(decoded.streamId).toBe(7);
      expect(decoded.payload.length).toBe(0);
    });

    it('throws on non-buffer, null, or undefined inputs', () => {
      expect(() => decodeTunnelFrame(null)).toThrow('Malformed Minecraft tunnel frame');
      expect(() => decodeTunnelFrame(undefined)).toThrow('Malformed Minecraft tunnel frame');
      expect(() => decodeTunnelFrame('not a buffer')).toThrow('Malformed Minecraft tunnel frame');
      expect(() => decodeTunnelFrame({ length: 10 })).toThrow('Malformed Minecraft tunnel frame');
    });

    it('throws on frames shorter than HEADER_BYTES (6 bytes)', () => {
      expect(() => decodeTunnelFrame(Buffer.alloc(0))).toThrow('Malformed Minecraft tunnel frame');
      expect(() => decodeTunnelFrame(Buffer.alloc(5))).toThrow('Malformed Minecraft tunnel frame');
    });

    it('throws on frames larger than HEADER_BYTES + TUNNEL_CHUNK_BYTES', () => {
      const huge = Buffer.alloc(6 + TUNNEL_CHUNK_BYTES + 1);
      expect(() => decodeTunnelFrame(huge)).toThrow('Malformed Minecraft tunnel frame');
    });

    it('throws on unsupported version', () => {
      const frame = encodeTunnelFrame(TunnelFrameType.PING);
      frame.writeUInt8(99, 0); // Invalid version
      expect(() => decodeTunnelFrame(frame)).toThrow('Unsupported Minecraft tunnel version');
    });

    it('throws on unknown frame types', () => {
      const frame = encodeTunnelFrame(TunnelFrameType.PING);
      frame.writeUInt8(0, 1); // Below AUTH (1)
      expect(() => decodeTunnelFrame(frame)).toThrow('Unknown Minecraft tunnel frame');

      frame.writeUInt8(9, 1); // Above PONG (8)
      expect(() => decodeTunnelFrame(frame)).toThrow('Unknown Minecraft tunnel frame');

      frame.writeUInt8(255, 1);
      expect(() => decodeTunnelFrame(frame)).toThrow('Unknown Minecraft tunnel frame');
    });
  });
});
