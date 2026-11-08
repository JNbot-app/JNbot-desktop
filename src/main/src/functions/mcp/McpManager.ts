import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createMcpHandler, McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type {
  McpActivitySnapshot,
  McpApprovalRequest,
  McpAuditEvent,
  McpBotTarget,
  McpCapability,
  McpClientGrant,
  McpOperation,
  McpStatus,
} from '../../../../common/mcp';
import { JNBOT_MCP_RELAY_ORIGIN, McpInputError } from '../../../../common/mcp';
import type { ClientPermissions, McpPermission } from '../../../../common/clientPermissions';
import {
  DEFAULT_REMOTE_PERMISSIONS,
  defaultMcpPermissions,
  normalizePermissions,
} from '../../../../common/clientPermissions';
import { validatePluginOptionSchema } from '../../../../common/pluginOptions';
import { findPresetId, PRESET_OPTION } from '../../../../common/pluginPresets';
import type { Device, FullLogMessage } from '../../types';
import type ScriptHandler from '../ScriptHandler';
import type Macros from '../Macros';
import McpStorage from './McpStorage';
import McpBotBridge from './McpBotBridge';
import McpPluginInstaller from './McpPluginInstaller';
import McpPluginService from './McpPluginService';
import McpOperations from './McpOperations';
import McpRelayClient, { type PairingFrame } from './McpRelayClient';
import { consumeRateLimit, redactMcpValue, sanitizeError } from './security';
import { PLUGIN_API_TYPES } from '../../../../common/pluginApiTypesSource';
import { PLUGIN_AUTHORING_GUIDE, PLUGIN_FULL_EXAMPLES } from '../../../../common/pluginAuthoringGuideSource';
import {
  JNBOT_MCP_CONTEXT,
  JNBOT_REFERENCE_SECTION_IDS,
  JNBOT_REFERENCE_SECTION_MARKERS,
  type JnbotReferenceSection,
} from '../../../../common/pluginMcpReferenceSource';
import {
  createMcpTools,
  type McpClientContext,
  type McpPack,
  type McpToolDefinition,
  MOVE_ACTION_MAP,
  INTERACTION_ACTION_MAP,
  INVENTORY_ACTION_MAP,
} from './McpTools';

export type { McpClientContext, McpPack, McpToolDefinition } from './McpTools';

interface PendingApproval {
  clientId: string;
  execute: () => Promise<unknown>;
  args: Record<string, unknown>;
}

const MAX_BODY_BYTES = 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const READ_TIMEOUT_MS = 5_000;
export const MCP_INSTRUCTIONS = `Use stable { profileKey, account } bot targets returned by get_jnbot_context. When a user names an alt that is not an active bot, call get_jnbot_context with its profileKey and accountQuery before asking the user for the account name; stored alts belong to profiles. Use the returned account match with join_bot. Writes return an operationId immediately; call get_operation until it is terminal and never resubmit a pending write. Internal numeric IDs do not exist in this API. To react to the game (a server reply, a kick, a window opening) call wait_for_event instead of polling get_bot_state; get_bot_state with include ["events"] explains recent kicks, deaths and disconnects. leave_bot, send_bot_chat and run_plugin action mode accept accounts (["*"] = every active bot) to act on several bots at once.

Triggers and chains: get_plugin mode "automations" lists a profile's triggers and chains; save_automation creates, updates or deletes them; run a chain with run_plugin pluginId "chain:<id>". Plugin options can have presets: read them with get_plugin mode "options", write one with save_plugin mode "options" and preset, and run one with run_plugin preset.

Plugin workflow: when the user asks to create or change a plugin or action, first call get_plugin with mode "authoring" and get_jnbot_reference for any API section you do not know. Infer options for user-adjustable behaviour and include optionSchema with the source. Then call save_plugin; do not merely provide source code. Use scriptType "action" only for an action with async function main(bot, settings, args = []). Poll get_operation and report the installed pluginId or approval/validation result.

${JNBOT_MCP_CONTEXT}`;

export function serializeMcpRunLogs(logs: FullLogMessage[], limit = 200) {
  return logs.slice(-Math.min(Math.max(limit, 1), 500)).map(
    ([message, level, scriptName, runId, timestamp]) =>
      redactMcpValue({ message, level, scriptName, runId, timestamp }),
  );
}

export function asStructuredContent(result: unknown): Record<string, unknown> {
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : { result: result ?? null };
}

/** Stateless Streamable HTTP MCP endpoint backed by normal JNbot clients. */
export class McpManager {
  private readonly storage = new McpStorage();
  private readonly botBridge: McpBotBridge;
  private readonly pluginInstaller: McpPluginInstaller;
  private readonly plugins: McpPluginService;
  private readonly operations = new McpOperations(() => this.emitActivity());
  private readonly pending = new Map<string, PendingApproval>();
  private readonly audit: McpAuditEvent[] = [];
  private readonly rateWindows = new Map<string, number[]>();
  private readonly activeClientIds = new Set<string>();
  private readonly relayPairings = new Map<string, PairingFrame>();
  private readonly relayClient: McpRelayClient;
  private relayConnected = false;
  private server?: http.Server;
  private endpoint?: string;
  private mode: McpStatus['mode'] = 'off';
  private sessionStartedAt?: number;
  private readonly docs: string;

