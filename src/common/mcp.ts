export type McpCapability =
  | 'bot_status'
  | 'chat_players'
  | 'inventory_windows'
  | 'world_entities'
  | 'bot_controls'
  | 'bot_scripting'
  | 'account_joining'
  | 'plugin_source_reading'
  | 'plugin_draft_creation'
  | 'plugin_execution'
  | 'plugin_network_access';

export type McpPack = 'observe' | 'control' | 'code' | 'plugins';

/** A safe, actionable input error that can be returned directly to MCP clients. */
export class McpInputError extends Error {
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpInputError';
    this.details = details;
  }
}

/** Stable public bot identity. Numeric runtime identifiers never cross MCP. */
export type McpBotTarget = { profileKey: string; account: string };

export type McpOperationStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'cancelled';

export type McpOperation = {
  operationId: string;
  status: McpOperationStatus;
  tool: string;
  clientId: string;
  target?: McpBotTarget;
  acceptedAt: number;
  updatedAt: number;
  pollAfterMs: number;
  deduplicated: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  summary: string;
};

export type McpApprovalPolicy = 'disabled' | 'always_ask' | 'allow';


export type McpClientGrant = {
  id: string;
  name: string;
  provider: 'chatgpt' | 'claude' | 'local' | 'custom';
  capabilities: McpCapability[];
  profileKeys: string[];
  accounts: string[];
  approvalPolicy: Partial<Record<McpCapability, McpApprovalPolicy>>;
  createdAt: number;
  lastActivityAt?: number;
  expiresAt?: number;
  revokedAt?: number;
  /** Unified client policy, populated by the desktop server. */
  mcpPermissions?: {
    enabled: boolean;
    observe: 'deny' | 'allow';
    control: 'deny' | 'ask' | 'allow';
    code: 'deny' | 'ask' | 'allow';
    plugins: 'deny' | 'ask' | 'allow';
  };
};

export type McpApprovalSummary = {
  id: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  expiresAt: number;
};

export type McpToolResult<T = unknown> =
  | { status: 'completed'; data: T }
  | {
      status: 'approval_required' | 'pending' | 'running';
      approval: McpApprovalSummary;
      retryAfterMs: number;
      nextAction: {
        tool: 'wait_for_approval';
        arguments: { approvalId: string };
      };
    }
  | {
      status: 'denied' | 'expired' | 'failed' | 'cancelled';
      error: { code: string; message: string };
    };

export type McpApprovalRequest = {
  id: string;
  clientId: string;
  clientName: string;
  tool: string;
  capability: McpCapability;
  arguments: Record<string, unknown>;
  argumentHash: string;
  codeHash?: string;
  pluginDiff?: {
    sourceHash?: string;
    changedLines?: string[];
    before: string;
    after: string;
    optionSchema?: {
      before: unknown;
      after: unknown;
      changed: boolean;
    };
  };
  target?: {
    profileKey?: string;
    profileId?: number;
    account?: string;
    botId?: number;
    pluginId?: string;
  };
  summary: string;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
  allowForSessionUntil?: number;
  execution?: {
    status: 'running' | 'success' | 'error';
    result?: McpToolResult;
  };
};

export type McpAuditEvent = {
  id: string;
  timestamp: number;
  clientId: string;
  clientName: string;
  tool: string;
  capability: McpCapability;
  target?: Record<string, string | number | boolean | null>;
  decision: 'allowed' | 'approval_required' | 'denied' | 'cancelled';
  durationMs?: number;
  result: 'pending' | 'success' | 'error';
  error?: string;
  summary?: string;
  /** The operation's result as (truncated) JSON, for the session replay. */
  output?: string;
};

export type McpRelayRequestFrame = {
  type: 'request';
  id: string;
  installationId: string;
  clientId: string;
  nonce: string;
  timestamp: number;
  method: string;
  headers: Record<string, string>;
  body: string;
};

export type McpRelayResponseFrame = {
  type: 'response';
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type McpStatus = {
  enabled: boolean;
  mode: 'off' | 'local' | 'remote';
  endpoint?: string;
  remoteEndpoint?: string;
  sessionStartedAt?: number;
  connectedClients: number;
  relayConnected?: boolean;
};

export type McpActivitySnapshot = {
  status: McpStatus;
  clients: McpClientGrant[];
  approvals: McpApprovalRequest[];
  audit: McpAuditEvent[];
  operations?: McpOperation[];
};

export const JNBOT_MCP_RELAY_ORIGIN =
  'https://mcp.jnbot.workers.dev';
