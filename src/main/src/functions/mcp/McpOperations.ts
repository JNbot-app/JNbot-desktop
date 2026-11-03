import { randomUUID } from 'node:crypto';
import type { McpBotTarget, McpOperation, McpOperationStatus } from '../../../../common/mcp';
import { canonicalJson, sha256, sanitizeError } from './security';

type OperationInput = {
  clientId: string;
  tool: string;
  target?: McpBotTarget;
  args: Record<string, unknown>;
  requestKey?: string;
  summary: string;
  requiresApproval: boolean;
  execute: () => Promise<unknown>;
};

const MAX_OPERATIONS = 1_000;
const RETENTION_MS = 60 * 60_000;
const DEDUPLICATION_MS = 60_000;

/**
 * A deliberately small in-memory operation ledger. It is the sole async
 * boundary for MCP writes: callers receive an id immediately and the desktop
 * owns approval, serialization and retries.
 */
export class McpOperations {
  private readonly operations = new Map<string, McpOperation>();
  private readonly fingerprints = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly onChange: () => void = () => {}) {}

  create(input: OperationInput): McpOperation {
    this.prune();
    const fingerprint = this.fingerprint(input);
    const existingId = this.fingerprints.get(fingerprint);
    const existing = existingId ? this.operations.get(existingId) : undefined;
    if (existing && this.reusable(existing))
      return { ...existing, deduplicated: true };

    const now = Date.now();
    const operation: McpOperation = {
      operationId: randomUUID(),
      status: input.requiresApproval ? 'awaiting_approval' : 'queued',
      tool: input.tool,
      clientId: input.clientId,
      target: input.target,
      acceptedAt: now,
      updatedAt: now,
      pollAfterMs: 500,
      deduplicated: false,
      summary: input.summary,
    };
    this.operations.set(operation.operationId, operation);
    this.fingerprints.set(fingerprint, operation.operationId);
    this.onChange();
    if (!input.requiresApproval) this.start(operation.operationId, input.execute);
    return { ...operation };
  }

  get(clientId: string, operationId: string): McpOperation | undefined {
    this.prune();
    const operation = this.operations.get(operationId);
    return operation?.clientId === clientId ? { ...operation } : undefined;
  }

  list(): McpOperation[] {
    this.prune();
    return [...this.operations.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((operation) => ({ ...operation }));
  }

  approve(operationId: string, execute: () => Promise<unknown>): McpOperation {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== 'awaiting_approval')
      throw new Error('Operation is no longer awaiting approval.');
    this.transition(operation, 'queued');
    this.start(operationId, execute);
    return { ...operation };
  }

  deny(operationId: string): McpOperation {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== 'awaiting_approval')
      throw new Error('Operation is no longer awaiting approval.');
    this.transition(operation, 'denied');
    return { ...operation };
  }

  cancelClient(clientId: string): void {
    for (const operation of this.operations.values())
      if (operation.clientId === clientId && !this.terminal(operation.status))
        this.transition(operation, 'cancelled');
  }

  cancelAll(): void {
    for (const operation of this.operations.values())
      if (!this.terminal(operation.status)) this.transition(operation, 'cancelled');
    this.queues.clear();
  }

  private start(operationId: string, execute: () => Promise<unknown>): void {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status === 'cancelled') return;
    const queueKey = operation.target
      ? `${operation.target.profileKey}:${operation.target.account.toLowerCase()}`
      : `client:${operation.clientId}`;
    const previous = this.queues.get(queueKey) ?? Promise.resolve();
    const running = previous
      .catch(() => undefined)
      .then(async () => {
        const current = this.operations.get(operationId);
        if (!current || current.status === 'cancelled') return;
        this.transition(current, 'running');
        try {
          const result = await execute();
          if (current.status !== 'cancelled') {
            current.result = result;
            this.transition(current, 'succeeded');
          }
        } catch (error) {
          if (current.status !== 'cancelled') {
            current.error = { code: 'operation_failed', message: sanitizeError(error) };
            this.transition(current, 'failed');
          }
        }
      });
    const tracked = running.finally(() => {
      if (this.queues.get(queueKey) === tracked) this.queues.delete(queueKey);
    });
    this.queues.set(queueKey, tracked);
  }

  private fingerprint(input: OperationInput): string {
    const args = { ...input.args };
    delete args.requestKey;
    return sha256(canonicalJson({
      clientId: input.clientId,
      tool: input.tool,
      target: input.target,
      key: input.requestKey || undefined,
      args,
    }));
  }

  private reusable(operation: McpOperation): boolean {
    return !this.terminal(operation.status) || Date.now() - operation.updatedAt < DEDUPLICATION_MS;
  }

  private terminal(status: McpOperationStatus): boolean {
    return ['succeeded', 'failed', 'denied', 'cancelled'].includes(status);
  }

  private transition(operation: McpOperation, status: McpOperationStatus): void {
    operation.status = status;
    operation.updatedAt = Date.now();
    this.onChange();
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [id, operation] of this.operations)
      if (operation.updatedAt < cutoff) this.operations.delete(id);
    for (const [fingerprint, operationId] of this.fingerprints)
      if (!this.operations.has(operationId)) this.fingerprints.delete(fingerprint);
    while (this.operations.size > MAX_OPERATIONS) {
      const oldest = [...this.operations.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) break;
      this.operations.delete(oldest.operationId);
    }
  }
}

export default McpOperations;