  constructor(
    private readonly scriptHandler: ScriptHandler,
    private readonly macros: Macros,
  ) {
    this.botBridge = new McpBotBridge(scriptHandler);
    this.pluginInstaller = new McpPluginInstaller(macros, this.storage.directory);
    this.plugins = new McpPluginService(scriptHandler);
    this.docs = `${PLUGIN_AUTHORING_GUIDE}\n\n${PLUGIN_API_TYPES}`;
    this.relayClient = new McpRelayClient(
      this.storage,
      () => this.endpoint,
      (frame) => this.requestRelayPairingApproval(frame),
      (connected) => {
        this.relayConnected = connected;
        this.emitActivity();
      },
      (clientId) => this.clientById(clientId),
    );
  }

  // ===========================================================================
  // Accessors for Tool Handlers
  // ===========================================================================

  getBotBridge(): McpBotBridge {
    return this.botBridge;
  }

  getOperations(): McpOperations {
    return this.operations;
  }

  getMacros(): Macros {
    return this.macros;
  }

  getPluginService(): McpPluginService {
    return this.plugins;
  }

  // ===========================================================================
  // Status & Snapshots
  // ===========================================================================

  status(): McpStatus {
    return {
      enabled: Boolean(this.server?.listening),
      mode: this.server?.listening ? this.mode : 'off',
      endpoint: this.endpoint,
      remoteEndpoint: this.mode === 'remote' ? `${JNBOT_MCP_RELAY_ORIGIN}/i/${this.storage.installationId}/mcp` : undefined,
      sessionStartedAt: this.sessionStartedAt,
      connectedClients: this.activeClientIds.size,
      relayConnected: this.relayConnected,
    };
  }

  snapshot(): McpActivitySnapshot & { operations: McpOperation[] } {
    const operations = this.operations.list();
    const byId = new Map(operations.map((operation) => [operation.operationId, operation]));
    return {
      status: this.status(),
      clients: this.clients().map((client) => this.publicClient(client)),
      approvals: this.approvals(),
      // History rows follow their operation, so the replay shows how each call ended.
      audit: [...this.audit].reverse().map((event) => {
        const operation = byId.get(event.id);
        if (!operation) return event;
        const done = ['succeeded', 'failed', 'denied', 'cancelled'].includes(operation.status);
        return {
          ...event,
          summary: operation.summary,
          result: operation.status === 'succeeded' ? 'success' : done ? 'error' : 'pending',
          error: operation.error?.message,
          output: operation.result === undefined ? undefined : JSON.stringify(operation.result).slice(0, 2_000),
          durationMs: done ? operation.updatedAt - operation.acceptedAt : undefined,
        };
      }),
      operations,
    };
  }

  // ===========================================================================
  // Server Lifecycle Management
  // ===========================================================================

  async enable(mode: 'local' | 'remote' = 'local') {
    if (this.server?.listening) {
      return { status: this.status(), endpoint: this.endpoint! };
    }

    this.mode = mode;
    this.server = http.createServer((request, response) => void this.handleHttp(request, response));
    this.server.requestTimeout = 10_000;
    this.server.headersTimeout = 10_000;

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('MCP port unavailable.');
    }

    this.endpoint = `http://127.0.0.1:${address.port}/mcp`;
    this.sessionStartedAt = Date.now();
    this.writeRuntimeDiscovery();

    if (mode === 'remote') {
      this.relayClient.start();
    }

