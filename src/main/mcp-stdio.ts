import fs from 'node:fs';
import readline from 'node:readline';

type RuntimeDiscovery = { endpoint: string; pid: number; startedAt: number };

function endpoint(): string {
  if (process.env.JNBOT_MCP_ENDPOINT) return process.env.JNBOT_MCP_ENDPOINT;
  const runtimePath = process.env.JNBOT_MCP_RUNTIME;
  if (!runtimePath) throw new Error('JNBOT_MCP_RUNTIME is required.');
  const runtime = JSON.parse(
    fs.readFileSync(runtimePath, 'utf8'),
  ) as RuntimeDiscovery;
  if (!runtime.endpoint?.startsWith('http://127.0.0.1:'))
    throw new Error('JNbot MCP is not running locally.');
  return runtime.endpoint;
}

async function forward(message: unknown): Promise<void> {
  const token = process.env.JNBOT_MCP_TOKEN;
  if (!token) throw new Error('JNBOT_MCP_TOKEN is required.');
  const request = message as {
    method?: string;
    params?: { name?: string; _meta?: Record<string, unknown> };
  };
  const meta = request.params?._meta;
  const protocolVersion =
    typeof meta?.['io.modelcontextprotocol/protocolVersion'] === 'string'
      ? meta['io.modelcontextprotocol/protocolVersion']
      : undefined;
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (protocolVersion) {
    headers['mcp-protocol-version'] = protocolVersion;
    if (request.method) headers['mcp-method'] = request.method;
    if (request.params?.name) headers['mcp-name'] = request.params.name;
  }
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`JNbot MCP returned ${response.status}: ${body}`);
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      if (line.startsWith('data:'))
        process.stdout.write(`${line.slice(5).trim()}\n`);
    }
    return;
  }
  if (body.trim()) process.stdout.write(`${body.trim()}\n`);
}

const input = readline.createInterface({
  input: process.stdin,
  terminal: false,
});
let queue = Promise.resolve();
input.on('line', (line) => {
  if (!line.trim()) return;
  queue = queue
    .then(() => forward(JSON.parse(line)))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
});
