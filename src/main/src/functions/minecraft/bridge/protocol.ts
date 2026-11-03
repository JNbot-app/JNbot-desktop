export const JNBOT_MC_BRIDGE_PROTOCOL_VERSION = 1 as const;

export type JnbotMcBridgeProtocolVersion =
  typeof JNBOT_MC_BRIDGE_PROTOCOL_VERSION;

export type JnbotMcBridgeHello = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'hello';
  clientId: string;
  instanceId?: string;
  username?: string;
  uuid?: string;
  mcVersion?: string;
  modVersion?: string;
  capabilities?: readonly string[];
  token?: string;
  kind?: 'client';
};

export type JnbotMcBridgeServerHello = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'hello';
  kind: 'managed-server';
  serverId: string;
  mcVersion?: string;
  modVersion?: string;
  capabilities?: readonly string[];
  token: string;
};

export type JnbotMcBridgeEvent = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'event';
  name: string;
  data?: unknown;
};

export type JnbotMcBridgeHelloAck = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'helloAck';
  connectionId: string;
  serverTime: number;
  server: {
    name: string;
    version: string;
  };
};

export type JnbotMcBridgeRequest = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'request';
  id: string;
  method: string;
  params?: unknown;
};

export type JnbotMcBridgeResponse = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type JnbotMcBridgeCommand = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'command';
  name: string;
  params?: unknown;
};

export type JnbotMcBridgePing = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'ping';
  t: number;
};

export type JnbotMcBridgePong = {
  v: JnbotMcBridgeProtocolVersion;
  type: 'pong';
  t: number;
};

export type JnbotMcBridgeMessage =
  | JnbotMcBridgeHello
  | JnbotMcBridgeServerHello
  | JnbotMcBridgeHelloAck
  | JnbotMcBridgeRequest
  | JnbotMcBridgeResponse
  | JnbotMcBridgeCommand
  | JnbotMcBridgeEvent
  | JnbotMcBridgePing
  | JnbotMcBridgePong;

export const isObjectRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
      type: 'response',
      id: '0',
      ok: false,
      error: { code: 'stringify_failed', message: 'Failed to serialize JSON' },
    } satisfies JnbotMcBridgeResponse);
  }
};