    this.emitActivity();
    return { status: this.status(), endpoint: this.endpoint };
  }

  async disable(): Promise<McpStatus> {
    const server = this.server;
    this.server = undefined;
    this.endpoint = undefined;
    this.mode = 'off';
    this.sessionStartedAt = undefined;
    this.removeRuntimeDiscovery();
    this.relayClient.stop();
    this.relayConnected = false;
    this.pending.clear();
    this.operations.cancelAll();
    await this.botBridge.stopClientSessions();

    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    this.activeClientIds.clear();
    this.emitActivity();
    return this.status();
  }

  async emergencyStop(): Promise<McpStatus> {
    this.botBridge.emergencyStop();
    return this.disable();
  }

  close(): void {
    void this.disable();
  }

  // ===========================================================================
  // Client Management & Authentication
  // ===========================================================================

  createClient(input: { name: string; provider: McpClientGrant['provider']; profileKeys: string[] }) {
    const profiles = input.profileKeys.includes('*') ? '*' : input.profileKeys;
    if (profiles !== '*' && profiles.length === 0) {
      throw new Error('Choose at least one profile.');
    }

    const device = this.scriptHandler.deviceHandler.createDevice(input.name, {
      profiles,
      permissionMask: DEFAULT_REMOTE_PERMISSIONS,
      mcp: { ...defaultMcpPermissions(), enabled: true },
    });
    const client = this.clientFromDevice(device);
    this.emitActivity();

    return {
      client: this.publicClient(client),
      token: device.token,
      endpoint: this.endpoint,
      stdio: this.stdioConfiguration(device.token),
    };
  }

  updateClient(clientId: string, update: Partial<McpClientGrant>) {
    const device = this.deviceById(clientId);
    if (!device) throw new Error('Client not found.');

    const permissions = normalizePermissions({
      ...device.permissions,
      profiles: update.profileKeys ?? device.permissions.profiles,
      mcp: this.permissionsFromLegacy(update, device.permissions),
    });

    this.scriptHandler.deviceHandler.updateDevice(clientId, {
      name: update.name?.slice(0, 80) ?? device.name,
      permissions,
    });
    this.emitActivity();
    return this.publicClient(this.clientById(clientId)!);
  }

  rotateClientToken(clientId: string) {
    const token = this.scriptHandler.deviceHandler.rotateToken(clientId);
    if (!token) throw new Error('Client not found.');
    return { token, endpoint: this.endpoint, stdio: this.stdioConfiguration(token) };
  }

  async testClient(clientId: string) {
    const client = this.clientById(clientId);
    if (!this.endpoint || !client) {
      return { ok: false, message: 'Client or endpoint is unavailable.' };
    }

    try {
      const headers = {
        authorization: `Bearer ${client.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };

      let response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          ...headers,
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'server/discover',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test',
          method: 'server/discover',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'JNbot test', version: app.getVersion() },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal: AbortSignal.timeout(5_000),
      });

      let body = await this.mcpResponseBody(response) as {
        result?: {
          serverInfo?: { name?: string };
          protocolVersion?: string;
          supportedVersions?: string[];
          _meta?: { 'io.modelcontextprotocol/serverInfo'?: { name?: string } };
        };
      } | null;

      let protocolVersion = body?.result?.supportedVersions?.includes('2026-07-28')
        ? '2026-07-28'
        : body?.result?.protocolVersion;
      let serverName = body?.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name ?? body?.result?.serverInfo?.name;

      if (!response.ok && [400, 404, 405].includes(response.status)) {
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'test',
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'JNbot test', version: app.getVersion() },
            },
          }),
          signal: AbortSignal.timeout(5_000),
        });
        body = await this.mcpResponseBody(response) as {
          result?: { serverInfo?: { name?: string }; protocolVersion?: string };
        } | null;
        protocolVersion = body?.result?.protocolVersion;
        serverName = body?.result?.serverInfo?.name;
      }

      const ok = response.ok && Boolean(protocolVersion) && Boolean(serverName);
      if (ok) {
        this.touchClient(client.id);
        this.emitActivity();
      }
      return {
        ok,
        message: ok
          ? `MCP authentication succeeded (${protocolVersion}).`
          : `MCP returned ${response.status}${response.ok ? ' with an invalid discovery response.' : '.'}`,
        protocolVersion,
        relayConnected: this.relayConnected,
      };
    } catch (error) {
      return { ok: false, message: sanitizeError(error) };
    }
  }

  async removeClient(clientId: string): Promise<void> {
    this.pending.forEach((value, id) => {
      if (value.clientId === clientId) this.pending.delete(id);
    });
    this.operations.cancelClient(clientId);
    await this.botBridge.stopClientSessions(clientId);
    this.scriptHandler.deviceHandler.removeDevice(clientId);
    this.activeClientIds.delete(clientId);
    this.emitActivity();
  }

  // ===========================================================================
  // Approvals & Audit Trail
  // ===========================================================================

  async decideApproval(operationId: string, approved: boolean, profileKeys?: string[]): Promise<McpOperation> {
    const pairing = this.relayPairings.get(operationId);
    if (pairing) {
      this.relayPairings.delete(operationId);
      if (approved) {
        const client = this.createClient({
          name: pairing.clientName,
          provider: /chatgpt/i.test(pairing.clientName) ? 'chatgpt' : /claude/i.test(pairing.clientName) ? 'claude' : 'custom',
          profileKeys: profileKeys?.length ? profileKeys : [this.scriptHandler.settings.bootstrapProfileKey],
        });
        this.relayClient.sendPairingDecision(pairing.pairingId, true, client.client.id, pairing.requestedScopes);
      } else {
        this.relayClient.sendPairingDecision(pairing.pairingId, false);
      }
      this.emitActivity();
      return {
        operationId,
        status: approved ? 'succeeded' : 'denied',
        tool: 'pair_mcp_client',
        clientId: '',
        acceptedAt: Date.now(),
        updatedAt: Date.now(),
        pollAfterMs: 0,
        deduplicated: false,
        summary: approved ? 'MCP client paired' : 'MCP pairing denied',
      };
    }

    const pending = this.pending.get(operationId);
    if (!pending) throw new Error('Operation is no longer awaiting approval.');

    this.pending.delete(operationId);
    const operation = approved
      ? this.operations.approve(operationId, pending.execute)
      : this.operations.deny(operationId);

    this.record(pending.clientId, operation, approved ? 'allowed' : 'denied');
    this.emitActivity();
    return operation;
  }

  clearAudit(): void {
    this.audit.length = 0;
    this.emitActivity();
  }

  pluginDocs(): string {
    return this.docs;
  }

  // ===========================================================================
  // HTTP Request Handling & MCP Server Dispatch
  // ===========================================================================

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.url !== '/mcp') {
        return this.json(response, 404, { error: 'not_found' });
      }
      if (!['POST', 'GET', 'DELETE'].includes(request.method ?? '')) {
        return this.json(response, 405, { error: 'method_not_allowed' });
      }
      if (!this.validHost(request.headers.host) || !this.validOrigin(request.headers.origin)) {
        return this.json(response, 403, { error: 'invalid_request_origin' });
      }

      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      const client = token ? this.clientByToken(token) : undefined;
      if (!client) {
        return this.json(response, 401, { error: 'invalid_client' });
      }

      if (!consumeRateLimit(this.rateWindows, client.id, RATE_LIMIT, RATE_WINDOW_MS)) {
        return this.json(response, 429, { error: 'rate_limited' });
      }

      this.touchClient(client.id);
      const body = request.method === 'POST' ? await this.readBody(request) : undefined;
      this.activeClientIds.add(client.id);

      const handler = createMcpHandler(() => this.createServer(client), {
        legacy: 'stateless',
      });
      await toNodeHandler(handler)(request, response, body);
    } catch (error) {
      console.error('[MCP] Request failed:', error);
      if (!response.headersSent) {
        this.json(response, 500, { error: sanitizeError(error) });
      } else {
        response.end();
      }
    }
  }

  private createServer(client: McpClientContext): McpServer {
    const server = new McpServer(
      { name: 'JNbot MCP', version: app.getVersion() },
      { instructions: MCP_INSTRUCTIONS },
    );

    for (const tool of this.tools(client)) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.schema,
          annotations: {
            readOnlyHint: Boolean(tool.readOnly),
            destructiveHint: !tool.readOnly,
            openWorldHint: !tool.readOnly,
          },
        },
        async (raw) => {
          try {
            const result = await tool.handler(raw as Record<string, unknown>, client);
            const structuredContent = asStructuredContent(result);
            return {
              content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
              structuredContent,
            };
          } catch (error) {
            console.error(`[MCP] Tool ${tool.name} failed:`, error);
            throw error;
          }
        },
      );
    }

    this.registerResources(server, client);
    this.registerPrompts(server, client);
    return server;
  }

  /** Read-only documents clients can attach as context without a tool call. */
  private registerResources(server: McpServer, client: McpClientContext) {
    for (const section of JNBOT_REFERENCE_SECTION_IDS) {
      server.registerResource(
        `reference-${section}`,
        `jnbot://reference/${section}`,
        { title: `JNbot reference: ${section}`, mimeType: 'text/plain' },
        async (uri) => ({ contents: [{ uri: uri.href, text: this.getReference(section).content }] }),
      );
    }
    if (client.permissions.mcp.plugins === 'deny') return;
    server.registerResource(
      'plugin-source',
      new ResourceTemplate('jnbot://plugins/{pluginId}', {
        list: async () => ({
          resources: this.macros.toList().map((plugin) => ({
            uri: `jnbot://plugins/${plugin.pluginId}`,
            name: plugin.name,
            mimeType: 'text/plain',
          })),
        }),
      }),
      { title: 'Plugin source', mimeType: 'text/plain' },
      async (uri, variables) => ({
        contents: [{ uri: uri.href, text: this.currentSource(String(variables.pluginId)) ?? '' }],
      }),
    );
  }

  /** Ready-made workflows that show up as slash commands in MCP clients. */
  private registerPrompts(server: McpServer, client: McpClientContext) {
    const prompt = (name: string, title: string, description: string, text: (args: Record<string, string>) => string) =>
      server.registerPrompt(
        name,
        { title, description, argsSchema: z.object({ request: z.string().describe('What you want, in your own words.') }) },
        (args) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: text(args) } }] }),
      );
    if (client.permissions.mcp.plugins === 'deny') return;
    prompt('write-plugin', 'Write a plugin', 'Create a JNbot plugin or action from a description.', ({ request }) =>
      `Create a JNbot plugin: ${request}\n\nFirst call get_plugin mode "authoring", read any reference section you need, add options for adjustable behaviour, then save it with save_plugin.`);
    prompt('create-trigger', 'Create a trigger', 'Create a trigger that reacts to a bot event.', ({ request }) =>
      `Create a JNbot trigger: ${request}\n\nCall get_jnbot_context and get_plugin mode "automations" first, then save it with save_automation.`);
    prompt('build-chain', 'Build a chain', 'Build a chain of actions that runs on every selected alt.', ({ request }) =>
      `Build a JNbot chain: ${request}\n\nCall get_jnbot_context and get_plugin mode "actions" for the available actions, then save it with save_automation.`);
    prompt('debug-run', 'Debug a run', 'Find out why a plugin run failed and fix it.', ({ request }) =>
      `Help me debug this JNbot plugin run: ${request}\n\nUse get_jnbot_context to find the run, get_run with logs: true for its logs, get_plugin mode "source" for the code, then explain the cause and propose a fix with save_plugin dryRun.`);
  }

  tools(client: McpClientContext): McpToolDefinition[] {
    return createMcpTools(this, client);
  }

  // ===========================================================================
  // Tool Execution Helpers
  // ===========================================================================

  submit(
    client: McpClientContext,
    tool: string,
    pack: McpPack,
    target: McpBotTarget | undefined,
    args: Record<string, unknown>,
    execute: () => Promise<unknown>,
  ) {
    const profileKey = target?.profileKey ?? (typeof args.profileKey === 'string' ? args.profileKey : undefined);
    if (profileKey) this.assertProfile(client, profileKey);

    const policy = client.permissions.mcp[pack] as McpPermission;
    if (policy === 'deny') {
      throw new Error('This client is not permitted to use this operation.');
    }

    const safeExecute = async () => this.publicValue(await execute());
    const operation = this.operations.create({
      clientId: client.id,
      tool,
      target,
      args,
      requestKey: typeof args.requestKey === 'string' ? args.requestKey : undefined,
      summary: this.summary(tool, target),
      requiresApproval: policy === 'ask',
      execute: safeExecute,
    });

    if (operation.status === 'awaiting_approval') {
      this.pending.set(operation.operationId, {
        clientId: client.id,
        execute: safeExecute,
        args,
      });
    }

    this.record(client.id, operation, operation.status === 'awaiting_approval' ? 'approval_required' : 'allowed');
    this.emitActivity();
    return operation;
  }

  actionOperation(
    client: McpClientContext,
    tool: string,
    args: Record<string, unknown>,
    actionId: string,
    input?: Record<string, unknown>,
  ) {
    const targets = this.targets(args);
    return this.submit(
      client,
      tool,
      'control',
      this.operationTarget(targets),
      args,
      () => this.forEachTarget(targets, (target) => this.botBridge.action(target, actionId, input ?? {})),
    );
  }

  /** `account`, or every entry of `accounts` (`["*"]` = all active bots). */
  targets(args: Record<string, unknown>): McpBotTarget[] {
    const profileKey = String(args.profileKey);
    const accounts = Array.isArray(args.accounts)
      ? (args.accounts as string[]).includes('*')
        ? this.botBridge.activeAccounts(profileKey)
        : (args.accounts as string[])
      : [String(args.account)];
    if (!accounts.length) throw new Error('No active bots match accounts.');
    return accounts.map((account) => ({ profileKey, account }));
  }

  private operationTarget(targets: McpBotTarget[]): McpBotTarget {
    return targets.length === 1
      ? targets[0]
      : { profileKey: targets[0].profileKey, account: `${targets.length} bots` };
  }

  /** Run on one target as-is, or on several with a per-account result. */
  private async forEachTarget(targets: McpBotTarget[], run: (target: McpBotTarget) => Promise<unknown>) {
    if (targets.length === 1) return run(targets[0]);
    const settled = await Promise.allSettled(targets.map(run));
    return {
      results: settled.map((result, index) => ({
        account: targets[index].account,
        ok: result.status === 'fulfilled',
        ...(result.status === 'fulfilled' ? { result: result.value } : { error: sanitizeError(result.reason) }),
      })),
    };
  }

  moveAction(value: string): string {
    return MOVE_ACTION_MAP[value];
  }

  interactionAction(value: string): string {
    return INTERACTION_ACTION_MAP[value];
  }

  inventoryAction(value: string): string {
    return INVENTORY_ACTION_MAP[value];
  }

  target(args: Record<string, unknown>): McpBotTarget {
    return {
      profileKey: String(args.profileKey),
      account: String(args.account),
    };
  }

  joinInput(args: Record<string, unknown>) {
    return {
      version: args.version ? String(args.version) : undefined,
      login: args.login === undefined ? true : Boolean(args.login),
      gamemode: args.gamemode ? String(args.gamemode) : undefined,
    };
  }

  async readState(client: McpClientContext, target: McpBotTarget, include: string[] = [], since?: string) {
    this.assertProfile(client, target.profileKey);
    const optional = (key: string, read: () => Promise<unknown>) =>
      include.includes(key) ? read() : Promise.resolve(undefined);
    const [state, chat, inventory, players, events] = await this.withReadTimeout(
      Promise.all([
        this.botBridge.state(target),
        optional('chat', () => this.botBridge.chat(target, { limit: 100, cursor: since })),
        optional('inventory', () => this.botBridge.inventory(target)),
        optional('players', () => this.botBridge.players(target)),
        optional('events', () => this.botBridge.events(target, { cursor: since })),
      ]),
    );

    return this.publicValue({
      state,
      ...(chat === undefined ? {} : { chat }),
      ...(inventory === undefined ? {} : { inventory }),
      ...(players === undefined ? {} : { players }),
      ...(events === undefined ? {} : { events }),
    });
  }

  async inspectWorld(client: McpClientContext, args: Record<string, unknown>) {
    const target = this.target(args);
    this.assertProfile(client, target.profileKey);

    const mode = String(args.mode);
    const input = { ...args };
    delete input.profileKey;
    delete input.account;
    delete input.mode;

    const request = mode === 'nearby_entities'
      ? this.botBridge.entities(target, input)
      : mode === 'block_at'
        ? this.botBridge.block(target, input)
        : this.botBridge.find(target, input);

    return this.publicValue(await this.withReadTimeout(request));
  }

  private async withReadTimeout<T>(value: Promise<T>): Promise<T> {
    return Promise.race([
      value,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('read_timeout: bot did not respond within five seconds.')), READ_TIMEOUT_MS),
      ),
    ]);
  }

  getPlugin(client: McpClientContext, args: Record<string, unknown>) {
    const mode = String(args.mode);
    if (mode === 'source') {
      return this.macros.getMacro(String(args.pluginId));
    }
    if (mode === 'actions') {
      const runtime = this.runtimeFor(client, String(args.profileKey));
      return this.scriptHandler.getUiActions(runtime.profileId);
    }
    if (mode === 'automations') {
      return this.plugins.getAutomations(this.runtimeFor(client, String(args.profileKey)).profileKey);
    }
    if (mode === 'options') {
      const runtime = this.runtimeFor(client, String(args.profileKey));
      return this.plugins.getOptions(runtime.profileId, String(args.pluginId), args.preset as string | undefined);
    }
    return {
      entryPoint: args.scriptType === 'action' ? 'async function main(bot, settings, args?)' : 'Plugin scripts run with script.settings.',
      guide: PLUGIN_AUTHORING_GUIDE,
      referenceSections: JNBOT_REFERENCE_SECTION_IDS,
    };
  }

  async savePlugin(client: McpClientContext, args: Record<string, unknown>) {
    const optionSchema = args.optionSchema === undefined
      ? undefined
      : validatePluginOptionSchema(args.optionSchema);
    const normalizedArgs = optionSchema === undefined ? args : { ...args, optionSchema };
    const mode = String(normalizedArgs.mode);
    const target = typeof normalizedArgs.profileKey === 'string' ? { profileKey: normalizedArgs.profileKey, account: 'plugin' } : undefined;

    if (mode === 'source') {
      if (!normalizedArgs.name || !normalizedArgs.source) {
        throw new Error('Plugin name and source are required.');
      }
      const validation = await this.pluginInstaller.validate(
        {
          source: String(normalizedArgs.source),
          language: (normalizedArgs.language as 'js' | 'ts') ?? 'js',
          scriptType: (normalizedArgs.scriptType as 'script' | 'action') ?? 'script',
          optionSchema: normalizedArgs.optionSchema as any,
        },
        false,
      );
      if (!validation.valid) {
        throw new McpInputError('Plugin source does not satisfy the JNbot authoring contract.', {
          field: 'source',
          issues: validation.errors.map((problem) => ({ path: 'source', problem })),
          correction: 'Fix each reported source issue, then retry the same save_plugin call.',
        });
      }
      if (normalizedArgs.dryRun) {
        const { changedLines, optionSchema: schema } = this.pluginPreview(normalizedArgs);
        return { valid: true, saved: false, changedLines, optionSchemaChanged: schema?.changed };
      }
    }

    return this.submit(client, 'save_plugin', 'plugins', target, normalizedArgs, async () => {
      if (mode === 'options') {
        const runtime = this.runtimeFor(client, String(normalizedArgs.profileKey));
        return this.plugins.updateOptions(
          runtime.profileId,
          String(normalizedArgs.pluginId),
          (normalizedArgs.values as Record<string, unknown>) ?? {},
          Boolean(normalizedArgs.replace),
          normalizedArgs.preset as string | undefined,
        );
      }
      if (mode === 'schema') {
        return this.plugins.updateSchema(String(normalizedArgs.pluginId), (normalizedArgs.optionSchema as any) ?? []);
      }
      return this.pluginInstaller.install(
        {
          clientId: client.id,
          name: String(normalizedArgs.name),
          description: normalizedArgs.description ? String(normalizedArgs.description) : undefined,
          language: (normalizedArgs.language as 'js' | 'ts') ?? 'js',
          scriptType: (normalizedArgs.scriptType as 'script' | 'action') ?? 'script',
          source: String(normalizedArgs.source),
          optionSchema: normalizedArgs.optionSchema as any,
          targetPluginId: normalizedArgs.pluginId ? String(normalizedArgs.pluginId) : undefined,
        },
        false,
      );
    });
  }

  runPlugin(client: McpClientContext, args: Record<string, unknown>) {
    const runtime = this.runtimeFor(client, String(args.profileKey));
    const pluginId = String(args.pluginId);
    const targets = args.account || args.accounts ? this.targets(args) : undefined;
    const overrides = { ...(args.optionOverrides as Record<string, unknown>) };
    if (args.preset) {
      const stored = this.scriptHandler.settings.getProfileSettings(runtime.profileKey).scripts?.[pluginId];
      const presetId = findPresetId(stored, String(args.preset));
      if (!presetId) throw new McpInputError(`Unknown preset: ${args.preset}`, { field: 'preset' });
      overrides[PRESET_OPTION] = presetId;
    }

    return this.submit(client, 'run_plugin', 'plugins', targets && this.operationTarget(targets), args, async () => {
      if (args.mode === 'run') {
        return { started: await this.scriptHandler.runByPluginId(runtime.profileId, pluginId, overrides) };
      }
      if (!targets) {
        throw new Error('An account is required for an action plugin.');
      }
      return this.forEachTarget(targets, (target) => this.botBridge.runPluginAction(
        this.botBridge.target(target),
        pluginId,
        (args.args as unknown[]) ?? [],
        overrides,
      ));
    });
  }

  saveAutomation(client: McpClientContext, args: Record<string, unknown>) {
    const runtime = this.runtimeFor(client, String(args.profileKey));
    const kind = args.kind as 'trigger' | 'chain';
    const remove = Boolean(args.deleteId);
    const input = remove ? { id: args.deleteId } : (args[kind] as Record<string, unknown>);
    const target = { profileKey: runtime.profileKey, account: `${kind}s` };
    return this.submit(client, 'save_automation', 'plugins', target, args, async () =>
      kind === 'trigger'
        ? this.plugins.saveTrigger(runtime.profileKey, input, remove)
        : this.plugins.saveChain(runtime.profileId, input, remove),
    );
  }

  private pluginPreview(args: Record<string, unknown>) {
    return this.pluginInstaller.preview({
      source: String(args.source),
      optionSchema: args.optionSchema as any,
      targetPluginId: args.pluginId ? String(args.pluginId) : undefined,
    });
  }

  /** Check AI-written plugin source against the authoring contract. */
  async validatePlugin(draft: { source: string; scriptType?: 'script' | 'action'; optionSchema?: unknown }) {
    try {
      const optionSchema = validatePluginOptionSchema(draft.optionSchema ?? []);
      return await this.pluginInstaller.validate({ source: draft.source, scriptType: draft.scriptType, optionSchema }, false);
    } catch (error) {
      return { valid: false, errors: [sanitizeError(error)] };
    }
  }

  pluginSource(pluginId: string): string | undefined {
    return this.currentSource(pluginId);
  }

  private currentSource(pluginId: string): string | undefined {
    const code = (this.macros.readPlugin(pluginId) as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code : undefined;
  }

  getRun(client: McpClientContext, args: Record<string, unknown>) {
    const runtime = this.runtimeFor(client, String(args.profileKey));
    const run = runtime.activeScripts.toObject()[Number(args.runId)] ?? null;
    return args.logs
      ? { run, logs: serializeMcpRunLogs(runtime.consoleHandler.getAllLogs(), Number(args.limit) || 200) }
      : run;
  }

  stopRun(client: McpClientContext, args: Record<string, unknown>) {
    const runtime = this.runtimeFor(client, String(args.profileKey));
    return this.submit(
      client,
      'stop_run',
      'plugins',
      { profileKey: String(args.profileKey), account: `run:${args.runId}` },
      args,
      async () => {
        await runtime.activeScripts.getScript(Number(args.runId))?.stop();
        return { stopped: true };
      },
    );
  }

  getReference(section: string) {
    if (section === 'authoring') return { section, content: PLUGIN_AUTHORING_GUIDE };
    if (section === 'examples') return { section, content: PLUGIN_FULL_EXAMPLES };

    if (!Object.prototype.hasOwnProperty.call(JNBOT_REFERENCE_SECTION_MARKERS, section)) {
      throw new Error(`Unknown JNbot reference section: ${section}`);
    }

    const referenceSection = section as JnbotReferenceSection;
    const marker = JNBOT_REFERENCE_SECTION_MARKERS[referenceSection as keyof typeof JNBOT_REFERENCE_SECTION_MARKERS];
    const start = PLUGIN_API_TYPES.indexOf(marker);
    if (start < 0) throw new Error(`Reference section is unavailable: ${section}`);

    const nextMarker = '\n// ─── ';
    const end = PLUGIN_API_TYPES.indexOf(nextMarker, start + marker.length);
    return {
      section: referenceSection,
      content: PLUGIN_API_TYPES.slice(start, end < 0 ? undefined : end).trim(),
    };
  }

  // ===========================================================================
  // Profile, Client & Device Helpers
  // ===========================================================================

  allowedProfiles(client: McpClientContext): string[] {
    const all = this.scriptHandler.getRuntimeSummaries().map(({ profileKey }) => profileKey);
    return client.permissions.profiles === '*'
      ? all
      : all.filter((key) => client.permissions.profiles.includes(key));
  }

  assertProfile(client: McpClientContext, profileKey?: string): void {
    if (!profileKey || !this.allowedProfiles(client).includes(profileKey)) {
      throw new Error('permission_denied: profile is not available to this client.');
    }
  }

  runtimeFor(client: McpClientContext, profileKey: string) {
    this.assertProfile(client, profileKey);
    const runtime = this.scriptHandler.getRuntimeByKey(profileKey);
    if (!runtime) throw new Error('Profile is not currently available.');
    return runtime;
  }

  private clients(): McpClientContext[] {
    return Object.values(this.scriptHandler.deviceHandler.getDevices())
      .map((device) => this.clientFromDevice(device))
      .filter((client) => client.permissions.mcp.enabled);
  }

  private clientById(id: string): McpClientContext | undefined {
    const device = this.deviceById(id);
    const client = device ? this.clientFromDevice(device) : undefined;
    return client?.permissions.mcp.enabled ? client : undefined;
  }

  /** Built-in callers (the in-app AI agent) that aren't paired devices. */
  private readonly internalClients = new Map<string, McpClientContext>();

  /**
   * A client for JNbot's own AI agent, limited to one profile. It can observe,
   * control bots and manage plugins without approvals, but never run raw code.
   */
  internalClient(id: string, name: string, profileKey: string): McpClientContext {
    const client: McpClientContext = {
      id,
      name,
      token: '',
      permissions: normalizePermissions({
        profiles: [profileKey],
        permissionMask: DEFAULT_REMOTE_PERMISSIONS,
        mcp: { enabled: true, observe: 'allow', control: 'allow', code: 'deny', plugins: 'allow' },
      } as ClientPermissions),
    };
    this.internalClients.set(id, client);
    return client;
  }

  private clientName(id: string): string {
    return this.clientById(id)?.name ?? this.internalClients.get(id)?.name ?? 'Removed client';
  }

  private clientByToken(token: string): McpClientContext | undefined {
    const device = this.scriptHandler.deviceHandler.findDevice(token);
    const client = device ? this.clientFromDevice(device) : undefined;
    return client?.permissions.mcp.enabled ? client : undefined;
  }

  private deviceById(id: string): Device | undefined {
    return this.scriptHandler.deviceHandler.getDevice(id);
  }

  private clientFromDevice(device: Device): McpClientContext {
    return {
      id: device.id,
      name: device.name,
      token: device.token,
      permissions: normalizePermissions(device.permissions),
      createdAt: device.createdAt,
      lastActivityAt: device.lastActivityAt,
    };
  }

  private publicClient(client: McpClientContext): McpClientGrant {
    const permissions = client.permissions.mcp;
    const capabilities: McpCapability[] = [];

    if (permissions.observe === 'allow') {
      capabilities.push('bot_status', 'chat_players', 'world_entities');
    }
    if (permissions.control !== 'deny') {
      capabilities.push('bot_controls', 'inventory_windows', 'account_joining');
    }
    if (permissions.code !== 'deny') {
      capabilities.push('bot_scripting');
    }
    if (permissions.plugins !== 'deny') {
      capabilities.push('plugin_source_reading', 'plugin_draft_creation', 'plugin_execution');
    }

    return {
      id: client.id,
      name: client.name,
      provider: 'custom',
      capabilities,
      profileKeys: client.permissions.profiles === '*' ? ['*'] : client.permissions.profiles,
      accounts: [],
      approvalPolicy: {},
      createdAt: client.createdAt ?? 0,
      lastActivityAt: client.lastActivityAt,
      mcpPermissions: permissions,
    };
  }

  private touchClient(clientId: string): void {
    this.scriptHandler.deviceHandler.touchDevice(clientId);
  }

  private permissionsFromLegacy(update: Partial<McpClientGrant>, current: ClientPermissions) {
    if (update.mcpPermissions) return update.mcpPermissions;

    const next = { ...current.mcp };
    if (update.capabilities) {
      const capabilities = new Set(update.capabilities);
      next.observe = capabilities.has('bot_status') ? 'allow' : 'deny';
      next.control = capabilities.has('bot_controls') || capabilities.has('account_joining')
        ? (current.mcp.control === 'deny' ? 'ask' : current.mcp.control)
        : 'deny';
      next.code = capabilities.has('bot_scripting')
        ? (current.mcp.code === 'deny' ? 'ask' : current.mcp.code)
        : 'deny';
      next.plugins = capabilities.has('plugin_execution') || capabilities.has('plugin_draft_creation')
        ? (current.mcp.plugins === 'deny' ? 'ask' : current.mcp.plugins)
        : 'deny';
    }
    return next;
  }

  private approvals(): McpApprovalRequest[] {
    const operationApprovals: McpApprovalRequest[] = this.operations
      .list()
      .filter(({ status }) => status === 'awaiting_approval')
      .map((operation) => {
        const pending = this.pending.get(operation.operationId);
        const args = pending?.args ?? {};
        // Updates show a diff against the installed source; new plugins show the code.
        const pluginDiff = typeof args.source === 'string' && args.pluginId
          ? this.pluginPreview(args)
          : undefined;
        return {
          id: operation.operationId,
          clientId: operation.clientId,
          clientName: this.clientName(operation.clientId),
          tool: operation.tool,
          capability: 'bot_controls' as const,
          pluginDiff,
          arguments: {
            ...args,
            ...(typeof args.source === 'string' && !pluginDiff ? { code: args.source } : {}),
          },
          argumentHash: operation.operationId,
          target: operation.target ? { profileKey: operation.target.profileKey, account: operation.target.account } : undefined,
          summary: operation.summary,
          risk: operation.tool === 'run_bot_script' || operation.tool === 'save_plugin' ? 'high' as const : 'medium' as const,
          status: 'pending' as const,
          createdAt: operation.acceptedAt,
          expiresAt: operation.acceptedAt + 60 * 60_000,
        };
      });

    const pairingApprovals: McpApprovalRequest[] = [...this.relayPairings.entries()].map(([id, pairing]) => ({
      id,
      clientId: '',
      clientName: pairing.clientName,
      tool: 'pair_mcp_client',
      capability: 'bot_status' as const,
      arguments: { requestedScopes: pairing.requestedScopes },
      argumentHash: id,
      summary: `Allow ${pairing.clientName} to connect to JNbot`,
      risk: 'medium' as const,
      status: 'pending' as const,
      createdAt: Date.now(),
      expiresAt: pairing.expiresAt,
    }));

    return [...operationApprovals, ...pairingApprovals];
  }

  private record(clientId: string, operation: McpOperation, decision: McpAuditEvent['decision']) {
    this.touchClient(clientId);
    this.audit.push({
      id: operation.operationId,
      timestamp: Date.now(),
      clientId,
      clientName: this.clientName(clientId),
      tool: operation.tool,
      capability: 'bot_controls',
      target: operation.target ? { profileKey: operation.target.profileKey, account: operation.target.account } : undefined,
      decision,
      result: operation.status === 'failed' ? 'error' : operation.status === 'succeeded' ? 'success' : 'pending',
    });

    if (this.audit.length > 2_000) {
      this.audit.splice(0, this.audit.length - 2_000);
    }
  }

  private summary(tool: string, target?: McpBotTarget) {
    return target ? `${tool} for ${target.account} on ${target.profileKey}` : tool;
  }

  private publicValue(value: unknown): unknown {
    const redacted = redactMcpValue(value);
    if (Array.isArray(redacted)) {
      return redacted.map((item) => this.publicValue(item));
    }
    if (!redacted || typeof redacted !== 'object') {
      return redacted;
    }
    return Object.fromEntries(
      Object.entries(redacted as Record<string, unknown>)
        .filter(([key]) => !['botId', 'profileId', 'RUNTIME_SCRIPT_ID', 'INSTANCE_ID'].includes(key))
        .map(([key, item]) => [key, this.publicValue(item)]),
    );
  }

  private requestRelayPairingApproval(frame: PairingFrame): void {
    this.relayPairings.set(`pairing:${frame.pairingId}`, frame);
    this.emitActivity();
  }

  private async mcpResponseBody(response: Response): Promise<unknown> {
    const body = await response.text();
    const event = body.split('\n').find((line) => line.startsWith('data:'));
    const json = event ? event.slice(5).trim() : body;
    try {
      return json ? JSON.parse(json) : null;
    } catch {
      return null;
    }
  }

  private validHost(host?: string) {
    if (!host || !this.endpoint) return false;
    const port = new URL(this.endpoint).port;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  }

  private validOrigin(origin?: string) {
    return !origin || origin === 'https://chatgpt.com' || origin === 'https://claude.ai';
  }

  private async readBody(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  private json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  }

  private runtimePath() {
    return path.join(this.storage.directory, 'runtime.json');
  }

  private writeRuntimeDiscovery() {
    if (this.endpoint) {
      fs.writeFileSync(
        this.runtimePath(),
        JSON.stringify({ endpoint: this.endpoint, pid: process.pid, startedAt: Date.now() }),
        { mode: 0o600 },
      );
    }
  }

  private removeRuntimeDiscovery() {
    try {
      fs.unlinkSync(this.runtimePath());
    } catch {}
  }

  private stdioConfiguration(token: string) {
    return {
      command: process.execPath,
      args: [path.join(app.getAppPath(), 'dist', 'main', 'mcp-stdio.js')],
      env: {
        JNBOT_MCP_RUNTIME: this.runtimePath(),
        JNBOT_MCP_TOKEN: token,
      },
    };
  }

  private emitActivity() {
    this.scriptHandler.windowHandler.sendToAll('MCP_ACTIVITY', this.snapshot());
  }
}

export default McpManager;
