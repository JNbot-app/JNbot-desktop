import http from 'node:http';
import { WebSocketServer } from 'ws';

/**
 * Minimal stand-in for the Lunar launcher's game IPC server
 * (`lunarclient.gameipc.protocol.v1`). The game connects to
 * ws://127.0.0.1:<ipcPort> and sends `LauncherboundIPCMessage` frames; we
 * answer with `GameboundIPCMessage { rpc_response }`.
 *
 * Lunar reads accounts from settings/game/accounts.json. AuthService
 * RefreshAccount (token expired, e.g. after switching account) and AddAccount
 * (no usable account) both expect the launcher to rewrite that file and report
 * success, after which the game reloads it. Every other RPC gets an empty
 * (default) response so the game never waits on a timeout.
 *
 * The same server also serves Mojang's service discovery document
 * (`-Dminecraft.api.discovery.host`) with the session `join` endpoint pointed
 * here. Joins made with a JNbot placeholder token (cracked alts) succeed
 * locally, so Lunar's authenticator never pops "Invalid Session"; real tokens
 * are forwarded to Mojang unchanged.
 */

export const DISCOVERY_PATH = '/discovery';
const JOIN_PATH = '/join';
const MOJANG_DISCOVERY = 'https://discovery.minecraftservices.com/minecraft/client';
/** Suffix of the unsigned tokens JNbot writes for alts without a session. */
export const PLACEHOLDER_TOKEN_SUFFIX = '.jnbot';

type Field = { no: number; value: number | Buffer };

const readVarint = (buf: Buffer, pos: { o: number }) => {
  let result = 0;
  let shift = 1;
  let byte: number;
  do {
    byte = buf[pos.o++];
    result += (byte & 0x7f) * shift;
    shift *= 128;
  } while (byte & 0x80);
  return result;
};

const decode = (buf: Buffer): Field[] => {
  const fields: Field[] = [];
  const pos = { o: 0 };
  while (pos.o < buf.length) {
    const key = readVarint(buf, pos);
    const no = Math.floor(key / 8);
    const take = (len: number) => {
      fields.push({ no, value: buf.subarray(pos.o, pos.o + len) });
      pos.o += len;
    };
    switch (key & 7) {
      case 0:
        fields.push({ no, value: readVarint(buf, pos) });
        break;
      case 1:
        take(8);
        break;
      case 2:
        take(readVarint(buf, pos));
        break;
      case 5:
        take(4);
        break;
      default:
        throw new Error('Unsupported protobuf wire type');
    }
  }
  return fields;
};

/** Follows nested message/bytes fields by number. */
const field = (buf: Buffer | undefined, ...path: number[]) =>
  path.reduce<Buffer | undefined>(
    (b, no) => b && (decode(b).find((f) => f.no === no)?.value as Buffer),
    buf,
  );

/** `lunarclient.common.v1.Uuid { fixed64 high64 = 1; fixed64 low64 = 2; }` as 32 hex chars. */
const uuidHex = (uuid: Buffer | undefined) => {
  if (!uuid) return undefined;
  const half = (no: number) =>
    (field(uuid, no)?.readBigUInt64LE() ?? 0n).toString(16).padStart(16, '0');
  return half(1) + half(2);
};

const varint = (n: number) => {
  const bytes: number[] = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
  return Buffer.from(bytes);
};

const bytesField = (no: number, value: Buffer) =>
  Buffer.concat([varint(no * 8 + 2), varint(value.length), value]);

const boolField = (no: number, value: boolean) =>
  value ? Buffer.from([no * 8, 1]) : Buffer.alloc(0);

export type LunarIpcHandlers = {
  /** (Re)write accounts.json, making `uuid` (32 hex) active when given. */
  writeAccount: (uuid?: string) => Promise<void>;
  log?: (message: string) => void;
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

/** Mojang discovery with `session.join` rewritten, and that join endpoint. */
const createSessionProxy = () => {
  let mojangJoin = 'https://sessionserver.mojang.com/session/minecraft/join';
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url === DISCOVERY_PATH) {
      const doc = await (await fetch(MOJANG_DISCOVERY)).json();
      mojangJoin = doc.discovery.session.endpoints.join.uri;
      doc.discovery.session.endpoints.join.uri = `http://${req.headers.host}${JOIN_PATH}`;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(doc));
      return;
    }
    if (req.url === JOIN_PATH && req.method === 'POST') {
      const body = await readBody(req);
      if (JSON.parse(body).accessToken?.endsWith(PLACEHOLDER_TOKEN_SUFFIX)) {
        res.writeHead(204).end();
        return;
      }
      const upstream = await fetch(mojangJoin, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      res.writeHead(upstream.status).end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    res.writeHead(404).end();
  };
};

export async function startLunarIpcServer(
  handlers: LunarIpcHandlers,
): Promise<{ port: number; close: () => void }> {
  const proxy = createSessionProxy();
  const server = http.createServer((req, res) => {
    proxy(req, res).catch((err) => {
      handlers.log?.(`[Lunar IPC] ${req.url} failed: ${err}`);
      if (!res.headersSent) res.writeHead(502).end();
    });
  });
  const wss = new WebSocketServer({ server });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
    server.listen(0, '127.0.0.1');
  });

  const handle = async (data: Buffer): Promise<Buffer> => {
    const requestId = field(data, 1) ?? Buffer.alloc(0);
    const service = field(data, 2)?.toString() ?? '';
    const method = field(data, 3)?.toString() ?? '';

    let output = Buffer.alloc(0);
    if (
      service.endsWith('AuthService') &&
      (method === 'RefreshAccount' || method === 'AddAccount')
    ) {
      // RefreshAccountRequest { Uuid uuid = 1 }; AddAccountRequest is empty.
      const uuid = uuidHex(field(data, 4, 1));
      // Both responses carry `bool success = 1`.
      const success = await handlers.writeAccount(uuid).then(
        () => true,
        (err) => {
          handlers.log?.(`[Lunar IPC] ${method} failed: ${err}`);
          return false;
        },
      );
      if (success) handlers.log?.(`[Lunar IPC] ${method}: account written`);
      output = boolField(1, success);
    }
    const rpcResponse = Buffer.concat([
      bytesField(1, requestId),
      bytesField(2, output),
    ]);
    return bytesField(1, rpcResponse);
  };

  wss.on('connection', (socket) => {
    handlers.log?.('[Lunar IPC] Game connected');
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      handle(data)
        .then((reply) => socket.send(reply))
        .catch((err) => handlers.log?.(`[Lunar IPC] Bad message: ${err}`));
    });
  });

  const { port } = server.address() as { port: number };
  return {
    port,
    close: () => {
      wss.close();
      server.close();
    },
  };
}
