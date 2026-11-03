import net from 'net';
import pingServer from '../../src/main/src/functions/minecraft/pingServer';

describe('pingServer', () => {
  describe('parameter validation', () => {
    it('rejects empty or invalid host', async () => {
      await expect(pingServer('', 25565, 1000)).rejects.toThrow('Invalid server address');
      await expect(pingServer(null as any, 25565, 1000)).rejects.toThrow('Invalid server address');
      await expect(pingServer(undefined as any, 25565, 1000)).rejects.toThrow(
        'Invalid server address',
      );
    });

    it('rejects invalid ports (out of bounds, non-integer, negative)', async () => {
      await expect(pingServer('localhost', 0, 1000)).rejects.toThrow('Invalid server address');
      await expect(pingServer('localhost', -1, 1000)).rejects.toThrow('Invalid server address');
      await expect(pingServer('localhost', 65536, 1000)).rejects.toThrow('Invalid server address');
      await expect(pingServer('localhost', 25565.5, 1000)).rejects.toThrow('Invalid server address');
      await expect(pingServer('localhost', NaN, 1000)).rejects.toThrow('Invalid server address');
      await expect(pingServer('localhost', '25565' as any, 1000)).rejects.toThrow(
        'Invalid server address',
      );
    });
  });

  describe('protocol handshake & response handling', () => {
    let server: net.Server;
    let port: number;

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

    const makeStatusPacket = (packetId: number, json: string): Buffer => {
      const jsonBuf = Buffer.from(json, 'utf8');
      const payload = Buffer.concat([
        encodeVarInt(packetId),
        encodeVarInt(jsonBuf.length),
        jsonBuf,
      ]);
      return Buffer.concat([encodeVarInt(payload.length), payload]);
    };

    let activeSockets: net.Socket[] = [];

    afterEach(async () => {
      for (const s of activeSockets) {
        try {
          s.destroy();
        } catch {}
      }
      activeSockets = [];

      if (server && server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('resolves on valid Minecraft status packet response', async () => {
      server = net.createServer((socket) => {
        activeSockets.push(socket);
        socket.on('data', () => {
          const statusJson = JSON.stringify({
            version: { name: '1.20.4', protocol: 765 },
            players: { max: 100, online: 15 },
            description: { text: 'Test Server' },
          });
          socket.write(makeStatusPacket(0, statusJson));
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as net.AddressInfo).port;
          resolve();
        });
      });

      await expect(pingServer('127.0.0.1', port, 2000)).resolves.toEqual({
        version: { name: '1.20.4', protocol: 765 },
        players: { max: 100, online: 15 },
        description: { text: 'Test Server' },
      });
    });

    it('rejects on unexpected packet ID', async () => {
      server = net.createServer((socket) => {
        activeSockets.push(socket);
        socket.on('data', () => {
          socket.write(makeStatusPacket(1, '{}')); // Non-zero packetId
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as net.AddressInfo).port;
          resolve();
        });
      });

      await expect(pingServer('127.0.0.1', port, 2000)).rejects.toThrow(
        'Unexpected Minecraft status packet',
      );
    });

    it('rejects when server response times out', async () => {
      server = net.createServer((socket) => {
        activeSockets.push(socket);
        // Hang without writing back
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as net.AddressInfo).port;
          resolve();
        });
      });

      await expect(pingServer('127.0.0.1', port, 100)).rejects.toThrow('Ping timed out');
    });

    it('rejects when connection is refused', async () => {
      // Pick an unused port without listening
      await expect(pingServer('127.0.0.1', 59999, 1000)).rejects.toThrow();
    });
  });
});
